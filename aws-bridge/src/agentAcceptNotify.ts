// Agent-accept-notify Lambda — invoked by the Amazon Connect AGENT WHISPER flow
// the instant an agent accepts a contact. The whisper flow runs in the accepting
// agent's context, so it maps $.Agent.Username into the `connectAgent` parameter.
// This is the definitive accepting-agent signal: synchronous, at the exact accept
// moment, in the agent's own context.
//
// DESIGN: we do NOT route/create the D365 conversation server-side (that can't
// scale across 40k agents who move between queues, and there is no maintained
// Connect->D365 identity map). Instead we push an `assigned` frame to THAT
// agent's own D365 CIF widget over the WebSocket it already holds. The widget —
// running inside the agent's authenticated D365 session — then subscribes the
// live panel and opens the Omnichannel conversation on itself. Correlation is by
// SSO email: the agent's Connect email == their D365 email (same IdP), resolved
// at runtime from Connect (no mapping table).

import { resolveAgentEmail } from "./agentEmail.js";
import { notifyAssigned } from "./ws.js";

interface ConnectEvent {
  Details: {
    ContactData: {
      ContactId: string;
      Attributes?: Record<string, string>;
    };
    Parameters?: Record<string, string>;
  };
}

export async function handler(event: ConnectEvent): Promise<{ ok: boolean; delivered: number }> {
  const cd = event.Details.ContactData;
  const params = event.Details.Parameters ?? {};

  const contactId = cd.ContactId;
  const connectAgent = params.connectAgent || cd.Attributes?.connectAgent;

  if (!connectAgent) {
    console.error(
      `agent-accept-notify: no connectAgent for contact ${contactId}. ` +
        `Map $.Agent.Username to the "connectAgent" Lambda parameter in the ` +
        `agent whisper flow.`,
    );
    return { ok: false, delivered: 0 };
  }

  // Resolve the accepting agent's SSO email (the key the widget declared). We
  // also pass the raw username as a candidate for instances where the Connect
  // username IS the email (SAML federation) or a widget declared it verbatim.
  const email = await resolveAgentEmail(connectAgent);
  const candidates = [email, connectAgent].filter((v): v is string => Boolean(v));

  const delivered = await notifyAssigned(candidates, contactId);
  console.log(
    `agent-accept-notify: contact ${contactId} accepted by ${connectAgent}` +
      (email ? ` (${email})` : "") +
      ` -> pushed 'assigned' to ${delivered} widget connection(s)`,
  );

  // Best-effort: also notify the live-audio consumer (non-fatal). This no longer
  // routes the conversation; it only tags the live session with the agent.
  const consumerUrl = process.env.CONSUMER_URL?.replace(/\/+$/, "");
  if (consumerUrl) {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const sessionKey = process.env.SESSION_KEY;
      if (sessionKey) headers["x-session-key"] = sessionKey;
      const res = await fetch(`${consumerUrl}/session/agent`, {
        method: "POST",
        headers,
        body: JSON.stringify({ contactId, connectAgent }),
      });
      if (!res.ok) {
        console.warn(`agent-accept-notify: consumer /session/agent returned ${res.status} (ignored)`);
      }
    } catch (err) {
      console.warn("agent-accept-notify: consumer /session/agent notify failed (ignored)", err);
    }
  }

  return { ok: true, delivered };
}
