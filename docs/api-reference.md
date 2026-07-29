# API & protocol reference

All wire contracts and configuration for the integration. **No real secret values
appear here** — every credential is a placeholder supplied via environment
variables.

## WebSocket protocol (widget ↔ bridge)

Endpoint: the API Gateway WebSocket `wss://.../prod` (widget `VITE_TRANSCRIPT_WS_URL`).

### Client → server (routes)

Each message is JSON with an `action`:

| Action | Payload | Effect |
|---|---|---|
| `identify` | `{ "action": "identify", "agentUpn": "<agent email>" }` | Binds this connection to the agent's SSO email (normalised). Sets up `byAgent` routing. |
| `subscribe` | `{ "action": "subscribe", "contactId": "<id>" }` | Subscribes this connection to a call's segments/ended. Sets up `byContact` routing. |
| `unsubscribe` | `{ "action": "unsubscribe" }` | Removes the `contactId` binding. |

`$connect` / `$disconnect` are handled implicitly (register / remove the row).

### Server → client (frames)

Each frame is JSON `{ "type": ..., "data": ... }`:

| `type` | `data` | When |
|---|---|---|
| `assigned` | `{ "contactId": "<id>" }` | A contact was routed to **this** agent (accept). |
| `segment` | `TranscriptSegment` | A transcript turn for a subscribed contact. |
| `suggestion` | `{ "contactId": "<id>", "suggestion": "<text>" }` | (Optional) agent-assist text. |
| `ended` | `{ "contactId": "<id>" }` | A subscribed call ended (widget opens the conversation). |

`TranscriptSegment`:

```jsonc
{
  "contactId": "string",
  "participant": "CUSTOMER" | "AGENT",
  "content": "string",
  "timestamp": "ISO-8601",
  "sentiment": "POSITIVE" | "NEGATIVE" | "NEUTRAL",   // optional
  "partial": false,                                    // optional (still finalising)
  "offsetMs": 0,                                       // optional
  "ani": "+1...",                                      // optional
  "agentId": "string"                                  // optional
}
```

The client re-sends `identify` and re-`subscribe`s automatically on reconnect
(2 s backoff).

## Ingestor HTTP contract

Base: the ingestor Container App URL. Auth: `x-ingestor-key: <INGESTOR_KEY>`
(enforced only when `INGESTOR_KEY` is set).

| Method | Path | Body | Result |
|---|---|---|---|
| `GET` | `/` | — | `200 ok` (health). |
| `POST` | `/api/transcript` | one of the payloads below | `202 {ok:true}` / `400` / `401` / `500`. |

Payload kinds:

```jsonc
// Lifecycle — open/close a conversation
{ "kind": "lifecycle", "data": { "contactId": "...", "ani": "+1...", "event": "started" | "ended", "timestamp": "ISO" } }

// Single segment — append one turn
{ "kind": "segment", "data": { /* TranscriptSegment */ } }

// Full transcript — atomic: create one conversation with all turns, then close
{ "kind": "transcript", "data": { "contactId": "...", "ani": "+1...", "agentId": "...", "segments": [ /* TranscriptSegment[] */ ] } }
```

- `lifecycle` `started` → `ensureConversation`; `ended` → `endConversation`.
- `transcript` → `postFullTranscript` (the primary post-call path uses this).
- `segment` → `postTranscriptMessage` (the live KVS path uses this).

## KVS-consumer session API

Base: the KVS-consumer Container App URL. Auth: `x-session-key: <SESSION_KEY>`
(enforced only when `SESSION_KEY` is set).

| Method | Path | Body | Result |
|---|---|---|---|
| `GET` | `/` | — | `200 {ok:true, sessions:<n>}`. |
| `POST` | `/session/start` | `{ contactId, ani?, agentId?, streamArn?, streamName?, startFragmentNumber? }` | `202` (async); `400` if no `contactId` or no `streamArn`/`streamName`. |
| `POST` | `/session/agent` | `{ contactId, connectAgent }` | `202`; pins the accepting agent onto the live session. |
| `POST` | `/session/stop` | `{ contactId }` | `202` if stopped, `404` if no session. |

## Connect Lambda event shapes

### `agentAcceptNotify` (agent-whisper flow → Invoke Lambda)

