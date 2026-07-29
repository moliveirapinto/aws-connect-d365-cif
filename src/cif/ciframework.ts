// Thin, typed wrapper around the Channel Integration Framework 2.0 (CIFv2)
// client library that D365 exposes as window.Microsoft.CIFramework.
//
// The library is not on npm; it is served by your D365 org at
//   /webresources/Widget/msdyn_ciLibrary.js
// We inject that script at runtime so the provider stays org-agnostic.

import { config } from "../config";

type CIFrameworkApi = {
  setClickToAct: (value: boolean) => Promise<boolean>;
  setMode: (mode: number) => Promise<number>;
  setWidth: (widthValue: number) => Promise<number>;
  addHandler: (eventName: string, handler: (payload: string) => void) => void;
  removeHandler: (eventName: string, handler: (payload: string) => void) => void;
  searchAndOpenRecords: (
    entityName: string,
    queryParameters: string,
    searchOnly: boolean
  ) => Promise<string>;
  createRecord: (entityName: string, attributes: string) => Promise<string>;
  createSession: (input: unknown) => Promise<string>;
  getFocusedSession: () => Promise<string>;
  requestFocusSession: (sessionId: string) => Promise<void>;
  notifyEvent: (input: unknown) => Promise<void>;
  getEnvironment: () => Promise<string>;
};

declare global {
  interface Window {
    Microsoft?: { CIFramework?: CIFrameworkApi };
  }
}

let readyPromise: Promise<CIFrameworkApi> | null = null;

/** Loads the CIF client library from the configured D365 org and resolves the API. */
export function loadCIFramework(): Promise<CIFrameworkApi> {
  if (readyPromise) return readyPromise;

  readyPromise = new Promise<CIFrameworkApi>((resolve, reject) => {
    if (window.Microsoft?.CIFramework) {
      resolve(window.Microsoft.CIFramework);
      return;
    }
    if (!config.d365OrgUrl) {
      reject(new Error("VITE_D365_ORG_URL is not configured."));
      return;
    }

    const script = document.createElement("script");
    script.src = `${config.d365OrgUrl}/webresources/Widget/msdyn_ciLibrary.js`;
    script.setAttribute("data-crmurl", config.d365OrgUrl);
    script.setAttribute("data-cifid", "CIFMainLibrary");
    script.onload = () => {
      // CIF signals readiness via the CIFInitDone event on the widget iframe.
      const onReady = () => {
        if (window.Microsoft?.CIFramework) {
          resolve(window.Microsoft.CIFramework);
        } else {
          reject(new Error("CIF library loaded but Microsoft.CIFramework missing."));
        }
      };
      if (window.Microsoft?.CIFramework) onReady();
      else window.addEventListener("CIFInitDone", onReady, { once: true });
    };
    script.onerror = () =>
      reject(new Error("Failed to load msdyn_ciLibrary.js from D365 org."));
    document.head.appendChild(script);
  });

  return readyPromise;
}

/**
 * Expand the CIF panel so the widget is visible. CIFv2 panels load minimized
 * (mode 0) by default; the hosted widget must request expansion itself.
 * No-op (resolves false) when not hosted inside CIF.
 */
export async function showPanel(width = 420): Promise<boolean> {
  try {
    const cif = await loadCIFramework();
    if (typeof cif.setWidth === "function") await cif.setWidth(width);
    await cif.setMode(1);
    return true;
  } catch (err) {
    console.warn("CIF showPanel skipped (not hosted in CIF?)", err);
    return false;
  }
}

/**
 * Screen-pop: search the configured entity for the caller's phone number and
 * open the matching record in the agent workspace.
 */
export async function screenPopByPhone(phone: string): Promise<void> {
  const cif = await loadCIFramework();
  const query = `?$select=${encodeURIComponent(
    config.screenPopPhoneColumn
  )}&$filter=${encodeURIComponent(`${config.screenPopPhoneColumn} eq '${phone}'`)}`;
  await cif.searchAndOpenRecords(config.screenPopEntity, query, false);
}

