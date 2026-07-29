# Deployed resources

The live resource inventory as currently deployed. IDs are included for
operational reference. **This repository is private** — these identifiers are not
secrets (no keys/passwords), but treat them as internal.

## AWS (region `us-east-1`, account `139035987927`)

### API Gateway WebSocket

| Item | Value |
|---|---|
| API id | `bz8qrnj6ce` |
| Endpoint | `https://bz8qrnj6ce.execute-api.us-east-1.amazonaws.com/prod` |
| Integration | `41mwm74` |
| Routes | `$connect`, `$disconnect`, `$default`, `identify`, `subscribe`, `unsubscribe` |

### DynamoDB

| Item | Value |
|---|---|
| Connections table | `aws-connect-d365-bridge-ConnectionsTable-47CAEN83OVDT` |
| Key | HASH `connectionId`, TTL 4 h |
| GSI `byContact` | HASH `contactId` — **ACTIVE** |
| GSI `byAgent` | HASH `agentEmail` — verify **ACTIVE** |

### Lambdas

| Function | Role | Purpose |
|---|---|---|
| `aws-connect-d365-bridge-WebSocketFn-lnv6A7geLkQn` | (WebSocket role) | WS `$connect`/`$disconnect`/identify/subscribe/unsubscribe |
| `aws-connect-d365-bridge-agent-accept-notify` | `LifecycleFnRole-aWdXQMyc2e7q` | Agent-accept → `assigned` push |
| `aws-connect-d365-bridge-transcript-s3` | `transcript-s3-role` | S3 post-call analysis → ingestor + widget |
| (poller / lifecycle / kvs-notify) | — | Legacy / media-notify paths |

Inline IAM policies added by this project:

- `transcript-s3-role` → policy `connections-ws-access`.
- `LifecycleFnRole-aWdXQMyc2e7q` → policy `agent-accept-connections-connect`.

### Amazon Connect

| Item | Value |
|---|---|
| Instance id | `1fc5d6d3-95c9-421a-b33e-ff1d47db4c49` |
| Toll-free number | `+18553087828` |
| Test agent | `mauricio.agent` |
| Agent-whisper flow | `f2eddabb-4cab-44c7-b8b5-962d5650e17b` (maps `$.Agent.Username` → `connectAgent`) |
| Recording/analysis bucket | `amazon-connect-d365-139035987927-rec` (analysis under `Analysis/Voice/**`) |

## Azure (subscription "ACS AMEX CC Corp", RG `rg-aws-d365-bridge`)

| Resource | Name / value |
|---|---|
| Static Web App | `swa-aws-d365-cif` → `https://mango-plant-0482c030f.7.azurestaticapps.net` |
| Container App (ingestor) | `app-aws-d365-ingestor` |
| Container App (KVS consumer) | `app-aws-d365-kvs-consumer` |
| Azure Bot | `aws-connect-d365-bridge-bot` (F0) |
| Bot AAD app id | `32588ec5-e570-4920-be97-1b9d402e5d88` (single-tenant) |
| Bot channel | Direct Line 3.0 (secret stored in gitignored `.secrets.directline` / `ingestor/.env.local`) |

## Dynamics 365

| Item | Value |
|---|---|
| Org | `orgcf0d9f1f.crm.dynamics.com` |
| Web resource (softphone host) | `maulabs_awsconnect_softphone.html` — id `d34647b3-4b86-f111-ab0f-3833c5de5ec3` |
| Web resource (side-pane launcher) | `maulabs_awsconnect_sidepane.js` — id `5c30a5b1-4b86-f111-ab0f-6045bddc4e77` |
| CIF provider | Amazon Connect (channel URL = the SWA URL) |
| Omnichannel channel | Custom messaging channel referencing the bot app id |

> **Intent** additionally requires the Service Copilot (Customer Service
> Enterprise) license **per agent** — gated outside Dataverse.
