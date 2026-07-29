// HTTP-triggered Azure Function. The AWS bridge (Contact Lens -> Lambda) posts
// finalised transcript segments and call lifecycle events here; we forward them
// into the D365 Omnichannel conversation so native Copilot agents run on them.

import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { OmnichannelClient, type OmnichannelConfig } from "../omnichannel.js";
import type { CallLifecycle, FullTranscript, TranscriptSegment } from "../types.js";

function loadConfig(): OmnichannelConfig {
  const env = process.env;
  const required = ["DIRECTLINE_SECRET", "OC_CHANNEL_ID"];
  for (const k of required) if (!env[k]) throw new Error(`Missing env var ${k}`);
  return {
    directLineSecret: env.DIRECTLINE_SECRET!,
    directLineDomain: env.DIRECTLINE_DOMAIN ?? "https://directline.botframework.com/v3/directline",
    channelId: env.OC_CHANNEL_ID!,
  };
}

let client: OmnichannelClient | undefined;
function getClient(): OmnichannelClient {
  return (client ??= new OmnichannelClient(loadConfig()));
}

type Payload =
  | { kind: "segment"; data: TranscriptSegment }
  | { kind: "lifecycle"; data: CallLifecycle }
  | { kind: "transcript"; data: FullTranscript };

export async function transcript(
  req: HttpRequest,
  ctx: InvocationContext
): Promise<HttpResponseInit> {
  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return { status: 400, jsonBody: { error: "Invalid JSON" } };
  }

  try {
    const oc = getClient();
    if (body.kind === "lifecycle") {
      if (body.data.event === "started") await oc.ensureConversation(body.data);
      else await oc.endConversation(body.data);
    } else if (body.kind === "segment") {
      await oc.postTranscriptMessage(body.data);
    } else if (body.kind === "transcript") {
      await oc.postFullTranscript(body.data);
    } else {
      return { status: 400, jsonBody: { error: "Unknown payload kind" } };
    }
    return { status: 202, jsonBody: { ok: true } };
  } catch (err) {
    ctx.error("Ingestion failed", err);
    return { status: 500, jsonBody: { error: (err as Error).message } };
  }
}

app.http("transcript", {
  methods: ["POST"],
  authLevel: "function",
  handler: transcript,
});
