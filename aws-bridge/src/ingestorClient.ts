// Posts transcript segments and lifecycle events to the D365 ingestor Function.

import { env } from "./env.js";
import type { CallLifecycle, FullTranscript, TranscriptSegment } from "./types.js";

type Payload =
  | { kind: "segment"; data: TranscriptSegment }
  | { kind: "lifecycle"; data: CallLifecycle }
  | { kind: "transcript"; data: FullTranscript };

async function post(payload: Payload): Promise<void> {
  const res = await fetch(env.ingestorUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ingestor-key": env.ingestorKey,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(`Ingestor POST failed: ${res.status} ${text}`);
  }
}

export const ingestor = {
  segment: (data: TranscriptSegment) => post({ kind: "segment", data }),
  lifecycle: (data: CallLifecycle) => post({ kind: "lifecycle", data }),
  transcript: (data: FullTranscript) => post({ kind: "transcript", data }),
};
