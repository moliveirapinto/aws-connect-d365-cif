// Thin wrapper around the Azure AI Speech SDK for real-time streaming
// recognition from a raw-PCM push stream. One instance handles ONE audio track
// (one call participant). Feed it PCM bytes with push(); it invokes onFinal for
// every finalised utterance (and onPartial for interim hypotheses, if provided).
//
// Auth: the subscription disables Cognitive Services key auth, so we use
// Microsoft Entra tokens from the container's managed identity
// (SpeechConfig.fromAuthorizationToken) and refresh them periodically. A plain
// key (AZURE_SPEECH_KEY) is honoured as a local/dev fallback when present.

import {
  AudioConfig,
  AudioInputStream,
  AudioStreamFormat,
  type PushAudioInputStream,
  ResultReason,
  SpeechConfig,
  SpeechRecognizer,
} from "microsoft-cognitiveservices-speech-sdk";
import { env } from "./env.js";
import { getSpeechAuthToken } from "./speechAuth.js";

export interface SpeechCallbacks {
  /** Called for each finalised utterance (this is what we send to D365). */
  onFinal: (text: string) => void;
  /** Optional: interim hypotheses (not sent to D365, useful for logging). */
  onPartial?: (text: string) => void;
}

// Refresh the Entra authorization token well within its ~60-min lifetime so long
// calls keep transcribing.
const TOKEN_REFRESH_MS = 8 * 60 * 1000;

export class SpeechStream {
  private pushStream!: PushAudioInputStream;
  private recognizer!: SpeechRecognizer;
  private refreshTimer?: NodeJS.Timeout;
  private closed = false;

  private constructor(private readonly label: string) {}

  static async create(label: string, cb: SpeechCallbacks): Promise<SpeechStream> {
    const self = new SpeechStream(label);
    await self.init(cb);
    return self;
  }

  private async init(cb: SpeechCallbacks): Promise<void> {
    let speechConfig: SpeechConfig;
    if (env.speechKey) {
      speechConfig = SpeechConfig.fromSubscription(env.speechKey, env.speechRegion);
    } else {
      const token = await getSpeechAuthToken();
      speechConfig = SpeechConfig.fromAuthorizationToken(token, env.speechRegion);
    }
    speechConfig.speechRecognitionLanguage = env.speechLanguage;

    // Connect KVS tracks are PCM: signed 16-bit little-endian, mono, 8 kHz.
    const format = AudioStreamFormat.getWaveFormatPCM(env.sampleRateHz, 16, 1);
    this.pushStream = AudioInputStream.createPushStream(format);
    const audioConfig = AudioConfig.fromStreamInput(this.pushStream);

    this.recognizer = new SpeechRecognizer(speechConfig, audioConfig);

    if (cb.onPartial) {
      this.recognizer.recognizing = (_s, e) => {
        if (e.result.reason === ResultReason.RecognizingSpeech && e.result.text) {
          cb.onPartial!(e.result.text);
        }
      };
    }
    this.recognizer.recognized = (_s, e) => {
      if (e.result.reason === ResultReason.RecognizedSpeech) {
        const text = e.result.text?.trim();
        if (text) cb.onFinal(text);
      }
    };
    this.recognizer.canceled = (_s, e) => {
      console.warn(`[speech:${this.label}] canceled: ${e.reason} ${e.errorDetails ?? ""}`);
    };

    if (!env.speechKey) {
      this.refreshTimer = setInterval(() => {
        getSpeechAuthToken()
          .then((t) => {
            if (!this.closed) this.recognizer.authorizationToken = t;
          })
          .catch((err) => console.error(`[speech:${this.label}] token refresh failed`, err));
      }, TOKEN_REFRESH_MS);
    }

    await new Promise<void>((resolve) => {
      this.recognizer.startContinuousRecognitionAsync(
        () => {
          console.log(`[speech:${this.label}] recognition started`);
          resolve();
        },
        (err) => {
          console.error(`[speech:${this.label}] failed to start: ${err}`);
          resolve();
        },
      );
    });
  }

  /** Feed a chunk of raw PCM audio (as it arrives from KVS). */
  push(pcm: Uint8Array): void {
    if (this.closed) return;
    // The SDK's push stream wants an ArrayBuffer.
    const ab = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
    this.pushStream.write(ab as ArrayBuffer);
  }

  /** Flush and stop recognition; safe to call once. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    try {
      this.pushStream.close();
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      this.recognizer.stopContinuousRecognitionAsync(
        () => {
          this.recognizer.close();
          resolve();
        },
        () => {
          this.recognizer.close();
          resolve();
        },
      );
    });
  }
}
