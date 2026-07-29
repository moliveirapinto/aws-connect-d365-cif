// Plain Node/Express HTTP server variant of the ingestor, for deployment to an
// Azure App Service Web App. Used instead of the Azure Functions Consumption
// plan because this subscription enforces publicNetworkAccess=Disabled on all
// storage accounts (org security policy), which Azure Functions Consumption
// plan cannot work with (it requires a publicly reachable AzureWebJobsStorage
// account). App Service has no such storage dependency, so it is unaffected.
//
// Same request contract as functions/transcript.ts:
//   POST /api/transcript
//   header: x-ingestor-key: <INGESTOR_KEY>
//   body: { kind: "segment", data: TranscriptSegment } | { kind: "lifecycle", data: CallLifecycle }

import express from "express";
import { OmnichannelClient, type OmnichannelConfig } from "./omnichannel.js";
import type { CallLifecycle, FullTranscript, TranscriptSegment } from "./types.js";

function loadConfig(): OmnichannelConfig {
  const env = process.env;
  const required = ["DIRECTLINE_SECRET", "OC_CHANNEL_ID"];
  for (const k of required) if (!env[k]) throw new Error(`Missing env var ${k}`);
  return {
    directLineSecret: env.DIRECTLINE_SECRET!,
    directLineDomain: env.DIRECTLINE_DOMAIN ?? "https://directline.botframework.com/v3/directline",
    channelId: env.OC_CHANNEL_ID!,
    // Optional JSON map of static routing context, e.g. {"source":"AmazonConnect"}.
    // Must match a context-variable routing rule on the workstream to leave the
    // default messaging queue.
    conversationContext: parseJsonMap(env.OC_CONVERSATION_CONTEXT),
  };
}

function parseJsonMap(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    console.warn("OC_CONVERSATION_CONTEXT is not valid JSON; ignoring.");
    return undefined;
  }
}

let client: OmnichannelClient | undefined;
function getClient(): OmnichannelClient {
  return (client ??= new OmnichannelClient(loadConfig()));
}

type Payload =
  | { kind: "segment"; data: TranscriptSegment }
  | { kind: "lifecycle"; data: CallLifecycle }
  | { kind: "transcript"; data: FullTranscript };

const app = express();
app.use(express.json());

app.get("/", (_req, res) => res.status(200).send("ok"));

app.post("/api/transcript", async (req, res) => {
  const expectedKey = process.env.INGESTOR_KEY;
  if (expectedKey) {
    const provided = req.header("x-ingestor-key");
    if (provided !== expectedKey) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const body = req.body as Payload;
  if (
    !body ||
    (body.kind !== "segment" && body.kind !== "lifecycle" && body.kind !== "transcript")
  ) {
    res.status(400).json({ error: "Unknown payload kind" });
    return;
  }

  try {
    const oc = getClient();
    if (body.kind === "lifecycle") {
      if (body.data.event === "started") await oc.ensureConversation(body.data);
      else await oc.endConversation(body.data);
    } else if (body.kind === "transcript") {
      await oc.postFullTranscript(body.data);
    } else {
      await oc.postTranscriptMessage(body.data);
    }
    res.status(202).json({ ok: true });
  } catch (err) {
    console.error("Ingestion failed", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => console.log(`ingestor listening on ${port}`));
