// Environment configuration for the bridge Lambdas. Fail fast on missing values.

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const env = {
  /** HTTPS URL of the D365 ingestor Function's `transcript` endpoint. */
  get ingestorUrl(): string {
    return req("INGESTOR_URL");
  },
  /** Function-level key for the ingestor (x-functions-key header). */
  get ingestorKey(): string {
    return req("INGESTOR_KEY");
  },
  /** API Gateway Management endpoint for the WebSocket API (for posting to connections). */
  get wsApiEndpoint(): string {
    return req("WS_API_ENDPOINT");
  },
  /** DynamoDB table mapping WebSocket connectionId -> subscribed contactId. */
  get connectionsTable(): string {
    return req("CONNECTIONS_TABLE");
  },
  /** DynamoDB table of live contacts being polled. */
  get activeTable(): string {
    return req("ACTIVE_TABLE");
  },
  /** Amazon Connect instance id — used to resolve an agent's SSO email. */
  get connectInstanceId(): string {
    return req("CONNECT_INSTANCE_ID");
  },
  /** Name of the poller Lambda (for self re-invocation while a call is live). */
  get pollerFunctionName(): string {
    return req("POLLER_FUNCTION_NAME");
  },
  /** Poll cadence in ms (near real-time). Default 1500. */
  get pollIntervalMs(): number {
    return Number(process.env.POLL_INTERVAL_MS ?? "1500");
  },
};
