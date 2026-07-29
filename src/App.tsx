import { useEffect, useRef, useState } from "react";
import { openSoftphone, isSoftphoneOpen, closeSoftphone } from "./connect/ccp";
import {
  loadCIFramework,
  showPanel,
  getCurrentUserEmail,
  openConversationByContactIdWithRetry,
} from "./cif/ciframework";
import {
  TranscriptBridge,
  type TranscriptSegment,
  type SuggestionEvent,
} from "./bridge/transcript";

export default function App() {
  const bridgeRef = useRef<TranscriptBridge>();
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [wsOpen, setWsOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [agentName, setAgentName] = useState<string>();
  const [activeContactId, setActiveContactId] = useState<string>();

  useEffect(() => {
    const bridge = new TranscriptBridge();
    bridgeRef.current = bridge;

    // 1) Handshake with D365 CIFv2, expand the panel, then self-identify. The
    //    agent's D365 email is the natural SSO key the bridge matches against
    //    Amazon Connect's agent identity — no maintained Connect->D365 map.
    loadCIFramework()
      .then((cif) => cif.setClickToAct(true))
      .then(() => showPanel(420))
      .then(() => getCurrentUserEmail())
      .then((email) => {
        if (email) {
          setAgentName(email);
          bridge.identify(email);
        }
      })
      .catch((err) => console.error("CIF init failed", err));

    // 2) Live transcript bridge. It streams THIS agent's accepted-call transcript
    //    and pushes `assigned`/`ended` so the right conversation lands on the
    //    right agent — in this agent's own authenticated browser session.
    bridge.connect({
      onStatus: setWsOpen,
      onSegment: (s) =>
        setSegments((prev) => {
          // Replace the trailing partial for the same participant, else append.
          if (prev.length && prev[prev.length - 1].partial) {
            const copy = prev.slice(0, -1);
            return [...copy, s];
          }
          return [...prev, s];
        }),
      onSuggestion: (s: SuggestionEvent) =>
        setSuggestions((prev) => [s.suggestion, ...prev].slice(0, 5)),
      onAssigned: (contactId) => {
        // This agent just accepted this contact in the softphone.
        setActiveContactId(contactId);
        setSegments([]);
        setSuggestions([]);
        bridge.subscribe(contactId);
      },
      onEnded: (contactId) => {
        bridge.unsubscribe();
        setActiveContactId((cur) => (cur === contactId ? undefined : cur));
        // The conversation is built from the post-call transcript, so it lands a
        // little after the call ends — retry until it exists, then open it on
        // this agent for wrap-up / Copilot review.
        void openConversationByContactIdWithRetry(contactId);
      },
    });

    // 3) Track the docked companion softphone window (where the agent accepts).
    const poll = window.setInterval(() => setPhoneOpen(isSoftphoneOpen()), 1000);

    return () => {
      window.clearInterval(poll);
      bridge.dispose();
    };
  }, []);

  const handleOpen = () => {
    openSoftphone();
    setPhoneOpen(true);
  };

  const handleClose = () => {
    closeSoftphone();
    setPhoneOpen(false);
  };

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <strong>Amazon Connect</strong>
        <span style={{ ...styles.dot, background: wsOpen ? "#2ecc71" : "#e74c3c" }} />
        <span style={styles.state}>{agentName ?? "signed out"}</span>
        {activeContactId && <span style={styles.badge}>on call</span>}
      </header>

      {/* Amazon Connect softphone launcher (docked companion window). The CCP
          cannot be iframed on this instance (frame-ancestors 'self'; see
          AWS-SUPPORT-CASE-frame-ancestors.md), so the softphone runs in a
          companion window. The accept event reaches this widget over the bridge
          WebSocket (`assigned`), not from the CCP. */}
      <section style={styles.launcher}>
        <div style={styles.launcherRow}>
          <span
            style={{ ...styles.dot, background: phoneOpen ? "#2ecc71" : "#a19f9d" }}
          />
          <span style={styles.launcherText}>
            {phoneOpen
              ? "Softphone is docked to the right."
              : "Open the softphone to take calls."}
          </span>
        </div>
        <div style={styles.launcherRow}>
          <button style={styles.primaryBtn} onClick={handleOpen}>
            {phoneOpen ? "Focus softphone" : "Open softphone"}
          </button>
          {phoneOpen && (
            <button style={styles.secondaryBtn} onClick={handleClose}>
              Close
            </button>
          )}
        </div>
      </section>

      {/* Live transcript */}
      <section style={styles.panel}>
        <h4 style={styles.h4}>Live transcript</h4>
        <div style={styles.transcript}>
          {segments.length === 0 && (
            <em style={styles.muted}>
              {activeContactId ? "Waiting for audio…" : "No active call."}
            </em>
          )}
          {segments.map((s, i) => (
            <div key={i} style={styles.line}>
              <span style={styles.speaker}>{s.participant}:</span> {s.content}
              {s.sentiment && (
                <span style={styles.sentiment}>{sentimentIcon(s.sentiment)}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Azure OpenAI agent assist */}
      <section style={styles.panel}>
        <h4 style={styles.h4}>Suggestions</h4>
        {suggestions.length === 0 && <em style={styles.muted}>No suggestions yet.</em>}
        {suggestions.map((s, i) => (
          <div key={i} style={styles.suggestion}>
            {s}
          </div>
        ))}
      </section>
    </div>
  );
}

function sentimentIcon(s: string) {
  return s === "POSITIVE" ? " 🙂" : s === "NEGATIVE" ? " 🙁" : " 😐";
}

const styles: Record<string, React.CSSProperties> = {
  shell: { display: "flex", flexDirection: "column", height: "100vh", font: "13px system-ui" },
  header: { display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "#f3f2f1" },
  dot: { width: 8, height: 8, borderRadius: 4, display: "inline-block" },
  state: { textTransform: "capitalize", color: "#605e5c" },
  badge: { marginLeft: "auto", background: "#107c10", color: "#fff", borderRadius: 10, padding: "1px 8px", fontSize: 11 },
  launcher: { padding: "12px 10px", borderBottom: "1px solid #edebe9", display: "flex", flexDirection: "column", gap: 8 },
  launcherRow: { display: "flex", alignItems: "center", gap: 8 },
  launcherText: { color: "#605e5c" },
  primaryBtn: { background: "#0078d4", color: "#fff", border: 0, borderRadius: 4, padding: "6px 12px", cursor: "pointer", font: "inherit" },
  secondaryBtn: { background: "#fff", color: "#323130", border: "1px solid #8a8886", borderRadius: 4, padding: "6px 12px", cursor: "pointer", font: "inherit" },
  panel: { padding: "8px 10px", overflow: "auto", borderBottom: "1px solid #edebe9" },
  h4: { margin: "0 0 6px" },
  transcript: { display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflow: "auto" },
  line: { lineHeight: 1.4 },
  speaker: { fontWeight: 600, color: "#0078d4" },
  sentiment: { marginLeft: 4 },
  suggestion: { background: "#eff6fc", border: "1px solid #cfe4fa", borderRadius: 4, padding: "6px 8px", marginBottom: 6 },
  muted: { color: "#a19f9d" },
};