```jsonc
{
  "Details": {
    "ContactData": { "ContactId": "...", "Attributes": { "connectAgent": "..." } },
    "Parameters": { "connectAgent": "$.Agent.Username" }
  }
}
```
Returns `{ ok, delivered }` (number of widget connections the `assigned` frame reached).

### `kvsNotify` (contact flow after Start media streaming → Invoke Lambda)

Passes the media stream ARN/name + contactId/ani through to `POST /session/start`.

### `transcriptFromS3` (S3 ObjectCreated)

Standard S3 event; keys under `Analysis/Voice/<yyyy>/<mm>/<dd>/<contactId>_analysis_<ts>.json`.
Keys are URL-decoded and `+` → space before use.

## Environment variables

> Values shown are **placeholders / defaults**. Real secrets live in gitignored
> `.env.local` / `.secrets.*` files, never in the repo.

### Widget (`src/`) — `VITE_*`, injected at build time

| Var | Default | Meaning |
|---|---|---|
| `VITE_D365_ORG_URL` | — | D365 org URL, e.g. `https://contoso.crm.dynamics.com`. |
| `VITE_CONNECT_CCP_URL` | — | Connect CCP URL, e.g. `https://contoso.my.connect.aws/ccp-v2/`. |
| `VITE_CONNECT_REGION` | `us-east-1` | Connect instance region. |
| `VITE_TRANSCRIPT_WS_URL` | — | API Gateway WebSocket URL (`wss://.../prod`). |
| `VITE_SCREENPOP_ENTITY` | `contact` | Dataverse table to screen-pop on inbound ANI. |
| `VITE_SCREENPOP_PHONE_COLUMN` | `telephone1` | Column holding the phone to match. |

### AWS bridge Lambdas (`aws-bridge/`)

| Var | Default | Meaning |
|---|---|---|
| `INGESTOR_URL` | — | HTTPS URL of the ingestor `/api/transcript`. |
| `INGESTOR_KEY` | — | `x-ingestor-key` value (secret). |
| `WS_API_ENDPOINT` | — | API Gateway Management endpoint for posting to connections. |
| `CONNECTIONS_TABLE` | — | DynamoDB connections table name. |
| `ACTIVE_TABLE` | — | DynamoDB active-contacts table name. |
| `CONNECT_INSTANCE_ID` | — | Connect instance id (to resolve agent email). |
| `POLLER_FUNCTION_NAME` | — | Poller Lambda name (legacy path). |
| `POLL_INTERVAL_MS` | `1500` | Poll cadence (legacy path). |
| `CONSUMER_URL` | — | (`agentAcceptNotify`) KVS-consumer base URL. |
| `SESSION_KEY` | — | (`agentAcceptNotify`) `x-session-key` for the consumer (secret). |

### Ingestor (`ingestor/`)

| Var | Default | Meaning |
|---|---|---|
| `DIRECTLINE_SECRET` | — | Direct Line secret (secret). |
| `DIRECTLINE_DOMAIN` | `https://directline.botframework.com/v3/directline` | Direct Line endpoint. |
| `OC_CHANNEL_ID` | — | Omnichannel custom messaging channel id. |
| `OC_CONVERSATION_CONTEXT` | — | JSON map of static routing context (must match a workstream context rule). |
| `INGESTOR_KEY` | — | `x-ingestor-key` expected value (secret). |
| `PORT` | `8080` | Listen port. |

### KVS consumer (`kvs-consumer/`)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Listen port. |
| `SESSION_KEY` | — | `x-session-key` expected value (secret). |
| `INGESTOR_URL` | — | Ingestor `/api/transcript` URL. |
| `INGESTOR_KEY` | — | `x-ingestor-key` value (secret). |
| `AWS_REGION` | `us-east-1` | Region for KVS reads. |
| `AZURE_SPEECH_KEY` | — | Optional fallback key (org policy disables local auth). |
| `AZURE_SPEECH_REGION` | — | Speech account region. |
| `AZURE_SPEECH_RESOURCE_ID` | — | Full ARM resource id (required for Entra token auth). |
| `AZURE_SPEECH_LANGUAGE` | `en-US` | Recognition language (BCP-47). |
| `KVS_SAMPLE_RATE_HZ` | `8000` | Connect KVS track sample rate. |
