// HTTP control surface for the live-transcription consumer.
//
//   POST /session/start   { contactId, ani?, agentId?, streamArn?, streamName?, startFragmentNumber? }
//   POST /session/agent   { contactId, connectAgent }   (from the agent-whisper flow)
//   POST /session/stop    { contactId }
//   GET  /                health/liveness
//
// The Amazon Connect contact flow (via a tiny Lambda) calls /session/start right
// after "Start media streaming" so this service begins reading the call's KVS
// audio, transcribing it with Azure AI Speech, and posting utterances to the
// D365 ingestor in real time.

import express from "express";
import { env } from "./env.js";
import { sessionRegistry, type StartSessionInput } from "./session.js";

const app = express();
app.use(express.json());

function authOk(req: express.Request): boolean {
  if (!env.sessionKey) return true;
  return req.header("x-session-key") === env.sessionKey;
}

app.get("/", (_req, res) => res.status(200).json({ ok: true, sessions: sessionRegistry.count() }));

app.post("/session/start", async (req, res) => {
  if (!authOk(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const b = (req.body ?? {}) as Partial<StartSessionInput>;
  if (!b.contactId) {
    res.status(400).json({ error: "contactId is required" });
    return;
  }
  if (!b.streamArn && !b.streamName) {
    res.status(400).json({ error: "streamArn or streamName is required" });
    return;
  }
  // Acknowledge immediately so the Connect flow isn't held up; work runs async.
  res.status(202).json({ ok: true });
  try {
    await sessionRegistry.start({
      contactId: b.contactId,
      ani: b.ani,
      agentId: b.agentId,
      streamArn: b.streamArn,
      streamName: b.streamName,
      startFragmentNumber: b.startFragmentNumber,
    });
  } catch (err) {
    console.error(`Failed to start session for ${b.contactId}`, err);
  }
});

app.post("/session/stop", async (req, res) => {
  if (!authOk(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const contactId = (req.body ?? {}).contactId as string | undefined;
  if (!contactId) {
    res.status(400).json({ error: "contactId is required" });
    return;
  }
  const stopped = await sessionRegistry.stop(contactId);
  res.status(stopped ? 202 : 404).json({ ok: stopped });
});

// Called by the Connect agent-whisper flow (via a tiny Lambda) the instant an
// agent accepts the contact. Pins the accepting agent onto the live session so
// the D365 conversation is created on — and routed to — that specific person.
app.post("/session/agent", async (req, res) => {
  if (!authOk(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const b = (req.body ?? {}) as { contactId?: string; connectAgent?: string };
  if (!b.contactId || !b.connectAgent) {
    res.status(400).json({ error: "contactId and connectAgent are required" });
    return;
  }
  const mapped = env.connectAgentMap[b.connectAgent];
  if (!mapped) {
    console.warn(
      `/session/agent: no CONNECT_AGENT_MAP entry for "${b.connectAgent}"; using it verbatim as the routing token`,
    );
  }
  const agentId = mapped ?? b.connectAgent;
  // Acknowledge immediately so the Connect flow isn't held up; work runs async.
  res.status(202).json({ ok: true });
  try {
    const applied = await sessionRegistry.setAgent(b.contactId, agentId);
    if (!applied) console.warn(`/session/agent: no live session for contact ${b.contactId}`);
  } catch (err) {
    console.error(`/session/agent failed for ${b.contactId}`, err);
  }
});

app.listen(env.port, () => console.log(`kvs-consumer listening on ${env.port}`));
