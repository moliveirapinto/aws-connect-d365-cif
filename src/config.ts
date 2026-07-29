// Runtime configuration. In Azure Static Web Apps these are injected at build
// time from environment variables (VITE_*). Never put secrets here — this code
// runs in the agent's browser.

export const config = {
  /** Your D365 org url, e.g. https://contoso.crm.dynamics.com */
  d365OrgUrl: import.meta.env.VITE_D365_ORG_URL ?? "",

  /** Amazon Connect CCP url, e.g. https://contoso.my.connect.aws/ccp-v2/ */
  connectCcpUrl: import.meta.env.VITE_CONNECT_CCP_URL ?? "",

  /** Amazon Connect instance region, e.g. us-east-1 */
  connectRegion: import.meta.env.VITE_CONNECT_REGION ?? "us-east-1",

  /**
   * API Gateway WebSocket url that streams live transcript segments from the
   * AWS bridge (Contact Lens real-time -> Lambda -> WebSocket).
   * e.g. wss://xxxx.execute-api.us-east-1.amazonaws.com/prod
   */
  transcriptWsUrl: import.meta.env.VITE_TRANSCRIPT_WS_URL ?? "",

  /** Logical name of the Dataverse table used to screen-pop on inbound ANI. */
  screenPopEntity: import.meta.env.VITE_SCREENPOP_ENTITY ?? "contact",

  /** Column on that table holding the phone number to match. */
  screenPopPhoneColumn:
    import.meta.env.VITE_SCREENPOP_PHONE_COLUMN ?? "telephone1",
} as const;

export type AppConfig = typeof config;
