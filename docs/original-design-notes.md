# Amazon Connect ↔ Dynamics 365 Contact Center (CIFv2)

Channel provider that surfaces Amazon Connect calls inside the D365 Contact
Center agent workspace. **The call stays in Amazon Connect** (PSTN, IVR, queue,
routing); D365 gets screen-pop, call context, and a **live transcript streamed
into a native Omnichannel conversation** so the built-in Copilot agents
(Conversation Summary, Intent, Case Management Agent) fire — no audio required.

> How the native agents work without audio: Conversation Summary, Intent, and
> Case Management Agent are transcript-driven, not audio-driven. We create one
> D365 Omnichannel conversation per AWS call and stream the Contact Lens
> transcript into it as turns. The agents run on that conversation transcript.
> The conversation is a *messaging*-type conversation (not native voice), so
> voice-only surfaces don't apply, but the named agents do. Note: **Intent** is
> separately gated by the Service Copilot (Customer Service Enterprise) license
> per agent.

## Components

| Piece | Tech | Repo location |
|---|---|---|
| CIF channel provider (this app) | Vite + React + TS | `src/` |
| Amazon Connect embed | amazon-connect-streams | `src/connect/ccp.ts` |
| CIFv2 bridge | `Microsoft.CIFramework` | `src/cif/ciframework.ts` |
| Transcript stream client | WebSocket | `src/bridge/transcript.ts` |
| D365 transcript ingestor | Azure Function + **Direct Line 3.0** | `ingestor/` |
| AWS bridge (Contact Lens → ingestor + widget) | Lambda + API GW WS (SAM) | `aws-bridge/` |

## Data flow

```
Customer → Amazon Connect (IVR/queue/agent — call stays here)
     │  Contact Lens real-time transcript
     ▼
AWS bridge (aws-bridge/)
     ├─ PollerFn: ListRealtimeContactAnalysisSegments (dedupe by segment id)
     │     ├─► D365 ingestor Function ──DirectLine 3.0──► Azure Bot ──► Omnichannel conversation
     │     │        (auto-created, headless — native Copilot agents run on the transcript)
     │     └─► API GW WebSocket ──► CIF widget (agent sees transcript in D365 workspace)
     └─ LifecycleFn: Connect Invoke-Lambda (started/ended) drives conversation open/close
widget → Microsoft.CIFramework → D365 (screen-pop, session, records)
```

**Ingestion transport = Direct Line 3.0.** The ingestor opens one Direct Line
conversation per Amazon Connect `contactId` and posts each transcript turn as an
activity. The Azure Bot's messaging endpoint is the Omnichannel inbound URL, so
those activities land in a native D365 conversation that the Copilot agents run
on. This is the documented "bring your own channel" (custom messaging) model.

## Local dev

```bash
npm install
cp .env.example .env.local   # fill in your values
npm run dev                  # serves on https://localhost:5173 (needs HTTPS)
```

D365 will only embed the provider over **HTTPS**. For local testing use a dev
tunnel or `mkcert`, and register that HTTPS URL as the CIF provider.

## Deploy (Azure Static Web Apps)

```bash
npm run build                # outputs dist/
# then deploy dist/ via SWA CLI or GitHub Actions
```

Set the `VITE_*` values as SWA build environment variables.
`staticwebapp.config.json` already sets the CSP `frame-ancestors` so D365 can
iframe the app and the app can iframe the Connect CCP.

## D365 configuration (Channel Integration Framework 2.0)

1. Install the **Dynamics 365 Channel Integration Framework** app if not present.
2. Open the **Channel Integration Framework** admin app → **New provider**:
   - **Label / Name**: Amazon Connect
   - **Channel URL**: your deployed SWA URL (e.g. `https://xxx.azurestaticapps.net`)
   - **Enable Outbound Communication**: Yes
   - **Channel Order**: 1
   - **API Version**: 2.0
   - **Trusted Domain**: your SWA domain
   - **Select Unified Interface Apps**: add *Customer Service workspace* /
     *Contact Center workspace*.
   - **Select Roles**: the security roles that should see the panel.
