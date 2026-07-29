// S3-triggered Lambda — the reliable transcript path.
//
// On this Amazon Connect instance the Contact Lens *real-time* analysis API
// (ListRealtimeContactAnalysisSegments) never yields segments (404 for the whole
// call), so the poller can't stream a live transcript. Contact Lens *post-call*
// analysis, however, always lands a complete transcript JSON in S3 a minute or
// two after the call ends, at:
//   Analysis/Voice/<yyyy>/<mm>/<dd>/<contactId>_analysis_<ts>.json
//
// This function is invoked by an S3 ObjectCreated notification on that prefix.
// It reads the analysis, enriches it with the caller ANI + agent (DescribeContact),
// and posts the whole transcript to the D365 ingestor in ONE atomic request so a
// single Omnichannel conversation is created with the full transcript and closed
// (which is what the native Copilot summary/intent/case agents run on).

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { ConnectClient, DescribeContactCommand } from "@aws-sdk/client-connect";
import { ingestor } from "./ingestorClient.js";
import { broadcastSegments, broadcastEnded } from "./ws.js";
import type { Participant, TranscriptSegment } from "./types.js";

const s3 = new S3Client({});
const connect = new ConnectClient({});

interface ContactLensAnalysis {
  CustomerMetadata?: { ContactId?: string; InstanceId?: string };
  Participants?: Array<{ ParticipantId?: string; ParticipantRole?: string }>;
  Transcript?: Array<{
    Id?: string;
    ParticipantId?: string;
    Content?: string;
    BeginOffsetMillis?: number;
    Sentiment?: string;
  }>;
}

interface S3Event {
  Records?: Array<{ s3?: { bucket?: { name?: string }; object?: { key?: string } } }>;
}

function mapSentiment(s?: string): TranscriptSegment["sentiment"] {
  if (s === "POSITIVE" || s === "NEGATIVE" || s === "NEUTRAL") return s;
  return undefined; // MIXED / undefined -> leave unset
}

function mapRole(role?: string): Participant | undefined {
  if (role === "CUSTOMER" || role === "AGENT") return role;
  return undefined; // skip SYSTEM / bot prompts
}

/** Recover the contactId from the analysis key as a fallback. */
function contactIdFromKey(key: string): string | undefined {
  const file = key.split("/").pop() ?? "";
  const m = file.match(/^([0-9a-f-]{36})_analysis_/i);
  return m ? m[1] : undefined;
}

async function enrich(
  instanceId: string | undefined,
  contactId: string
): Promise<{ ani?: string; agentId?: string }> {
  if (!instanceId) return {};
  try {
    const res = await connect.send(
      new DescribeContactCommand({ InstanceId: instanceId, ContactId: contactId })
    );
    return {
      ani: res.Contact?.CustomerEndpoint?.Address,
      agentId: res.Contact?.AgentInfo?.Id,
    };
  } catch (err) {
    console.warn("DescribeContact failed for", contactId, err);
    return {};
  }
}

async function processObject(bucket: string, key: string): Promise<void> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const text = await obj.Body!.transformToString();
  const analysis = JSON.parse(text) as ContactLensAnalysis;

  const contactId = analysis.CustomerMetadata?.ContactId ?? contactIdFromKey(key);
  if (!contactId) {
    console.error("Could not determine contactId for", key);
    return;
  }
  const instanceId = analysis.CustomerMetadata?.InstanceId;
  const { ani, agentId } = await enrich(instanceId, contactId);

  const roleById = new Map(
    (analysis.Participants ?? []).map((p) => [p.ParticipantId, p.ParticipantRole])
  );

  const ordered = (analysis.Transcript ?? [])
    .slice()
    .sort((a, b) => (a.BeginOffsetMillis ?? 0) - (b.BeginOffsetMillis ?? 0));

  const segments: TranscriptSegment[] = [];
  for (const t of ordered) {
    if (!t.Content) continue;
    const participant = mapRole(roleById.get(t.ParticipantId) ?? t.ParticipantId);
    if (!participant) continue;
    segments.push({
      contactId,
      participant,
      content: t.Content,
      timestamp: new Date().toISOString(),
      sentiment: mapSentiment(t.Sentiment),
      ani,
      agentId,
    });
  }

  if (segments.length === 0) {
    console.log("No usable transcript segments for", contactId, "from", key);
    return;
  }

  await ingestor.transcript({ contactId, ani, agentId, segments });
  console.log(`Posted transcript for ${contactId}: ${segments.length} segments`);

  // Feed the accepting agent's live CIF panel with the full transcript, then
  // signal `ended` so the widget opens the freshly-created D365 conversation on
  // itself. Both reach only the widget(s) subscribed to this contactId (the
  // agent who accepted). Best-effort — never fail the ingest over a UI push.
  try {
    await broadcastSegments(segments);
    await broadcastEnded(contactId);
  } catch (err) {
    console.warn("widget push (segments/ended) failed for", contactId, err);
  }
}

export async function handler(event: S3Event): Promise<{ ok: boolean }> {
  for (const rec of event.Records ?? []) {
    const bucket = rec.s3?.bucket?.name;
    const rawKey = rec.s3?.object?.key;
    if (!bucket || !rawKey) continue;
    // S3 URL-encodes keys and turns spaces into '+'.
    const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
    await processObject(bucket, key);
  }
  return { ok: true };
}
