# AWS bridge — Contact Lens real-time transcript → D365 + widget

This is the AWS side of the integration. The call stays entirely in Amazon
Connect; the bridge only reads the **Contact Lens real-time** transcript and
streams it to two places:

1. the **D365 ingestor** Function → opens/updates an Omnichannel conversation so
   native Copilot agents (Conversation Summary, Intent, Case Management Agent)
   run on the live transcript;
2. the **CIF agent widget** (via a WebSocket API) so the agent sees the same
   transcript inside the D365 workspace.

Amazon Connect keeps the PSTN number, IVR, queue and routing. Contact Lens does
the speech-to-text, so we don't run our own ASR.

## Flow

```
Amazon Connect (call)                     Azure                     D365
  │  Contact Lens real-time                 │                        │
  │  transcript segments                    │                        │
  ▼                                         │                        │
Connect contact flow                        │                        │
  └─(Invoke Lambda: started/ended)──► LifecycleFn                    │
                                        │  registers contact         │
                                        ├─► ingestor /transcript ───► Direct Line ─► Omnichannel conv.
                                        └─► invokes PollerFn (async)  │             (Copilot agents run)
                                                 │  every ~1.5s       │
                                                 ├─ Connect:ListRealtimeContactAnalysisSegments
                                                 ├─► ingestor /transcript (each new final utterance)
                                                 └─► WebSocket ─► CIF widget (agent sees transcript)
```

## Prerequisites

- **Contact Lens real-time analytics enabled** on the contact flow (Set recording
  and analytics behavior → Analytics → Enable Contact Lens → **Real-time**).
- The D365 **ingestor** Function deployed, with its URL + a function key.
- AWS SAM CLI + credentials for the Connect account.

## Deploy

```bash
cd aws-bridge
npm install
sam build
sam deploy --guided \
  --parameter-overrides \
    IngestorUrl=https://<your-func>.azurewebsites.net/api/transcript \
    IngestorKey=<function-key>
```

Outputs:

- `WebSocketUrl` → set as `VITE_TRANSCRIPT_WS_URL` in the CIF widget `.env`.
- `LifecycleFunctionArn` → wire into the Connect contact flow.

## Wire the Connect contact flow

Add an **Invoke AWS Lambda function** block that calls `LifecycleFn`:

- At call **start** (after Contact Lens is enabled): pass parameter `event=started`.
  Optionally pass `agentId` (the D365 systemuser id) as a parameter or contact
  attribute so the D365 conversation is attributed to the same agent.
- At call **end** (disconnect flow): pass parameter `event=ended`.

The block automatically provides `ContactId`, `InstanceARN` and the customer
`Address` (ANI); the Lambda reads those from `event.Details.ContactData`.

## Notes / trade-offs

- **Real-time source**: we use `ListRealtimeContactAnalysisSegments` (the supported
  Contact Lens real-time API) polled every ~1.5s. Each returned utterance is a
  finalized segment; we dedupe by segment id so nothing is posted twice. If you
  already stream segments to Kinesis, the poller can be swapped for a
  Kinesis-triggered handler with the same fan-out.
- **SYSTEM turns** (IVR/bot prompts) are skipped; only CUSTOMER and AGENT turns
  reach D365.
- The poller self-re-invokes before the 15-minute Lambda limit so long calls keep
  streaming, and stops as soon as the lifecycle `ended` event removes the contact.