3. Save. Reload the agent app — the panel appears in the right dock.

## Amazon Connect configuration

1. **Approved origins**: in the Connect console → your instance →
   *Application integration* → add your SWA origin (and dev tunnel origin).
2. **Contact flow**: enable **Set recording and analytics behavior** with
   **Contact Lens real-time analytics** so transcript segments are produced.
3. (Optional fallback) enable **Start media streaming** to Kinesis Video
   Streams if you later want your own Amazon Transcribe pipeline.

## AWS bridge (`aws-bridge/`)

Built with AWS SAM. See `aws-bridge/README.md` for full deploy + Connect
contact-flow wiring. Summary:

- **LifecycleFn** — invoked by the Connect contact flow (Invoke Lambda block)
  with `event=started` / `event=ended`; registers the contact, tells the
  ingestor to open/close the conversation, and kicks off the poller.
- **PollerFn** — reads Contact Lens real-time segments via
  `ListRealtimeContactAnalysisSegments`, dedupes by segment id, and fans each
  new final turn to (1) the D365 ingestor and (2) the widget WebSocket. It
  self-re-invokes to survive calls longer than the Lambda limit.
- **WebSocketFn** — API Gateway WebSocket ($connect/$disconnect/subscribe);
  the widget subscribes with the active `contactId` (see `TranscriptBridge`).

```bash
cd aws-bridge && npm install && sam build
sam deploy --guided --parameter-overrides IngestorUrl=<func-url> IngestorKey=<key>
# WebSocketUrl output → widget VITE_TRANSCRIPT_WS_URL
# LifecycleFunctionArn output → Connect contact flow Invoke-Lambda block
```

## Azure Bot (provisioned)

A single-tenant Azure Bot backs the custom messaging channel:

- Resource group `rg-aws-d365-bridge`, bot `aws-connect-d365-bridge-bot` (F0),
  subscription **ACS AMEX CC Corp**.
- Bot AAD app id `32588ec5-e570-4920-be97-1b9d402e5d88` (single-tenant).
- **Direct Line** channel enabled; secret stored locally in `.secrets.directline`
  (gitignored) and mirrored into `ingestor/.env.local` as `DIRECTLINE_SECRET`.
- Messaging endpoint is a placeholder until the Omnichannel custom messaging
  channel is created (which yields the inbound URL to point the bot at).

Remaining wiring (Omnichannel admin center, portal):

1. Create a **Custom** messaging channel, reference bot app id
   `32588ec5-e570-4920-be97-1b9d402e5d88`, and copy the generated **inbound
   endpoint URL**.
2. `az bot update -g rg-aws-d365-bridge -n aws-connect-d365-bridge-bot
   --endpoint <inbound-url>`.
3. Associate the channel with the **Custom messaging workstream**
   (`ee900829-d87c-40d2-b0dd-1bc6be067579`) and configure **auto-accept**
   routing to a service identity (headless — no human accept in D365).
4. Put the channel id into `ingestor/.env.local` as `OC_CHANNEL_ID`.

## Status

- [x] CIF channel provider scaffold (`src/`)
- [x] Transcript ingestor (`ingestor/`) — Direct Line 3.0 client, typecheck passes
- [x] AWS bridge (`aws-bridge/`) — Contact Lens real-time → ingestor + widget WS, typecheck passes
- [x] Azure Bot + Direct Line provisioned (`rg-aws-d365-bridge`)
- [x] Intent enabled + Default LOB intent family bound on the Custom messaging workstream
- [ ] Create Omnichannel custom messaging channel + point bot endpoint at inbound URL
- [ ] Headless auto-accept routing on the workstream (`ee900829-…`)
- [ ] Deploy ingestor Function → wire `IngestorUrl`/`IngestorKey` into `sam deploy`
- [ ] Enable Conversation Summary at the workstream; register CIF provider
- [ ] Screen-pop + case correlation mapping (ANI / contactId)

> **Intent** additionally requires the Service Copilot (Customer Service
> Enterprise) license per agent — gated outside Dataverse.
```
