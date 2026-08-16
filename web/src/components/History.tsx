import { useCallback, useEffect, useState } from "react";
import {
  getHistory,
  getHistoryFile,
  getPrompt,
  promote,
  ApiError,
} from "../api";
import type { HistoryItem, PromoteResponse, RefineReport } from "../types";
import DiffView from "./DiffView";

type FileKind = "report" | "candidate" | "promotion" | "other";

type Selection =
  | { name: string; kind: "report"; report: RefineReport; raw: string }
  | { name: string; kind: "candidate"; content: string }
  | { name: string; kind: "promotion"; raw: string }
  | { name: string; kind: "other"; content: string };

function kindOf(name: string): FileKind {
  if (name.endsWith(".report.json")) return "report";
  if (name.endsWith(".candidate.system.md")) return "candidate";
  if (name.endsWith(".promotion.json")) return "promotion";
  return "other";
}

const KIND_LABELS: Record<FileKind, string> = {
  report: "Report",
  candidate: "Candidate",
  promotion: "Promotion",
  other: "Backup / other",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function History() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [activePrompt, setActivePrompt] = useState("");
  const [armed, setArmed] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<PromoteResponse | null>(
    null,
  );
  const [showRaw, setShowRaw] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setItems((await getHistory()).items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshPrompt = useCallback(async () => {
    try {
      setActivePrompt((await getPrompt()).content);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshPrompt();
  }, [refresh, refreshPrompt]);

  const open = async (name: string): Promise<void> => {
    setError(null);
    setPromoteResult(null);
    setArmed(false);
    setShowRaw(false);
    try {
      const content = await getHistoryFile(name);
      const kind = kindOf(name);

      if (kind === "report") {
        let report: RefineReport;
        try {
          report = JSON.parse(content) as RefineReport;
        } catch {
          setError(`Report ${name} is not valid JSON.`);
          return;
        }
        setSelection({ name, kind: "report", report, raw: content });
      } else if (kind === "promotion") {
        setSelection({ name, kind: "promotion", raw: content });
      } else {
        setSelection({
          name,
          kind,
          content,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePromote = async (): Promise<void> => {
    if (!selection || selection.kind !== "candidate") return;
    setError(null);
    setPromoteResult(null);

    try {
      if (!armed) {
        // Step 1 of 2: arming request. The backend answers 409 until
        // confirm:true is supplied — that is the expected handshake.
        try {
          await promote(selection.name, false);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            setArmed(true);
            return;
          }
          throw e;
        }
        setArmed(true);
        return;
      }

      setPromoting(true);
      const result = await promote(selection.name, true);
      setPromoteResult(result);
      setArmed(false);
      await refreshPrompt();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div className="grid">
      <section className="card" aria-labelledby="history-title">
        <h2 id="history-title">
          Audit history <span className="count">({items.length})</span>
        </h2>
        {items.length === 0 ? (
          <p className="hint">
            No history entries yet — run a refinement first.
          </p>
        ) : (
          <ul className="history-list">
            {items.map((item) => (
              <li key={item.name}>
                <button
                  type="button"
                  className={`history-item ${
                    selection?.name === item.name ? "selected" : ""
                  }`}
                  onClick={() => void open(item.name)}
                >
                  <span className={`badge badge-neutral`}>
                    {KIND_LABELS[kindOf(item.name)]}
                  </span>
                  <span className="history-name">{item.name}</span>
                  <span className="history-meta">
                    {formatBytes(item.size)} ·{" "}
                    {new Date(item.mtime).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-wide" aria-labelledby="detail-title">
        <h2 id="detail-title">{selection ? selection.name : "Detail"}</h2>

        {error && (
          <div className="check-banner banner-bad" role="alert">
            {error}
          </div>
        )}

        {!selection && <p className="hint">Select an entry to inspect it.</p>}

        {selection?.kind === "report" && (
          <div className="report-view">
            <p>
              Status:{" "}
              <span
                className={`status-badge ${
                  selection.report.status === "promoted"
                    ? "badge-ok"
                    : selection.report.status === "rejected"
                      ? "badge-bad"
                      : "badge-neutral"
                }`}
              >
                {selection.report.status}
              </span>
            </p>
            <p>
              Score: <strong>{selection.report.before.score}</strong> →{" "}
              <strong>{selection.report.after.score}</strong> · after{" "}
              {selection.report.after.passed ? "passed" : "FAILED"}
            </p>
            {selection.report.rationale.length > 0 && (
              <>
                <h3>Rationale</h3>
                <ul>
                  {selection.report.rationale.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </>
            )}
            {selection.report.before.violations.length > 0 && (
              <>
                <h3>Before — violations</h3>
                <ul>
                  {selection.report.before.violations.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </>
            )}
            {selection.report.before.strengths.length > 0 && (
              <>
                <h3>Before — strengths</h3>
                <ul>
                  {selection.report.before.strengths.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </>
            )}
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setShowRaw((prev) => !prev)}
            >
              {showRaw ? "Hide raw JSON" : "Show raw JSON"}
            </button>
            {showRaw && <pre className="log">{selection.raw}</pre>}
          </div>
        )}

        {selection?.kind === "promotion" && (
          <pre className="log">{selection.raw}</pre>
        )}

        {selection?.kind === "candidate" && (
          <div className="candidate-view">
            <div className="row">
              <button
                type="button"
                className={`btn ${armed ? "btn-danger" : "btn-primary"}`}
                onClick={() => void handlePromote()}
                disabled={promoting || activePrompt === ""}
              >
                {promoting
                  ? "Promoting…"
                  : armed
                    ? "Confirm promote — replaces active prompt"
                    : "Approve & promote (step 1 of 2)"}
              </button>
              {!armed && (
                <span className="hint">
                  Promotion is gated: the static safety scan re-runs server-side
                  before the copy.
                </span>
              )}
            </div>
            {armed && (
              <p className="hint" role="status">
                Step 2 of 2 — the active prompt will be backed up to{" "}
                <code>prompt-history/</code> and replaced by this candidate.
              </p>
            )}
            {promoteResult && (
              <div className="check-banner banner-ok" role="status">
                Promoted. Backup: <code>{promoteResult.backup}</code>
              </div>
            )}
            {activePrompt ? (
              <DiffView before={activePrompt} after={selection.content} />
            ) : (
              <p className="hint">Loading the active prompt for comparison…</p>
            )}
          </div>
        )}

        {selection?.kind === "other" && (
          <pre className="log">{selection.content}</pre>
        )}
      </section>
    </div>
  );
}
