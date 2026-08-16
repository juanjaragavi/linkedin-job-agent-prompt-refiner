import { useCallback, useEffect, useRef, useState } from "react";
import {
  getHealth,
  getLogs,
  getModels,
  runCheck,
  startRefine,
  subscribePipeline,
} from "../api";
import type {
  CheckResult,
  HealthStatus,
  ModelInfo,
  PipelineEvent,
  RefineRunResponse,
} from "../types";

export default function Dashboard({
  onNavigate,
}: {
  onNavigate: (tab: "history") => void;
}) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [refinerModel, setRefinerModel] = useState<string>("");
  const [evaluatorModel, setEvaluatorModel] = useState<string>("");
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [issuesFile, setIssuesFile] = useState(
    "evaluations/prompt-refinement/issues.json",
  );
  const [feedback, setFeedback] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RefineRunResponse | null>(null);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [checkRunning, setCheckRunning] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await getHealth());
    } catch {
      // The top bar surfaces connectivity; keep the card quiet here.
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  useEffect(() => {
    void getModels()
      .then((res) => {
        setModels(res.models);
        setRefinerModel((current) => current || res.defaultRefiner);
        setEvaluatorModel((current) => current || res.defaultEvaluator);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void getLogs()
      .then((logs) => setEvents(logs.events))
      .catch(() => {});
    const unsubscribe = subscribePipeline((event) => {
      setEvents((prev) => [...prev.slice(-199), event]);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  const handleRun = async (): Promise<void> => {
    setRunning(true);
    setRunError(null);
    setRunResult(null);
    try {
      const items = feedback
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
      const result = await startRefine(
        issuesFile,
        items.length > 0 ? items : undefined,
        refinerModel || undefined,
        evaluatorModel || undefined,
      );
      setRunResult(result);
      void refreshHealth();
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  const handleCheck = async (): Promise<void> => {
    setCheckRunning(true);
    try {
      setCheckResult(await runCheck());
    } catch (error) {
      setCheckResult({
        exitCode: 1,
        passed: false,
        lines: [error instanceof Error ? error.message : String(error)],
      });
    } finally {
      setCheckRunning(false);
    }
  };

  return (
    <div className="grid">
      <section className="card" aria-labelledby="health-title">
        <h2 id="health-title">Pipeline status</h2>
        {health ? (
          <dl className="status-grid">
            <div>
              <dt>Active prompt</dt>
              <dd>
                {health.status.promptPresent ? (
                  <span className="ok">present</span>
                ) : (
                  <span className="bad">missing</span>
                )}{" "}
                · {health.status.promptChars.toLocaleString()} chars
              </dd>
            </div>
            <div>
              <dt>Issues on file</dt>
              <dd>{health.status.issuesParsed}</dd>
            </div>
            <div>
              <dt>Refiner model</dt>
              <dd>
                <code>{health.status.model}</code>
              </dd>
            </div>
            <div>
              <dt>Providers</dt>
              <dd
                className="row"
                style={{ margin: "0.15rem 0 0", gap: "0.35rem" }}
              >
                <span
                  className={`chip ${health.providers.anthropic ? "chip-ok" : "chip-error"}`}
                >
                  Anthropic {health.providers.anthropic ? "✓" : "key missing"}
                </span>
                <span
                  className={`chip ${health.providers.nvidia ? "chip-ok" : "chip-error"}`}
                >
                  NVIDIA {health.providers.nvidia ? "✓" : "key missing"}
                </span>
              </dd>
            </div>
          </dl>
        ) : (
          <p>Health check unavailable.</p>
        )}

        <h3>Static safety check</h3>
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={() => void handleCheck()}
            disabled={checkRunning}
          >
            {checkRunning ? "Running…" : "Run prompt:check"}
          </button>
        </div>
        {checkResult && (
          <div
            className={`check-banner ${checkResult.passed ? "banner-ok" : "banner-bad"}`}
            role="status"
          >
            {checkResult.passed
              ? "All checks passed (exit 0)."
              : `Checks failed (exit ${checkResult.exitCode}).`}
          </div>
        )}
        {checkResult && (
          <pre className="log">{checkResult.lines.join("\n")}</pre>
        )}
      </section>

      <section className="card" aria-labelledby="run-title">
        <h2 id="run-title">Run refinement</h2>
        <label className="field">
          <span className="label-text">
            Issues file (JSON, inside the project root)
          </span>
          <input
            type="text"
            value={issuesFile}
            onChange={(event) => setIssuesFile(event.target.value)}
          />
        </label>
        <div className="form-row">
          <label className="field">
            <span className="label-text">Refiner model</span>
            <select
              value={refinerModel}
              onChange={(event) => setRefinerModel(event.target.value)}
            >
              {models.length === 0 && <option value="">Loading models…</option>}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                  {!model.configured ? " — key not configured" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label-text">Evaluator model</span>
            <select
              value={evaluatorModel}
              onChange={(event) => setEvaluatorModel(event.target.value)}
            >
              {models.length === 0 && <option value="">Loading models…</option>}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                  {!model.configured ? " — key not configured" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="label-text">
            Optional human feedback (one item per line, <code>#</code> comments
            ignored)
          </span>
          <textarea
            rows={4}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder={
              "Example:\n# tighten the browser-failure rule\nNever retry unrelated selectors after a failure."
            }
          />
        </label>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleRun()}
            disabled={running}
          >
            {running ? "Running…" : "Run refinement"}
          </button>
          {running && (
            <span className="hint">
              Can take several minutes — watch the live log.
            </span>
          )}
        </div>
        {runError && (
          <div className="check-banner banner-bad" role="alert">
            {runError}
          </div>
        )}
        {runResult && (
          <div className="run-result">
            <p>
              Status:{" "}
              <span
                className={`status-badge ${
                  runResult.status === "promoted"
                    ? "badge-ok"
                    : runResult.status === "rejected"
                      ? "badge-bad"
                      : "badge-neutral"
                }`}
              >
                {runResult.status}
              </span>
            </p>
            <p>
              Adversarial score:{" "}
              <strong>{runResult.result.before.score}</strong> →{" "}
              <strong>{runResult.result.after.score}</strong> (after{" "}
              {runResult.result.after.passed ? "passed" : "FAILED"})
            </p>
            {runResult.result.rationale.length > 0 && (
              <ul>
                {runResult.result.rationale.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            )}
            <p className="hint">
              Report: <code>{runResult.reportPath}</code>
            </p>
            {runResult.candidatePath && (
              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onNavigate("history")}
                >
                  Review candidate &amp; promote →
                </button>
                <span className="hint">
                  <code>{runResult.candidatePath}</code>
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card card-wide" aria-labelledby="log-title">
        <h2 id="log-title">Live pipeline log</h2>
        <div className="log" ref={logRef} aria-live="polite">
          {events.length === 0 ? (
            <p className="hint">No pipeline events yet — start a run.</p>
          ) : (
            events.map((event, index) => (
              <div key={index} className="log-line">
                <span className="log-stage">{event.stage}</span>
                <time className="log-time">
                  {new Date(event.at).toLocaleTimeString()}
                </time>
                <span className="log-msg">{event.message}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
