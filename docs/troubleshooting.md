# Troubleshooting

Symptom → likely cause → fix. Grounded in the actual issues encountered building
this integration.

## Softphone / CCP won't embed in D365

**Symptom:** the Connect CCP shows a blank frame or a `frame-ancestors` / refused-to-display
console error inside the D365 panel.

**Cause:** the Amazon Connect CCP sets a Content-Security-Policy `frame-ancestors`
that disallows embedding under `*.dynamics.com`. (An AWS support case is open to
allow the D365 origin.)

**Fix / current behavior:** the widget launches the CCP in a **companion browser
window** (`src/connect/ccp.ts` → `openSoftphone()`), not an iframe. This is the
supported path today. Do **not** reintroduce `src/connect/streams.ts` /
`amazon-connect-streams` embedding — it was removed for this reason.

## No live transcript during the call

**Symptom:** the widget shows no `segment` frames while the call is in progress;
`ListRealtimeContactAnalysisSegments` returns **404** for the whole call.

**Cause:** the real-time Contact Lens stream does not emit on this instance.

**Fix / current behavior:** the transcript is delivered **post-call** from the
Contact Lens analysis JSON in S3 (`transcriptFromS3` Lambda). A complete transcript
lands a minute or two after hang-up and creates the D365 conversation. If you also
need *in-call* transcript, enable the **live KVS path** (media streaming →
`kvs-consumer` → Azure Speech). The `poller.ts`/`lifecycle.ts` real-time path is a
no-op and should not be relied on.

## The conversation is created but not routed to the agent

**Symptom:** an Omnichannel conversation appears, but the agent's widget never got
`assigned`.

**Checklist:**

1. The widget must have sent `identify` with the agent's email. Confirm the row in
   the connections table has `agentEmail` set.
2. The **`byAgent` GSI** must be `ACTIVE`:
   ```bash
   aws dynamodb describe-table --table-name <ConnectionsTable> \
     --query "Table.GlobalSecondaryIndexes[?IndexName=='byAgent'].IndexStatus"
   ```
3. `resolveAgentEmail` must map the Connect username to the same email the widget
   declared. If the Connect username *is* the email (SAML), the raw-username
   candidate covers it. Check the `agentAcceptNotify` logs:
   `... accepted by <user> (<email>) -> pushed 'assigned' to N widget connection(s)`.
   If `N = 0`, the emails don't match — verify both sides use the same IdP identity.

## Agent-accept signal never fires

**Symptom:** `agentAcceptNotify` logs `no connectAgent for contact ...`.

**Cause:** the agent-whisper flow isn't mapping `$.Agent.Username` into the
`connectAgent` Lambda parameter.

**Fix:** re-import [`aws-bridge/deploy/agent-whisper-content.json`](../aws-bridge/deploy/agent-whisper-content.json)
and confirm the Invoke-Lambda block passes `connectAgent = $.Agent.Username`.

## Transcript posts but no conversation appears in D365

**Checklist:**

1. Ingestor auth: a `401` means the caller's `x-ingestor-key` ≠ the ingestor's
   `INGESTOR_KEY`.
2. Direct Line: check `DIRECTLINE_SECRET`, `DIRECTLINE_DOMAIN`, and that the bot's
   messaging endpoint is the Omnichannel inbound URL.
3. `OC_CHANNEL_ID` must be the Custom messaging channel id, and the workstream
   must **auto-accept** (headless) for the conversation to land and the Copilot
   agents to run.
4. `OC_CONVERSATION_CONTEXT`, if set, must match a context-variable routing rule on
   the workstream, otherwise the conversation stays in the default queue.

## Live KVS transcription produces nothing

**Checklist:**

1. `/session/start` needs `contactId` **and** `streamArn` or `streamName`
   (otherwise `400`).
2. Azure Speech uses **Entra token auth** (`disableLocalAuth=true`): the Container
   App's managed identity needs the **Cognitive Services Speech User** role and
   `AZURE_SPEECH_RESOURCE_ID` must be the full ARM id.
3. Audio format must be PCM **8 kHz / 16-bit / mono** (`KVS_SAMPLE_RATE_HZ=8000`).
4. AWS credentials for `GetMedia` on the KVS stream must be present.

## Azure Functions won't deploy for the ingestor

**Symptom:** Functions Consumption plan fails because it needs a publicly reachable
`AzureWebJobsStorage`.

**Cause:** the subscription enforces `publicNetworkAccess=Disabled` on all storage
accounts (org policy).

**Fix / current behavior:** the ingestor and KVS consumer run as **Azure Container
Apps** (no storage dependency). The `ingestor/src/functions/transcript.ts` variant
is kept for reference only.

## `synth-test.ps1` / test scripts fail with a missing key

**Cause:** by design, the scripts read secrets from environment variables (no
secret is committed).

**Fix:** set the env var before running:
```powershell
$env:INGESTOR_KEY = "<the ingestor x-ingestor-key>"
# optional: $env:INGESTOR_URL = "https://<your-ingestor-host>/api/transcript"
./synth-test.ps1
```
