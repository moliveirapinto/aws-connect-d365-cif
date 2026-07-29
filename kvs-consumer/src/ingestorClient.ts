// Posts lifecycle events and finalised transcript segments to the D365 ingestor.
// Mirrors the payload contract in ingestor/src/server.ts (kind: "lifecycle" | "segment").

import { env } from "./env.js";

export type Participant = "CUSTOMER" | "AGENT";

export interface TranscriptSegment {
  contactId: string;
  participant: Participant;
  content: string;
  timestamp: string;
  ani?: string;
  agentId?: string;
}

export interface CallLifecycle {
  contactId: string;
  ani?: string;
  agentId?: string;
  event: "started" | "ended";
  timestamp: string;
}

type Payload =
  | { kind: "segment"; data: TranscriptSegment }
  | { kind: "lifecycle"; data: CallLifecycle };

// The ingestor tolerates bursts poorly (Direct Line 429s), and a network blip
// shouldn't drop an utterance. Retry transient failures with light backoff.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function post(payload: Payload): Promise<void> {
  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(env.ingestorUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ingestor-key": env.ingestorKey,
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) return;
      lastErr = `${res.status} ${await res.text().catch(() => "<no body>")}`;
      if (!RETRYABLE.has(res.status) || attempt === MAX_ATTEMPTS) {
        throw new Error(`Ingestor POST failed: ${lastErr}`);
      }
    } catch (err) {
      lastErr = String(err);
      if (attempt === MAX_ATTEMPTS) throw new Error(`Ingestor POST failed: ${lastErr}`);
    }
    await sleep(Math.min(4000, 400 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 150));
  }
}

export const ingestor = {
  started: (data: Omit<CallLifecycle, "event">) =>
    post({ kind: "lifecycle", data: { ...data, event: "started" } }),
  ended: (data: Omit<CallLifecycle, "event">) =>
    post({ kind: "lifecycle", data: { ...data, event: "ended" } }),
  segment: (data: TranscriptSegment) => post({ kind: "segment", data }),
};
