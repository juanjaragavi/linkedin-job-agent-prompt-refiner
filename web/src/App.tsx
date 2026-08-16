import { useEffect, useState } from "react";
import { getHealth } from "./api";
import type { HealthStatus } from "./types";
import Dashboard from "./components/Dashboard";
import PromptEditor from "./components/PromptEditor";
import Issues from "./components/Issues";
import History from "./components/History";

type Tab = "dashboard" | "editor" | "issues" | "history";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "editor", label: "Prompt Editor" },
  { id: "issues", label: "Issues" },
  { id: "history", label: "History" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const refreshHealth = async (): Promise<void> => {
    try {
      setHealth(await getHealth());
      setHealthError(null);
    } catch (error) {
      setHealthError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void refreshHealth();
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>
            Prompt Refiner{" "}
            <span className="brand-sub">Governance Dashboard</span>
          </h1>
        </div>
        <nav className="tabs" aria-label="Primary navigation">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? "tab active" : "tab"}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="health-chip" role="status">
          {healthError ? (
            <span className="chip chip-error" title={healthError}>
              API offline
            </span>
          ) : health ? (
            <span
              className="chip chip-ok"
              title={`${health.status.promptChars} chars · model ${health.status.model}`}
            >
              {health.status.promptPresent ? "Prompt OK" : "Prompt missing"} ·{" "}
              {health.status.issuesParsed} issues
            </span>
          ) : (
            <span className="chip">Loading…</span>
          )}
        </div>
      </header>

      <main className="main">
        {tab === "dashboard" && <Dashboard onNavigate={setTab} />}
        {tab === "editor" && <PromptEditor />}
        {tab === "issues" && <Issues />}
        {tab === "history" && <History />}
      </main>

      <footer className="footer">
        <p>
          Safety model: candidates are never auto-promoted. Every write is
          backed up to <code>prompt-history/</code> and the active prompt is
          only replaced after explicit two-step confirmation.
        </p>
      </footer>
    </div>
  );
}
