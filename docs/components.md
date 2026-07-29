# Component inventory

Per-module reference for every part of the integration. File links are relative to
the repository root.

## `src/` — CIF channel-provider widget

React + Vite + TypeScript app embedded in D365 via Channel Integration Framework 2.0.

| File | Responsibility |
|---|---|
| [`src/main.tsx`](../src/main.tsx) | React entry point (`createRoot`). |
| [`src/App.tsx`](../src/App.tsx) | Widget shell: CIF init, `identify`-on-mount, `onAssigned → subscribe`, `onEnded → open conversation`, transcript rendering, softphone launcher. |
| [`src/config.ts`](../src/config.ts) | Reads `VITE_*` build-time config (D365 org URL, CCP URL, region, WS URL, screen-pop entity/column). No secrets. |
| [`src/cif/ciframework.ts`](../src/cif/ciframework.ts) | Loads `Microsoft.CIFramework` client lib from the D365 org at runtime; `showPanel`, `screenPopByPhone`, `openConversationByContactId(+WithRetry)`, `getCurrentUserEmail` (→ `systemuser.internalemailaddress`), `writeTranscriptLine`. |
| [`src/connect/ccp.ts`](../src/connect/ccp.ts) | Opens/closes the Connect CCP in a **companion window** (`openSoftphone`, `closeSoftphone`, `isSoftphoneOpen`). |
| [`src/bridge/transcript.ts`](../src/bridge/transcript.ts) | `TranscriptBridge` WebSocket client: `connect`, `identify`, `subscribe`, `unsubscribe`; handles `segment`/`suggestion`/`assigned`/`ended`; auto-reconnect. |
| [`src/shims.ts`](../src/shims.ts) | `amazon-connect-streams` global polyfill. |
| [`src/vite-env.d.ts`](../src/vite-env.d.ts) | Vite/TS ambient types. |

> `src/connect/streams.ts` was **removed** — direct `amazon-connect-streams`
> embedding is blocked by the CCP `frame-ancestors` CSP (see architecture D1).

## `aws-bridge/` — AWS Lambdas + WebSocket + registry

Node 20 Lambdas. The `template.yaml` SAM file is **reference-only** (SAM deploy is
SCP-blocked in the target account; functions are deployed as zip bundles).

### Handlers

| File | Trigger | Responsibility |
|---|---|---|
| [`aws-bridge/src/transcriptFromS3.ts`](../aws-bridge/src/transcriptFromS3.ts) | S3 `ObjectCreated` on `Analysis/Voice/**/*.json` | **Primary transcript path.** Reads Contact Lens post-call analysis, `DescribeContact` for ani/agent, posts `kind:"transcript"` to the ingestor, then best-effort `broadcastSegments`+`broadcastEnded` to the widget. |
| [`aws-bridge/src/agentAcceptNotify.ts`](../aws-bridge/src/agentAcceptNotify.ts) | Connect agent-whisper flow (Invoke Lambda) | Resolves accepting agent email, `notifyAssigned([email, connectAgent], contactId)` over the WebSocket; best-effort `POST /session/agent` to the KVS consumer. |
| [`aws-bridge/src/kvsNotify.ts`](../aws-bridge/src/kvsNotify.ts) | Connect flow after Start media streaming | `POST /session/start` to the KVS consumer with stream ARN/name + contactId. |
| [`aws-bridge/src/websocket.ts`](../aws-bridge/src/websocket.ts) | API Gateway WebSocket | Routes `$connect`, `$disconnect`, `identify`, `subscribe`, `unsubscribe`. |
| [`aws-bridge/src/poller.ts`](../aws-bridge/src/poller.ts) | (disabled) | Real-time Contact Lens segment poller — no-op on this instance (real-time API 404s). |
| [`aws-bridge/src/lifecycle.ts`](../aws-bridge/src/lifecycle.ts) | (effectively no-op) | Connect Invoke-Lambda started/ended handler from the earlier design. |

### Shared modules

