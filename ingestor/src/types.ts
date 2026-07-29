// Shape of a normalised transcript segment coming from the AWS side.
// The AWS bridge maps Amazon Connect Contact Lens real-time segments onto this.

export type Participant = "CUSTOMER" | "AGENT";

export interface TranscriptSegment {
  /** Amazon Connect contact id — the correlation key for the whole call. */
  contactId: string;
  participant: Participant;
  /** Finalised utterance text. Only send finals here, not partials. */
  content: string;
  /** ISO timestamp of the utterance. */
  timestamp: string;
  sentiment?: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  /** Caller ANI, present at least on the first segment so we can screen-pop/route. */
  ani?: string;
  /** Optional: the D365 agent (systemuser) that should own the conversation. */
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
 * A complete, post-call transcript delivered in one shot (from Amazon Connect
 * Contact Lens post-call analysis in S3). Unlike the per-utterance `segment`
 * path, this creates the conversation, streams every utterance, and closes it
 * atomically inside a single ingestor invocation — so it can't fragment across
 * container replicas and doesn't depend on any in-memory real-time state.
 */
export interface FullTranscript {
  contactId: string;
  ani?: string;
  agentId?: string;
  segments: TranscriptSegment[];
}
