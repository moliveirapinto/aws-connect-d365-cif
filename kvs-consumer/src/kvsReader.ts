// Reads a live Amazon Connect call from Kinesis Video Streams and emits raw PCM
// audio per track.
//
// Connect's "Start media streaming" writes the call audio into a KVS stream as a
// Matroska (MKV/EBML) container. When both directions are streamed, the audio is
// split into two tracks — each PCM, signed 16-bit little-endian, mono, 8 kHz.
// (See session.ts participantForTrack for which track maps to agent vs
// customer.) We:
//   1. GetDataEndpoint(GET_MEDIA) to resolve the per-stream media endpoint,
//   2. GetMedia from the call's start fragment,
//   3. EBML-decode the payload, forwarding each SimpleBlock's PCM to onAudio,
//   4. track the latest KVS fragment number so we can resume if the HTTP payload
//      stream ends while the call is still up.
//
// Ref: https://docs.aws.amazon.com/kinesisvideostreams/latest/dg/API_dataplane_GetMedia.html

import { GetDataEndpointCommand, KinesisVideoClient } from "@aws-sdk/client-kinesis-video";
import {
  GetMediaCommand,
  KinesisVideoMediaClient,
  type StartSelector,
} from "@aws-sdk/client-kinesis-video-media";
import { EbmlStreamDecoder } from "ebml-stream";
import type { Readable } from "node:stream";
import { env } from "./env.js";

// EBML element IDs (full IDs, including the length-descriptor bits).
const ID_SIMPLE_BLOCK = 0xa3;
const ID_BLOCK = 0xa1;
const ID_TAG_NAME = 0x45a3;
const ID_TAG_STRING = 0x4487;

export interface KvsReaderOptions {
  streamArn?: string;
  streamName?: string;
  /** Fragment number handed to us by Connect at call start (where to begin). */
  startFragmentNumber?: string;
  /** Called with each decoded PCM chunk, tagged with its Matroska track number. */
  onAudio: (trackNumber: number, pcm: Uint8Array) => void;
  /** Called when the media stream ends and could not be resumed (call over). */
  onEnd: () => void;
  onError: (err: Error) => void;
}

export class KvsReader {
  private readonly kv: KinesisVideoClient;
  private mediaClient?: KinesisVideoMediaClient;
  private stopped = false;
  private lastFragment?: string;
  /** Set when the next TagString element carries the fragment number. */
  private expectFragmentString = false;
  private tagsSeen = 0;

  constructor(private readonly opts: KvsReaderOptions) {
    this.kv = new KinesisVideoClient({ region: env.awsRegion });
  }

  async start(): Promise<void> {
    const endpoint = await this.resolveMediaEndpoint();
    this.mediaClient = new KinesisVideoMediaClient({ region: env.awsRegion, endpoint });
    this.lastFragment = this.opts.startFragmentNumber;
    await this.readLoop();
  }

  stop(): void {
    this.stopped = true;
    try {
      this.mediaClient?.destroy();
    } catch {
      /* ignore */
    }
  }

  private async resolveMediaEndpoint(): Promise<string> {
    const res = await this.kv.send(
      new GetDataEndpointCommand({
        APIName: "GET_MEDIA",
        StreamARN: this.opts.streamArn,
        StreamName: this.opts.streamArn ? undefined : this.opts.streamName,
      }),
    );
    if (!res.DataEndpoint) throw new Error("GetDataEndpoint returned no DataEndpoint");
    return res.DataEndpoint;
  }

  private startSelector(): StartSelector {
    // First read: start where Connect told us. On resume: continue after the last
    // fragment we saw so we don't re-emit audio.
    if (this.lastFragment) {
      return { StartSelectorType: "FRAGMENT_NUMBER", AfterFragmentNumber: this.lastFragment };
    }
    return { StartSelectorType: "NOW" };
  }

  private async readLoop(): Promise<void> {
    while (!this.stopped) {
      let payload: Readable;
      try {
        const res = await this.mediaClient!.send(
          new GetMediaCommand({
            StreamARN: this.opts.streamArn,
            StreamName: this.opts.streamArn ? undefined : this.opts.streamName,
            StartSelector: this.startSelector(),
          }),
        );
        payload = res.Payload as unknown as Readable;
      } catch (err) {
        // ResourceNotFound after the producer stops is the normal "call over" case.
        const name = (err as { name?: string }).name ?? "";
        if (this.stopped) return;
        if (name === "ResourceNotFoundException") {
          this.opts.onEnd();
          return;
        }
        this.opts.onError(err as Error);
        return;
      }

      const ended = await this.consumePayload(payload);
      if (this.stopped) return;
      if (ended === "error") return;
      // The payload stream closed. If the call is still live, Connect keeps
      // pushing new fragments, so resume from the last fragment after a short
      // beat. If nothing new is produced the next GetMedia yields no blocks and
      // the idle timer in session.ts ends the call.
      await sleep(500);
    }
  }

  /** Pipe one GetMedia payload through the EBML decoder. Resolves when it ends. */
  private consumePayload(payload: Readable): Promise<"end" | "error"> {
    return new Promise((resolve) => {
      const decoder = new EbmlStreamDecoder();
      let settled = false;
      const done = (how: "end" | "error") => {
        if (settled) return;
        settled = true;
        resolve(how);
      };

      decoder.on("data", (tag: EbmlTag) => this.handleTag(tag));
      decoder.on("error", (err: Error) => {
        this.opts.onError(err);
        done("error");
      });
      decoder.on("end", () => done("end"));
      payload.on("error", (err: Error) => {
        this.opts.onError(err);
        done("error");
      });
      payload.pipe(decoder as unknown as NodeJS.WritableStream);
    });
  }

  private handleTag(tag: EbmlTag): void {
    const id = tag.id;

    // Capture the KVS fragment number so we can resume the stream if it drops.
    if (id === ID_TAG_NAME) {
      this.expectFragmentString = readString(tag) === "AWS_KINESISVIDEO_FRAGMENT_NUMBER";
      return;
    }
    if (id === ID_TAG_STRING && this.expectFragmentString) {
      this.expectFragmentString = false;
      const num = readString(tag);
      if (num) this.lastFragment = num;
      return;
    }

    if (id === ID_SIMPLE_BLOCK || id === ID_BLOCK) {
      const track = typeof tag.track === "number" ? tag.track : 1;
      const frames: (Uint8Array | undefined)[] =
        Array.isArray(tag.frames) && tag.frames.length ? tag.frames : [tag.payload];
      for (const f of frames) {
        if (f && f.byteLength) this.opts.onAudio(track, f);
      }
      if (this.tagsSeen < 3) {
        this.tagsSeen++;
        console.log(
          `[kvs] block track=${track} frames=${frames.length} bytes=${frames[0]?.byteLength ?? 0}`,
        );
      }
    }
  }
}

// ebml-stream's tag objects aren't strongly typed for our fields; describe the
// bits we use.
interface EbmlTag {
  id: number;
  track?: number;
  payload?: Uint8Array;
  frames?: Uint8Array[];
  data?: Uint8Array;
  value?: unknown;
}

function readString(tag: EbmlTag): string {
  if (typeof tag.value === "string") return tag.value;
  if (tag.data) return Buffer.from(tag.data).toString("utf8");
  if (tag.payload) return Buffer.from(tag.payload).toString("utf8");
  return "";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
