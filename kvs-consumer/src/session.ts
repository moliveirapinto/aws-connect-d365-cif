// One live call = one Session. It owns the KVS reader, a Speech recognizer per
// audio track, and the D365 conversation lifecycle for a single Amazon Connect
// contactId. On this Connect instance track 1 carries the AGENT (to-customer)
// and track 2 carries the CUSTOMER (from-customer). Finalised utterances are
// posted to the ingestor as they occur, so the transcript appears LIVE in the
// Omnichannel conversation during the call.

import { ingestor, type Participant } from "./ingestorClient.js";
import { KvsReader } from "./kvsReader.js";
import { SpeechStream } from "./speech.js";
import { env } from "./env.js";

export interface StartSessionInput {
  contactId: string;
  ani?: string;
  agentId?: string;
  streamArn?: string;
  streamName?: string;
  startFragmentNumber?: string;
}

function participantForTrack(track: number): Participant {
  // Connect delivers the agent (to-customer) audio on track 1 and the customer
  // (from-customer) audio on track 2. Anything unexpected is attributed to the
  // customer.
  return track === 1 ? "AGENT" : "CUSTOMER";
}

// Per-track pipe: the Speech recognizer is created asynchronously (an Entra
// token has to be fetched first), so we buffer incoming PCM until it is ready.
interface TrackPipe {
  stream?: SpeechStream;
  buffer: Uint8Array[];
}

export class Session {
  private readonly reader: KvsReader;
  private readonly pipes = new Map<number, TrackPipe>();
  private idleTimer?: NodeJS.Timeout;
  private ending = false;

  /** D365 owner for the conversation; may be filled in later by setAgent(). */
  private agentId?: string;
  /** True once the D365 conversation has been opened. */
  private conversationStarted = false;
  /** Finalised utterances recognised before the conversation exists (deferred mode). */
  private readonly pendingFinals: Array<{
    participant: Participant;
    content: string;
    timestamp: string;
  }> = [];

  constructor(private readonly input: StartSessionInput) {
    this.reader = new KvsReader({
      streamArn: input.streamArn,
      streamName: input.streamName,
      startFragmentNumber: input.startFragmentNumber,
      onAudio: (track, pcm) => this.onAudio(track, pcm),
      onEnd: () => this.end("stream-end"),
      onError: (err) => {
        console.error(`[session:${this.input.contactId}] kvs error`, err);
        this.end("kvs-error");
      },
    });
  }

  async start(): Promise<void> {
    const { contactId, ani } = this.input;
    this.agentId = this.input.agentId;
    console.log(`[session:${contactId}] starting (ani=${ani ?? "?"})`);
    if (env.deferConversationUntilAgent) {
      // Wait for the agent-accept signal before opening the conversation so it is
      // created on — and routed to — the specific agent who took the call.
      console.log(`[session:${contactId}] deferring conversation until agent accepts`);
    } else {
      // Legacy behaviour: open the D365 conversation at call start.
      await this.ensureConversationStarted();
    }
    this.armIdleTimer();
    // Kick off KVS reading in the background; audio drives the rest.
    this.reader.start().catch((err) => {
      console.error(`[session:${contactId}] reader.start failed`, err);
      this.end("kvs-start-failed");
    });
  }

  /** Open the D365 conversation once (idempotent) and flush any buffered finals. */
  private async ensureConversationStarted(): Promise<void> {
    if (this.conversationStarted) return;
    this.conversationStarted = true;
    const { contactId, ani } = this.input;
    // Open the D365 conversation so it exists while audio flows.
    await ingestor.started({ contactId, ani, agentId: this.agentId, timestamp: new Date().toISOString() });
    if (this.pendingFinals.length) {
      console.log(`[session:${contactId}] flushing ${this.pendingFinals.length} buffered utterance(s)`);
      const buffered = this.pendingFinals.splice(0);
      for (const f of buffered) await this.postFinal(f.participant, f.content, f.timestamp);
    }
  }

  /**
   * Pin the accepting agent (from the Connect agent-whisper flow). In deferred
   * mode this creates the conversation now, so Omnichannel routes it to — and
   * can auto-accept it for — that specific agent, then flushes buffered lines.
   */
  async setAgent(agentId: string): Promise<void> {
    if (this.ending) return;
    this.agentId = agentId;
    console.log(`[session:${this.input.contactId}] agent accepted -> ${agentId}`);
    await this.ensureConversationStarted();
  }

