# Deployment playbook

End-to-end deployment for every component. This reflects how the integration is
actually deployed (SAM is *not* used for the Lambdas — the target AWS account
blocks `sam deploy` via SCP, so functions are shipped as zip bundles).

> **Prerequisites:** AWS CLI (region `us-east-1`), Azure CLI (`az`) logged into the
> subscription, Node 20, Docker, and the Power Platform / D365 admin access for the
> target org.

---

## 1. AWS bridge (Lambdas + WebSocket + DynamoDB)

### 1.1 Build the Lambda bundles

```bash
cd aws-bridge
npm install
npm run build            # tsc -> JS
# bundle each handler (esbuild/zip) -> .deploy/*.zip
```

The packaged bundles are attached to the **GitHub Release** as
`websocket.zip`, `agentAcceptNotify.zip`, `transcriptFromS3.zip`.

### 1.2 DynamoDB table + GSIs

The connections table is keyed on `connectionId` (HASH) with a 4 h TTL and two GSIs:

- `byContact` (HASH `contactId`) — push `segment`/`ended` per call.
- `byAgent` (HASH `agentEmail`) — push `assigned` to a specific agent.

The `byAgent` GSI definition is in [`aws-bridge/deploy/gsi-byagent.json`](../aws-bridge/deploy/gsi-byagent.json):

```bash
aws dynamodb update-table --cli-input-json file://aws-bridge/deploy/gsi-byagent.json
# wait until the index Status = ACTIVE before relying on assigned routing
aws dynamodb describe-table --table-name <ConnectionsTable> \
  --query "Table.GlobalSecondaryIndexes[].{Name:IndexName,Status:IndexStatus}"
```

### 1.3 IAM

Attach the inline policies (least privilege):

- `transcriptFromS3` role → [`aws-bridge/deploy/iam-transcript-s3.json`](../aws-bridge/deploy/iam-transcript-s3.json)
  (S3 `GetObject` on the analysis prefix, Connect `DescribeContact`, API GW
  `ManageConnections`, DynamoDB query on the GSIs).
- `agentAcceptNotify` role → [`aws-bridge/deploy/iam-agent-accept.json`](../aws-bridge/deploy/iam-agent-accept.json)
  (Connect `SearchUsers`/`DescribeUser`, API GW `ManageConnections`, DynamoDB query).

```bash
aws iam put-role-policy --role-name <transcript-s3-role> \
  --policy-name connections-ws-access \
  --policy-document file://aws-bridge/deploy/iam-transcript-s3.json

aws iam put-role-policy --role-name <LifecycleFnRole> \
  --policy-name agent-accept-connections-connect \
  --policy-document file://aws-bridge/deploy/iam-agent-accept.json
```

### 1.4 Deploy / update the functions

```bash
aws lambda update-function-code --function-name <WebSocketFn>       --zip-file fileb://aws-bridge/.deploy/websocket.zip
aws lambda update-function-code --function-name <agent-accept-notify> --zip-file fileb://aws-bridge/.deploy/agentAcceptNotify.zip
aws lambda update-function-code --function-name <transcript-s3>     --zip-file fileb://aws-bridge/.deploy/transcriptFromS3.zip
```

Set each function's env vars per [api-reference.md](api-reference.md#aws-bridge-lambdas-aws-bridge).

### 1.5 S3 → Lambda notification (post-call transcript trigger)

Apply the ObjectCreated notification on the recording bucket's analysis prefix:

```bash
aws s3api put-bucket-notification-configuration \
  --bucket <rec-bucket> \
  --notification-configuration file://aws-bridge/deploy/bucket-notification.json
```

(Grant the bucket permission to invoke the Lambda via `aws lambda add-permission`
using the config in [`aws-bridge/deploy/transcript-s3-perms.json`](../aws-bridge/deploy/transcript-s3-perms.json).)

---

## 2. Amazon Connect

1. **Recording & analytics:** enable **Set recording and analytics behavior** with
   **Contact Lens** so **post-call analysis** JSON is written to S3.
