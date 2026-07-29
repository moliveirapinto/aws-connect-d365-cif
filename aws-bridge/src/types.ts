// Shapes shared across the AWS bridge. These mirror the ingestor's contract
// (ingestor/src/types.ts) so a segment posted here lands cleanly in D365.

export type Participant = "CUSTOMER" | "AGENT";

export interface TranscriptSegment {
  contactId: string;
  participant: Participant;
  content: string;
  timestamp: string;
  sentiment?: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
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

/**
 * A complete post-call transcript (from Contact Lens post-call analysis in S3),
 * delivered to the ingestor in one atomic request that creates the conversation,
 * streams every utterance, and closes it. Mirrors the ingestor's FullTranscript.
 */
export interface FullTranscript {
  contactId: string;
  ani?: string;
  agentId?: string;
  segments: TranscriptSegment[];
}

/** A row in the "active contacts" DynamoDB table while a call is live. */
export interface ActiveContact {
  contactId: string;
  instanceId: string;
  ani?: string;
  agentId?: string;
  /** Contact Lens paging cursor for incremental segment reads. */
  nextToken?: string;
  /** Ids of segments already forwarded, so we never double-post. */
  seen: string[];
  startedAt: string;
  /** TTL (epoch seconds) so stale rows self-clean. */
  ttl: number;
}