  private onAudio(track: number, pcm: Uint8Array): void {
    if (this.ending) return;
    this.armIdleTimer();
    let pipe = this.pipes.get(track);
    if (!pipe) {
      pipe = { buffer: [] };
      this.pipes.set(track, pipe);
      const participant = participantForTrack(track);
      SpeechStream.create(`${this.input.contactId}:${participant}`, {
        onFinal: (text) => this.onFinal(participant, text),
        onPartial: (text) =>
          console.log(`[session:${this.input.contactId}] ~${participant}: ${text}`),
      })
        .then((stream) => {
          if (this.ending) {
            stream.close().catch(() => {});
            return;
          }
          pipe!.stream = stream;
          for (const chunk of pipe!.buffer) stream.push(chunk);
          pipe!.buffer = [];
        })
        .catch((err) =>
          console.error(`[session:${this.input.contactId}] speech create failed`, err),
        );
    }
    if (pipe.stream) {
      pipe.stream.push(pcm);
    } else {
      pipe.buffer.push(pcm);
    }
  }

  private onFinal(participant: Participant, content: string): void {
    if (this.ending) return;
    const timestamp = new Date().toISOString();
    console.log(`[session:${this.input.contactId}] ${participant}: ${content}`);
    if (!this.conversationStarted) {
      // Deferred mode: hold utterances until the agent accepts and the
      // conversation is created, so nothing is lost and order is preserved.
      this.pendingFinals.push({ participant, content, timestamp });
      return;
    }
    void this.postFinal(participant, content, timestamp);
  }

  private async postFinal(participant: Participant, content: string, timestamp: string): Promise<void> {
    const { contactId, ani } = this.input;
    try {
      await ingestor.segment({
        contactId,
        participant,
        content,
        timestamp,
        ani,
        agentId: this.agentId,
      });
    } catch (err) {
      console.error(`[session:${contactId}] segment post failed`, err);
    }
  }

  /** Reset the "no audio for a while → call is over" timer. */
  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.end("idle"), env.idleEndMs);
  }

  async end(reason: string): Promise<void> {
    if (this.ending) return;
    this.ending = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const { contactId, ani } = this.input;
    console.log(`[session:${contactId}] ending (${reason})`);

    this.reader.stop();
    // Flush every recognizer so trailing finals still post before we close.
    await Promise.all(
      [...this.pipes.values()]
        .map((p) => p.stream?.close().catch(() => {}))
        .filter(Boolean),
    );
    this.pipes.clear();

    if (this.conversationStarted) {
      try {
        await ingestor.ended({ contactId, ani, agentId: this.agentId, timestamp: new Date().toISOString() });
      } catch (err) {
        console.error(`[session:${contactId}] ended post failed`, err);
      }
    } else {
      // Deferred mode and no agent ever accepted: never opened a live
      // conversation. The post-call S3 analysis path captures the transcript.
      console.log(
        `[session:${contactId}] ended before any agent accepted; no live conversation created`,
      );
    }
    onSessionEnd?.(contactId);
  }
}

// Registry so the HTTP layer can find/stop a live session by contactId.
const sessions = new Map<string, Session>();
let onSessionEnd: ((contactId: string) => void) | undefined;

export const sessionRegistry = {
  has: (contactId: string) => sessions.has(contactId),
  async start(input: StartSessionInput): Promise<void> {
    if (sessions.has(input.contactId)) {
      console.log(`[session:${input.contactId}] already running; ignoring duplicate start`);
      return;
    }
    const session = new Session(input);
    sessions.set(input.contactId, session);
    await session.start();
  },
  async stop(contactId: string): Promise<boolean> {
    const s = sessions.get(contactId);
    if (!s) return false;
    await s.end("explicit-stop");
    return true;
  },
  async setAgent(contactId: string, agentId: string): Promise<boolean> {
    const s = sessions.get(contactId);
    if (!s) return false;
    await s.setAgent(agentId);
    return true;
  },
  count: () => sessions.size,
};

onSessionEnd = (contactId: string) => sessions.delete(contactId);