/**
 * Open the Omnichannel conversation that corresponds to an Amazon Connect
 * contactId on THIS agent's screen — the per-agent, queue-free landing.
 *
 * How the correlation works: the server pipeline stamps the contactId onto the
 * conversation as an Omnichannel context item
 * (`msdyn_ocliveworkitemcontextitem`: name="contactId", value=<contactId>). We
 * resolve that context row to its parent `msdyn_ocliveworkitem` and open it.
 * Because this call executes inside the accepting agent's own authenticated D365
 * session, the conversation opens on exactly that agent — no queue, no routing
 * rule, no Connect->D365 identity map.
 *
 * The conversation is created by the (post-call) server pipeline, so it may not
 * exist at accept-time; callers should invoke this when it has materialised
 * (e.g. on call end) or retry via {@link openConversationByContactIdWithRetry}.
 *
 * @returns true if a matching conversation was found and opened.
 */
export async function openConversationByContactId(contactId: string): Promise<boolean> {
  const cif = await loadCIFramework();

  // 1) Find the context item carrying this contactId; return its parent work item.
  const ctxQuery =
    `?$select=_msdyn_ocliveworkitemid_value&$top=1&$filter=` +
    encodeURIComponent(`msdyn_name eq 'contactId' and msdyn_value eq '${contactId}'`);
  const raw = await cif.searchAndOpenRecords(
    "msdyn_ocliveworkitemcontextitem",
    ctxQuery,
    /* searchOnly */ true
  );
  const workItemId = extractFirstField(raw, "_msdyn_ocliveworkitemid_value");
  if (!workItemId) return false;

  // 2) Open the conversation record on this agent's screen.
  const openQuery =
    `?$filter=` + encodeURIComponent(`msdyn_ocliveworkitemid eq ${workItemId}`);
  await cif.searchAndOpenRecords("msdyn_ocliveworkitem", openQuery, /* searchOnly */ false);
  return true;
}

/**
 * Retry wrapper for {@link openConversationByContactId}. The server creates the
 * conversation from the post-call transcript, so on call-end there is a short
 * window before the work item exists. Polls a few times, then gives up quietly.
 */
export async function openConversationByContactIdWithRetry(
  contactId: string,
  attempts = 6,
  intervalMs = 5000
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      if (await openConversationByContactId(contactId)) return true;
    } catch (err) {
      console.warn("openConversationByContactId attempt failed", err);
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Resolve the email/UPN of the D365 agent currently signed into THIS browser
 * session. This is the natural, self-maintaining key that ties the agent to
 * their Amazon Connect identity (both are the same corporate SSO identity), so
 * the bridge can route "this contact is yours" to the right agent without any
 * hand-maintained Connect->D365 mapping table.
 */
export async function getCurrentUserEmail(): Promise<string | undefined> {
  const cif = await loadCIFramework();
  let userId: string | undefined;
  try {
    const env = JSON.parse(await cif.getEnvironment()) as { userId?: string };
    userId = env.userId?.replace(/[{}]/g, "");
  } catch {
    /* getEnvironment unavailable */
  }
  if (!userId) return undefined;
  const query =
    `?$select=internalemailaddress&$top=1&$filter=` +
    encodeURIComponent(`systemuserid eq ${userId}`);
  const raw = await cif.searchAndOpenRecords("systemuser", query, /* searchOnly */ true);
  return extractFirstField(raw, "internalemailaddress");
}

/**
 * Parse the JSON returned by searchAndOpenRecords(searchOnly=true) and pull the
 * first value of `field`. CIF has returned a couple of shapes across versions
 * ({ value: [...] } and an index-keyed object), so we tolerate both.
 */
function extractFirstField(raw: string, field: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rows: Array<Record<string, unknown>> = Array.isArray(
      (parsed as { value?: unknown }).value
    )
      ? ((parsed as { value: Array<Record<string, unknown>> }).value)
      : Object.keys(parsed)
          .filter((k) => /^\d+$/.test(k))
          .map((k) => parsed[k] as Record<string, unknown>);
    for (const row of rows) {
      const id = row?.[field];
      if (id) return String(id);
    }
  } catch {
    /* not JSON / unexpected shape */
  }
  return undefined;
}

/** Persist a transcript line to Dataverse (customize the entity/columns to your schema). */
export async function writeTranscriptLine(
  _conversationRef: string,
  speaker: string,
  text: string
): Promise<void> {
  const cif = await loadCIFramework();
  await cif.createRecord(
    "annotation",
    JSON.stringify({
      subject: `Transcript (${speaker})`,
      notetext: text,
      // Bind to your conversation/case as needed, e.g.:
      // "objectid_incident@odata.bind": `/incidents(${_conversationRef})`,
    })
  );
}
