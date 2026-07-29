// Turns AWS transcript segments into a D365 Omnichannel conversation carrying a
// live transcript. That conversation is what the native Copilot agents
// (Conversation Summary, Intent, Case Management Agent) run on.
//
// Mechanism: the org's Custom Messaging channel is backed by an Azure Bot with
// the Direct Line 3.0 channel enabled. This ingestor is the Direct Line *client*:
// it opens one Direct Line conversation per Amazon Connect call and streams each
// finalised utterance in as a message activity. The Azure Bot relays those into
// Omnichannel, which auto-creates the conversation (no human accept needed) and
// runs Copilot on the resulting transcript.
//
// Direct Line REST:
// https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-direct-line-3-0-concepts

import type { CallLifecycle, FullTranscript, TranscriptSegment } from "./types.js";

export interface OmnichannelConfig {
  /** Direct Line secret from the Azure Bot's Direct Line channel. */
  directLineSecret: string;
  /** Direct Line base URL, e.g. https://directline.botframework.com/v3/directline */
  directLineDomain: string;
  /** Logical channel id, echoed in channelData as `channelType` for the relay bot / attribution. */
  channelId: string;
  /**
   * Optional static routing context merged into every activity's
   * `conversationcontext`. Omnichannel matches these key/value pairs against the
   * workstream's context-variable routing rules to place the conversation on the
   * right queue (instead of the default messaging queue). Configure the matching
   * rule in the workstream, e.g. { source: "AmazonConnect" }.
   */
  conversationContext?: Record<string, string>;
}

interface ConversationHandle {
  conversationId: string;
  /** Per-conversation Direct Line token returned by StartConversation. */
  token: string;
  /** Epoch ms when `token` expires; we refresh before it lapses. */
  expiresAt: number;
}

interface DirectLineActivity {
  type: "message" | "event" | "endOfConversation";
  from: { id: string; name?: string; role?: "user" };
  text?: string;
  name?: string;
  code?: string;
  timestamp?: string;
  channelData?: Record<string, unknown>;
  value?: unknown;
}

/** Maps a live Amazon Connect contactId -> its Direct Line conversation. */
const conversations = new Map<string, ConversationHandle>();

export class OmnichannelClient {
  constructor(private cfg: OmnichannelConfig) {
    if (!cfg.directLineSecret) throw new Error("directLineSecret is required.");
  }

  private get base(): string {
    return this.cfg.directLineDomain.replace(/\/+$/, "");
  }

  /**
   * Builds the channelData block Omnichannel reads to (a) resolve the caller's
   * contact record via `customercontext` (so the conversation is the caller, not
   * "Visitor N") and (b) route via `conversationcontext` (so it lands on the
   * right workstream queue, not the default messaging queue). Shape follows the
   * "bring your own channel" contract:
   * https://learn.microsoft.com/dynamics365/customer-service/develop/bring-your-own-channel
   */
  private buildChannelData(
    evt: CallLifecycle | TranscriptSegment,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const customercontext: Record<string, string> = {};
    if (evt.ani) customercontext.phonenumber = evt.ani;

    const conversationcontext: Record<string, string> = {
      source: "AmazonConnect",
      contactId: evt.contactId,
      ...(evt.agentId ? { agentId: evt.agentId } : {}),
      ...(this.cfg.conversationContext ?? {}),
    };

    return {
      channelType: this.cfg.channelId,
      source: "amazon-connect",
      contactId: evt.contactId,
      ani: evt.ani,
      agentId: evt.agentId,
      customercontext,
      conversationcontext,
      ...extra,
    };
  }

  /** Create (once) the Direct Line conversation for a call and seed its context. */
  async ensureConversation(evt: CallLifecycle | TranscriptSegment): Promise<string> {
    const existing = conversations.get(evt.contactId);
    if (existing) return existing.conversationId;

    const handle = await this.startConversation();
    conversations.set(evt.contactId, handle);

    // Seed customer/routing context so Omnichannel resolves the caller's contact
    // record and routes the conversation without a human touching it.
    await this.postActivity(handle, {
      type: "event",
      name: "connect/context",
      from: { id: `system:${evt.contactId}`, name: evt.ani ?? "Amazon Connect caller", role: "user" },
      channelData: this.buildChannelData(evt),
    });

    return handle.conversationId;
  }

  /** Post one finalised utterance into the conversation as a transcript turn. */
  async postTranscriptMessage(seg: TranscriptSegment): Promise<void> {
    await this.ensureConversation(seg);
    const handle = conversations.get(seg.contactId)!;

    const isCustomer = seg.participant === "CUSTOMER";
    await this.postActivity(handle, {
      type: "message",
      text: seg.content,
      timestamp: seg.timestamp,
      from: isCustomer
        ? { id: `customer:${seg.contactId}`, name: seg.ani ?? "Customer", role: "user" }
        : { id: `agent:${seg.agentId ?? seg.contactId}`, name: "Agent", role: "user" },
      // customercontext/conversationcontext are carried on every turn so they are
      // present on the very message that triggers conversation creation in OC.
      channelData: this.buildChannelData(seg, {
        participant: seg.participant,
        sentiment: seg.sentiment,
      }),
    });
  }

