// Fail-fast environment configuration for the KVS live-transcription consumer.

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const env = {
  /** HTTP port the session-control API listens on. */
  get port(): number {
    return Number(process.env.PORT ?? "8080");
  },

  /** Shared secret required on POST /session/* (x-session-key header). */
  get sessionKey(): string | undefined {
    return process.env.SESSION_KEY || undefined;
  },

  // --- D365 ingestor (where finalised utterances go) ---
  /** HTTPS URL of the ingestor's transcript endpoint, e.g. https://.../api/transcript */
  get ingestorUrl(): string {
    return req("INGESTOR_URL");
  },
  /** x-ingestor-key header value for the ingestor. */
  get ingestorKey(): string {
    return req("INGESTOR_KEY");
  },

  // --- AWS (read the KVS media stream) ---
  get awsRegion(): string {
    return process.env.AWS_REGION ?? "us-east-1";
  },

  // --- Azure AI Speech ---
  // Key auth is disabled by org policy (disableLocalAuth=true), so we use
  // Microsoft Entra (managed identity) token auth. AZURE_SPEECH_KEY is optional
  // and only used as a fallback when a key is actually available.
  get speechKey(): string | undefined {
    return process.env.AZURE_SPEECH_KEY || undefined;
  },
  get speechRegion(): string {
    return req("AZURE_SPEECH_REGION");
  },
  /** Full ARM resource id of the Speech account (required for Entra token auth). */
  get speechResourceId(): string | undefined {
    return process.env.AZURE_SPEECH_RESOURCE_ID || undefined;
  },
  /** BCP-47 language for recognition. Default en-US. */
  get speechLanguage(): string {
    return process.env.AZURE_SPEECH_LANGUAGE ?? "en-US";
  },

  // --- Audio format of the Connect KVS tracks (PCM 8kHz/16-bit/mono per track) ---
  get sampleRateHz(): number {
    return Number(process.env.KVS_SAMPLE_RATE_HZ ?? "8000");
  },

  /**
   * If no audio arrives for this many milliseconds after the media stream ends,
   * treat the call as finished, close the recognizers, and end the conversation.
   */
  get idleEndMs(): number {
    return Number(process.env.KVS_IDLE_END_MS ?? "4000");
  },

  /**
   * When true, the D365 conversation is NOT created at call start. Instead it is
   * created when the accepting agent becomes known (POST /session/agent, sent by
   * the Connect agent-whisper flow), so Omnichannel routes it to — and can
   * auto-accept it for — that specific agent. Finalised utterances are buffered
   * until then. Defaults to false (legacy: create at call start) so existing
   * deployments are unaffected until the whisper-flow signal is wired.
   */
  get deferConversationUntilAgent(): boolean {
    return /^(1|true|yes)$/i.test(process.env.DEFER_CONVERSATION_UNTIL_AGENT ?? "");
  },

  /**
   * Maps an Amazon Connect username (e.g. "mauricio.agent") to the D365
   * systemuser id — or whatever token the workstream's context-routing rule keys
   * on — that should own the conversation. JSON object in CONNECT_AGENT_MAP,
   * e.g. {"mauricio.agent":"<systemuserid>"}. Unmapped usernames fall through
   * verbatim so a routing rule can still key on the raw Connect username.
   */
  get connectAgentMap(): Record<string, string> {
    const raw = process.env.CONNECT_AGENT_MAP;
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      console.warn("CONNECT_AGENT_MAP is not valid JSON; ignoring.");
      return {};
    }
  },
};