2. **Agent-whisper flow:** import [`aws-bridge/deploy/agent-whisper-content.json`](../aws-bridge/deploy/agent-whisper-content.json).
   It invokes `agentAcceptNotify` with the `connectAgent` parameter mapped to
   `$.Agent.Username`.
3. **Media streaming (optional live path):** import [`aws-bridge/deploy/flow-with-media.json`](../aws-bridge/deploy/flow-with-media.json)
   which does **Start media streaming** then invokes `kvsNotify`.
4. **Approved origins:** add the Static Web App origin under *Application
   integration → Approved origins*.

---

## 3. Ingestor (Azure Container App)

```bash
cd ingestor
npm install && npm run build
docker build -t <acr>/ingestor:latest .
docker push <acr>/ingestor:latest
az containerapp update -g rg-aws-d365-bridge -n app-aws-d365-ingestor \
  --image <acr>/ingestor:latest
```

Set env vars (`DIRECTLINE_SECRET`, `OC_CHANNEL_ID`, `INGESTOR_KEY`, …) as Container
App secrets — see [api-reference.md](api-reference.md#ingestor-ingestor).

---

## 4. KVS consumer (Azure Container App)

```bash
cd kvs-consumer
npm install && npm run build
docker build -t <acr>/kvs-consumer:latest .
docker push <acr>/kvs-consumer:latest
az containerapp update -g rg-aws-d365-bridge -n app-aws-d365-kvs-consumer \
  --image <acr>/kvs-consumer:latest
```

Grant the Container App's managed identity the **Cognitive Services Speech User**
role on the Speech account (Entra token auth; org policy disables local keys).
Provide AWS credentials for KVS `GetMedia`. Env vars per
[api-reference.md](api-reference.md#kvs-consumer-kvs-consumer).

---

## 5. Azure Bot + Direct Line + Omnichannel channel

1. Azure Bot `aws-connect-d365-bridge-bot` (single-tenant, AAD app
   `32588ec5-e570-4920-be97-1b9d402e5d88`) with **Direct Line** enabled.
2. In the **Omnichannel admin center**, create a **Custom** messaging channel
   referencing that bot app id; copy the generated **inbound endpoint URL**.
3. Point the bot at it: `az bot update -g rg-aws-d365-bridge -n aws-connect-d365-bridge-bot --endpoint <inbound-url>`.
4. Put the channel id into the ingestor's `OC_CHANNEL_ID`, and the Direct Line
   secret into `DIRECTLINE_SECRET`.
5. Configure the messaging **workstream** with **auto-accept** routing so the
   headless conversation lands and the Copilot agents run.

---

## 6. CIF widget (Azure Static Web Apps)

```bash
npm install
npm run build            # -> dist/
# deploy dist/ via SWA CLI or GitHub Actions
```

- Set the `VITE_*` values as SWA build environment variables
  ([api-reference.md](api-reference.md#widget-src--vite-injected-at-build-time)).
- `staticwebapp.config.json` already sets the CSP `frame-ancestors *.dynamics.com`
  (D365 can iframe the app) and `frame-src *.my.connect.aws`.

### Register the CIF provider in D365

1. Open the **Channel Integration Framework** admin app → **New provider**:
   - **Channel URL:** the SWA URL.
   - **API Version:** 2.0, **Enable Outbound Communication:** Yes, **Trusted
     Domain:** the SWA domain.
   - **Unified Interface Apps:** Customer Service / Contact Center workspace.
   - **Roles:** the security roles that should see the panel.
2. Save and reload the agent app — the panel appears in the right dock.

---

## 7. D365 web resources

Deploy the softphone host + side-pane launcher:

```powershell
./deploy-webresources.ps1     # first-time create
./update-webresources.ps1     # subsequent updates
```

These use an `az` access token against the D365 org; see `tools/dv.ps1` for the
Dataverse helper.

---

## Verification

- `GET /` on the ingestor and KVS consumer → `200`.
- DynamoDB `byAgent` and `byContact` GSIs both `ACTIVE`.
- Place a test call → accept → confirm the widget receives `assigned`, and after
  hang-up a D365 Omnichannel conversation is created with the full transcript.
- See [troubleshooting.md](troubleshooting.md) if any step is silent.