  /**
   * Post a whole post-call transcript as one conversation, atomically: open a
   * fresh Direct Line conversation, seed caller/routing context, stream every
   * finalised utterance in order, then close it so summary/wrap-up Copilot runs.
   * Used by the S3 post-call analysis path (the real-time path never yields
   * segments on this Connect instance).
   */
  async postFullTranscript(t: FullTranscript): Promise<void> {
    const seed: TranscriptSegment = {
      contactId: t.contactId,
      participant: "CUSTOMER",
      content: "",
      timestamp: new Date().toISOString(),
      ani: t.ani,
      agentId: t.agentId,
    };
    // Create + seed the conversation (customer/routing context on the context event).
    await this.ensureConversation(seed);
    // Stream each finalised utterance; ensureConversation inside reuses the handle.
    for (const seg of t.segments) {
      await this.postTranscriptMessage(seg);
    }
    // Close so Omnichannel runs summary/intent/case Copilot on the full transcript.
    await this.endConversation({
      contactId: t.contactId,
      ani: t.ani,
      agentId: t.agentId,
      event: "ended",
      timestamp: new Date().toISOString(),
    });
  }

  /** Close the conversation when the AWS call ends so summary/wrap-up runs. */
  async endConversation(evt: CallLifecycle): Promise<void> {
    const handle = conversations.get(evt.contactId);
    if (!handle) return;
    await this.postActivity(handle, {
      type: "endOfConversation",
      code: "completedSuccessfully",
      from: { id: `system:${evt.contactId}`, role: "user" },
      channelData: { contactId: evt.contactId, source: "amazon-connect" },
    });
    conversations.delete(evt.contactId);
  }

  // --- Direct Line 3.0 plumbing ---

  private async startConversation(): Promise<ConversationHandle> {
    const res = await dlFetch(
      `${this.base}/conversations`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.cfg.directLineSecret}` },
      },
      "StartConversation",
    );
    const body = (await res.json()) as {
      conversationId: string;
      token: string;
      expires_in?: number;
    };
    return {
      conversationId: body.conversationId,
      token: body.token,
      expiresAt: Date.now() + (body.expires_in ?? 1800) * 1000,
    };
  }

  private async refreshTokenIfNeeded(handle: ConversationHandle): Promise<void> {
    // Refresh with a 60s safety margin.
    if (Date.now() < handle.expiresAt - 60_000) return;
    const res = await dlFetch(
      `${this.base}/tokens/refresh`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${handle.token}` },
      },
      "token refresh",
    );
    const body = (await res.json()) as { token: string; expires_in?: number };
    handle.token = body.token;
    handle.expiresAt = Date.now() + (body.expires_in ?? 1800) * 1000;
  }

  private async postActivity(handle: ConversationHandle, activity: DirectLineActivity): Promise<void> {
    await this.refreshTokenIfNeeded(handle);
    await dlFetch(
      `${this.base}/conversations/${handle.conversationId}/activities`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${handle.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(activity),
      },
      "PostActivity",
    );
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}

// Direct Line rate-limits bursts (HTTP 429 "Too Many Requests") and can return
// transient 5xx. StartConversation is immediately followed by a context-event
// PostActivity, which is exactly the kind of back-to-back burst that trips the
// per-second limit. Retry those with backoff, honouring any Retry-After header,
// so a single call reliably lands its conversation + transcript.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function backoffMs(attempt: number): number {
  const base = Math.min(8000, 500 * 2 ** (attempt - 1)); // 0.5s,1s,2s,4s,8s
  return base + Math.floor(Math.random() * 250); // jitter
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.min(10_000, secs * 1000);
  const when = Date.parse(header);
  if (!Number.isNaN(when)) return Math.max(0, Math.min(10_000, when - Date.now()));
  return undefined;
}

async function dlFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`Direct Line ${label} failed: network error ${String(err)}`);
      }
      await sleep(backoffMs(attempt));
      continue;
    }
    if (res.ok) return res;
    lastStatus = res.status;
    lastBody = await safeText(res);
    if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) {
      throw new Error(`Direct Line ${label} failed: ${res.status} ${lastBody}`);
    }
    await sleep(parseRetryAfter(res.headers.get("retry-after")) ?? backoffMs(attempt));
  }
  throw new Error(`Direct Line ${label} failed: ${lastStatus} ${lastBody}`);
}
