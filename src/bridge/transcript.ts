// WebSocket client for the AWS transcription bridge.
// The bridge (Contact Lens real-time -> Lambda -> API Gateway WebSocket) pushes
// transcript segments keyed by Amazon Connect contactId. We subscribe with the
// active contactId and stream segments into the UI.

import { config } from "../config";

export type TranscriptSegment = {
  contactId: string;
  /** "CUSTOMER" | "AGENT" */
  participant: string;
  content: string;
  sentiment?: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  /** true while the segment is still being finalised (partial result) */
  partial?: boolean;
  offsetMs?: number;
};

export type SuggestionEvent = {
  contactId: string;
  /** Azure OpenAI generated agent assist text produced by the bridge. */
  suggestion: string;
};

type Handlers = {
  onSegment?: (s: TranscriptSegment) => void;
  onSuggestion?: (s: SuggestionEvent) => void;
  onStatus?: (open: boolean) => void;
  /** Fires when the bridge routes a contact to THIS agent (accept event). */
  onAssigned?: (contactId: string) => void;
  /** Fires when a contact assigned to THIS agent ends. */
  onEnded?: (contactId: string) => void;
};

export class TranscriptBridge {
  private ws?: WebSocket;
  private contactId?: string;
  private agentUpn?: string;
  private handlers: Handlers = {};
  private reconnectTimer?: number;

  connect(handlers: Handlers): void {
    this.handlers = handlers;
    this.open();
  }

  /**
   * Declare which agent this browser session belongs to. The bridge server uses
   * this (matched against Amazon Connect's agent identity by SSO email) to push
   * `assigned`/`ended` for exactly the contacts this agent accepts — the
   * per-agent, queue-free routing, with no maintained identity map.
   */
  identify(agentUpn: string): void {
    this.agentUpn = agentUpn;
    this.send({ action: "identify", agentUpn });
  }

  subscribe(contactId: string): void {
    this.contactId = contactId;
    this.send({ action: "subscribe", contactId });
  }

  unsubscribe(): void {
    if (this.contactId) this.send({ action: "unsubscribe", contactId: this.contactId });
    this.contactId = undefined;
  }

  private open(): void {
    if (!config.transcriptWsUrl) return;
    this.ws = new WebSocket(config.transcriptWsUrl);

    this.ws.onopen = () => {
      this.handlers.onStatus?.(true);
      // Re-declare identity and re-subscribe after a reconnect.
      if (this.agentUpn) this.send({ action: "identify", agentUpn: this.agentUpn });
      if (this.contactId) this.subscribe(this.contactId);
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string);
        if (msg.type === "segment") this.handlers.onSegment?.(msg.data as TranscriptSegment);
        else if (msg.type === "suggestion")
          this.handlers.onSuggestion?.(msg.data as SuggestionEvent);
        else if (msg.type === "assigned")
          this.handlers.onAssigned?.((msg.data as { contactId: string }).contactId);
        else if (msg.type === "ended")
          this.handlers.onEnded?.((msg.data as { contactId: string }).contactId);
      } catch {
        /* ignore malformed frames */
      }
    };

    this.ws.onclose = () => {
      this.handlers.onStatus?.(false);
      this.scheduleReconnect();
    };
    this.ws.onerror = () => this.ws?.close();
  }

  private scheduleReconnect(): void {
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.open(), 2000);
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  dispose(): void {
    window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