| File | Responsibility |
|---|---|
| [`aws-bridge/src/ws.ts`](../aws-bridge/src/ws.ts) | DynamoDB connection registry + WebSocket push: `registerConnection`, `removeConnection`, `identifyConnection`, `subscribe/unsubscribeConnection`, `notifyAssigned`, `broadcastSegment(s)`, `broadcastEnded`. `byContact` + `byAgent` GSIs, 4 h TTL, 410 cleanup. |
| [`aws-bridge/src/agentEmail.ts`](../aws-bridge/src/agentEmail.ts) | `resolveAgentEmail(connectAgent)` via `SearchUsers`(exact) → `DescribeUser` `IdentityInfo.Email`, in-proc cache. |
| [`aws-bridge/src/store.ts`](../aws-bridge/src/store.ts) | Active-contacts table CRUD. |
| [`aws-bridge/src/ingestorClient.ts`](../aws-bridge/src/ingestorClient.ts) | `segment` / `lifecycle` / `transcript` POST to the ingestor with `x-ingestor-key`. |
| [`aws-bridge/src/env.ts`](../aws-bridge/src/env.ts) | Fail-fast env getters (see [api-reference.md](api-reference.md#environment-variables)). |
| [`aws-bridge/src/types.ts`](../aws-bridge/src/types.ts) | Shared types (`TranscriptSegment`, `Participant`, etc.). |

### Deploy artifacts (`aws-bridge/deploy/`)

| File | Purpose |
|---|---|
| `create-agent-accept-lambda.ps1` | Provision the agent-accept Lambda. |
| `agent-whisper-content.json` | Connect agent-whisper flow (maps `$.Agent.Username` → `connectAgent`). |
| `flow-with-media.json` | Connect flow with Start-media-streaming. |
| `bucket-notification.json` | S3 → Lambda ObjectCreated notification config. |
| `transcript-s3-perms.json`, `iam-transcript-s3.json` | IAM for the S3 transcript Lambda (S3 read, Connect DescribeContact, WS post). |
| `iam-agent-accept.json` | IAM for the agent-accept Lambda (Connect SearchUsers/DescribeUser, WS post). |
| `gsi-byagent.json` | DynamoDB `byAgent` GSI definition. |
| `trust-lambda.json` | Lambda execution-role trust policy. |
| `test-*.json` | Sample invocation events (S3, kvsNotify, agent-accept, media flow). |
| `dl-*.ps1`, `oc-*.ps1`, `d365-oc-discovery.ps1` | Direct Line / Omnichannel diagnostics. |

## `ingestor/` — transcript → Direct Line → Omnichannel

Node/Express service deployed as an Azure Container App.

| File | Responsibility |
|---|---|
| [`ingestor/src/server.ts`](../ingestor/src/server.ts) | Express `:8080`; `GET /` health, `POST /api/transcript` (`x-ingestor-key`), dispatches `lifecycle`/`segment`/`transcript`. |
| [`ingestor/src/omnichannel.ts`](../ingestor/src/omnichannel.ts) | `OmnichannelClient`: `ensureConversation`, `postTranscriptMessage`, `postFullTranscript`, `endConversation`; Direct Line `startConversation`/`refreshTokenIfNeeded`/`postActivity`/`dlFetch` retry on 429/5xx. |
| [`ingestor/src/types.ts`](../ingestor/src/types.ts) | `TranscriptSegment`, `CallLifecycle`, `FullTranscript`. |
| [`ingestor/src/functions/transcript.ts`](../ingestor/src/functions/transcript.ts) | Azure Functions variant (**not deployed** — Functions Consumption blocked by storage policy; see architecture D7). |

## `kvs-consumer/` — live KVS audio → Azure Speech

Node/Express service deployed as an Azure Container App.

| File | Responsibility |
|---|---|
| [`kvs-consumer/src/index.ts`](../kvs-consumer/src/index.ts) | Express control surface: `POST /session/start`, `/session/stop`, `/session/agent` (`x-session-key`), `GET /` health. |
| [`kvs-consumer/src/session.ts`](../kvs-consumer/src/session.ts) | `Session` + `sessionRegistry`: `ensureConversationStarted`, `setAgent`, `pendingFinals`, idle timer. |
| [`kvs-consumer/src/kvsReader.ts`](../kvs-consumer/src/kvsReader.ts) | KVS `GetMedia` + EBML/Matroska decode → PCM per track. |
| [`kvs-consumer/src/speech.ts`](../kvs-consumer/src/speech.ts) | `SpeechStream` (Azure Speech SDK), PCM 16-bit 8 kHz mono. |
| [`kvs-consumer/src/speechAuth.ts`](../kvs-consumer/src/speechAuth.ts) | `getSpeechAuthToken` → `aad#{resourceId}#{token}` via `DefaultAzureCredential`. |
| [`kvs-consumer/src/env.ts`](../kvs-consumer/src/env.ts) | Fail-fast env getters. |
| [`kvs-consumer/src/ingestorClient.ts`](../kvs-consumer/src/ingestorClient.ts) | Posts utterances to the ingestor. |

## `webresources/` — D365 web resources

| File | Web resource | Responsibility |
|---|---|---|
| [`webresources/maulabs_awsconnect_softphone.html`](../webresources/maulabs_awsconnect_softphone.html) | `maulabs_awsconnect_softphone.html` | Iframe host pointing at the Static Web App. |
| [`webresources/maulabs_awsconnect_sidepane.js`](../webresources/maulabs_awsconnect_sidepane.js) | `maulabs_awsconnect_sidepane.js` | Global `AwsConnect.openPane()` via `Xrm.App.sidePanes`. |

## Root scripts & config

| File | Purpose |
|---|---|
| `deploy-webresources.ps1`, `update-webresources.ps1` | Deploy/update the D365 web resources (uses `az` token). |
| `tools/dv.ps1` | Dataverse query helper. |
| `check-convs.ps1`, `close-test-convs.ps1`, `synth-test.ps1` | Test/diagnostic helpers (secrets read from env vars). |
| `staticwebapp.config.json` | SWA CSP: `frame-ancestors *.dynamics.com`; `frame-src *.my.connect.aws`. |
| `vite.config.ts`, `tsconfig.json`, `index.html` | Widget build config. |
| `rec-storage.json`, `rec-bucket-policy.json` | S3 recording/analysis storage config. |
| `docs/pricing/LiveTranscription-CostModel.xlsx` | Cost / pricing model (horizon estimate — validate SKUs & rates). |
