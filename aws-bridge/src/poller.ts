// Poller Lambda — for one live contact, repeatedly reads Contact Lens real-time
// analysis segments and fans each *new* finalized transcript utterance out to:
//   1) the D365 ingestor (-> Omnichannel conversation -> native Copilot agents)
//   2) the CIF agent widget via the WebSocket API
//
// Contact Lens does the ASR/sentiment, so we reuse AWS's transcription instead of
// running our own. The loop self-re-invokes to survive the Lambda time limit and
// stops when the contact row disappears (set by the lifecycle "ended" event).

import {
  ConnectContactLensClient,
  ListRealtimeContactAnalysisSegmentsCommand,
  type RealtimeContactAnalysisSegment,
} from "@aws-sdk/client-connect-contact-lens";
import { LambdaClient, InvokeCommand, InvocationType } from "@aws-sdk/client-lambda";
import { env } from "./env.js";
import { ingestor } from "./ingestorClient.js";
import { broadcastSegment } from "./ws.js";
import { getActive, putActive } from "./store.js";
import type { ActiveContact, Participant, TranscriptSegment } from "./types.js";

const cl = new ConnectContactLensClient({});
const SEEN_CAP = 500;
const TIME_BUDGET_MS = 13 * 60 * 1000; // re-invoke before the 15-min Lambda cap

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mapSentiment(s?: string): TranscriptSegment["sentiment"] {
  if (s === "POSITIVE" || s === "NEGATIVE" || s === "NEUTRAL") return s;
  return undefined; // MIXED / undefined -> leave unset
}

function mapRole(role?: string): Participant | undefined {
  if (role === "CUSTOMER" || role === "AGENT") return role;
  return undefined; // skip SYSTEM / bot prompts
}

/** Read every transcript segment in the current snapshot (paging through). */
async function readAllSegments(
  instanceId: string,
  contactId: string
): Promise<RealtimeContactAnalysisSegment[]> {
  const out: RealtimeContactAnalysisSegment[] = [];
  let token: string | undefined;
  do {
    const res = await cl.send(
      new ListRealtimeContactAnalysisSegmentsCommand({
        InstanceId: instanceId,
        ContactId: contactId,
        MaxResults: 100,
        NextToken: token,
      })
    );
    out.push(...(res.Segments ?? []));
    token = res.NextToken;
  } while (token);
  return out;
}

async function pollOnce(active: ActiveContact): Promise<ActiveContact> {
  const segments = await readAllSegments(active.instanceId, active.contactId);
  const seen = new Set(active.seen);
  const fresh: TranscriptSegment[] = [];

  for (const s of segments) {
    const t = s.Transcript;
    if (!t?.Id || !t.Content) continue;
    if (seen.has(t.Id)) continue;
    const participant = mapRole(t.ParticipantRole);
    if (!participant) {
      seen.add(t.Id);
      continue;
    }
    seen.add(t.Id);
    fresh.push({
      contactId: active.contactId,
      participant,
      content: t.Content,
      timestamp: new Date().toISOString(),
      sentiment: mapSentiment(t.Sentiment),
      ani: active.ani,
      agentId: active.agentId,
    });
  }

  // Forward newest utterances in order; failures on one shouldn't block others.
  for (const seg of fresh) {
    await Promise.allSettled([ingestor.segment(seg), broadcastSegment(seg)]);
  }

  const trimmed = Array.from(seen).slice(-SEEN_CAP);
  const updated: ActiveContact = { ...active, seen: trimmed };
  await putActive(updated);
  return updated;
}

export async function handler(event: { contactId: string }): Promise<{ ok: boolean }> {
  const start = Date.now();
  let active = await getActive(event.contactId);
  if (!active) return { ok: true }; // already ended

  while (Date.now() - start < TIME_BUDGET_MS) {
    const current = await getActive(event.contactId);
    if (!current) return { ok: true }; // call ended -> stop
    try {
      active = await pollOnce(current);
    } catch (err) {
      console.error("poll error", event.contactId, err);
    }
    await sleep(env.pollIntervalMs);
  }

  // Still live at budget end -> hand off to a fresh invocation.
  const lambda = new LambdaClient({});
  await lambda.send(
    new InvokeCommand({
      FunctionName: env.pollerFunctionName,
      InvocationType: InvocationType.Event,
      Payload: Buffer.from(JSON.stringify({ contactId: event.contactId })),
    })
  );
  return { ok: true };
}
