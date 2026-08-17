import { useEffect, useState, type ReactNode } from "react";
import { getHealth } from "./api";
import type { HealthStatus } from "./types";
import Dashboard from "./components/Dashboard";
import PromptEditor from "./components/PromptEditor";
import Issues from "./components/Issues";
import History from "./components/History";
import Manual from "./components/Manual";
import { WorkspaceProvider } from "./workspace";

type Tab = "dashboard" | "editor" | "issues" | "history" | "manual";
type Theme = "light" | "dark";

const THEME_KEY = "prompt-editor.theme";
const SIDEBAR_KEY = "prompt-editor.sidebar-collapsed";

function initialCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "true";
  } catch {
    return false;
  }
}

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

const THEME_META: Record<Theme, string> = {
  light: "#faf7f2",
  dark: "#171310",
};

const GLYPHS: Record<Tab, ReactNode> = {
  dashboard: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="1.5"
        y="1.5"
        width="5"
        height="5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="9.5"
        y="1.5"
        width="5"
        height="5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="1.5"
        y="9.5"
        width="5"
        height="5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="9.5"
        y="9.5"
        width="5"
        height="5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  ),
  editor: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 13.5h4L13.5 7a1.6 1.6 0 0 0-2.3-2.3L4.8 11 3 13.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10.5 5.5l1.8 1.8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  issues: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 1.8v12.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M3 3h7l-1.4 2.2L10 7.4H3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M3 10.6h4.2l-1-1.6L8.4 7.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  ),
  history: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 4.6V8l2.4 1.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  manual: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 2.2h7.2L13 4.6v9.2H3V2.2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M10.2 2.2v2.4h2.8M5.4 7.6h5.2M5.4 10.2h5.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "editor", label: "Prompt Editor" },
  { id: "issues", label: "Issues" },
  { id: "history", label: "History" },
  { id: "manual", label: "Manual" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [collapsed, setCollapsed] = useState<boolean>(initialCollapsed);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(collapsed));
    } catch {
      /* storage unavailable */
    }
  }, [collapsed]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable */
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_META[theme]);
  }, [theme]);

  const toggleTheme = (): void => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  };

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

  const apiOnline = !healthError && health !== null;

  return (
    <WorkspaceProvider>
      <div className={collapsed ? "app app-collapsed" : "app"}>
        <aside className="sidebar" aria-label="Primary navigation">
          <div className="side-brand">
            <span className="brand-mark">
              Prompt<em>refiner</em>
            </span>
            <button
              type="button"
              className="side-collapse"
              onClick={() => setCollapsed((value) => !value)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d={collapsed ? "M6 3l5 5-5 5" : "M10 3L5 8l5 5"}
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <nav className="side-nav">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={tab === t.id ? "nav-item active" : "nav-item"}
                aria-current={tab === t.id ? "page" : undefined}
                onClick={() => setTab(t.id)}
                title={collapsed ? t.label : undefined}
              >
                <span className="nav-glyph">{GLYPHS[t.id]}</span>
                <span className="nav-label">{t.label}</span>
              </button>
            ))}
          </nav>

          <div className="side-foot">
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-pressed={theme === "dark"}
              title={
                theme === "dark"
                  ? "Switch to day paper"
                  : "Switch to night manuscript"
              }
            >
              {theme === "dark" ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r="3.4"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <path
                    d="M8 1.2v1.8M8 13v1.8M1.2 8h1.8M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M3.2 12.8l1.3-1.3M11.5 4.5l1.3-1.3"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M13.4 9.6A5.7 5.7 0 0 1 6.4 2.6a5.7 5.7 0 1 0 7 7Z"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              <span>{theme === "dark" ? "Day paper" : "Night manuscript"}</span>
            </button>
            <div className="side-status" role="status">
              <span className={apiOnline ? "chip chip-ok" : "chip chip-error"}>
                {healthError
                  ? "API offline"
                  : health
                    ? "API online"
                    : "Connecting…"}
              </span>
              <span
                className={
                  health?.providers.anthropic
                    ? "chip chip-ok"
                    : "chip chip-error"
                }
                title="Anthropic provider key"
              >
                Anthropic {health?.providers.anthropic ? "✓" : "✕"}
              </span>
              <span
                className={
                  health?.providers.nvidia ? "chip chip-ok" : "chip chip-error"
                }
                title="NVIDIA provider key"
              >
                NVIDIA {health?.providers.nvidia ? "✓" : "✕"}
              </span>
            </div>
            <span className="side-model" title="Default refiner model">
              {health?.status.model ?? "model —"}
            </span>
            <p className="side-motto">
              “Nothing is promoted without your hand. Every write is backed up,
              every change audited.”
            </p>
          </div>
        </aside>

        <main className="main">
          <div className="view">
            {tab === "dashboard" && <Dashboard onNavigate={setTab} />}
            {tab === "editor" && <PromptEditor onNavigate={setTab} />}
            {tab === "issues" && <Issues />}
            {tab === "history" && <History />}
            {tab === "manual" && <Manual />}
          </div>
        </main>
      </div>
    </WorkspaceProvider>
  );
}
