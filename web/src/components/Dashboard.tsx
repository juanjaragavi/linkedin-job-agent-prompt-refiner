import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
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
import { renderMarkdown } from "../markdown";
import { documentStats, useWorkspace } from "../workspace";

const MAX_UPLOAD_CHARS = 150_000;

function isMarkdownFile(name: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(name);
}

export default function Dashboard({
  onNavigate,
}: {
  onNavigate: (tab: "history" | "editor") => void;
}) {
  const {
    document: workspaceDoc,
    loadDocument,
    clearDocument,
  } = useWorkspace();
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
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<"upload" | "paste">("upload");
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadedStats = useMemo(
    () => (workspaceDoc ? documentStats(workspaceDoc.content) : null),
    [workspaceDoc],
  );

  const loadPrompt = (
    name: string,
    content: string,
    source: "upload" | "paste",
  ): void => {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      setUploadError("The prompt is empty — paste or upload a non-empty file.");
      return;
    }
    if (trimmed.length > MAX_UPLOAD_CHARS) {
      setUploadError(
        `Prompt is too large (${trimmed.length.toLocaleString()} chars, max ${MAX_UPLOAD_CHARS.toLocaleString()}).`,
      );
      return;
    }
    loadDocument(name, trimmed, source);
    setUploadError(null);
  };

  const handleFile = (file: File): void => {
    if (!isMarkdownFile(file.name)) {
      setUploadError(
        `Only Markdown files are accepted — “${file.name}” is not a .md file.`,
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      loadPrompt(file.name, content, "upload");
    };
    reader.onerror = () =>
      setUploadError("The file could not be read — try again.");
    reader.readAsText(file);
  };

  const handlePick = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handlePasteLoad = (): void => {
    loadPrompt("pasted prompt", pasteText, "paste");
  };

  const clearUploaded = (): void => {
    clearDocument();
    setUploadError(null);
    setPasteText("");
  };

  const onDropzoneKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  };

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
    if (!workspaceDoc) {
      setRunError("Load a prompt first — upload or paste a Markdown file.");
      return;
    }
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
        workspaceDoc.content,
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
      <section className="card card-wide" aria-labelledby="start-title">
        <h2 id="start-title">Start here — load a prompt</h2>
        <p className="hint">
          Upload or paste the prompt you want to refine. Nothing is loaded until
          you choose a document, and the active on-file prompt is never
          overwritten. Whatever you load here also opens in the Markdown editor
          so you can edit it live.
        </p>

        <div className="seg" role="group" aria-label="Prompt source">
          <button
            type="button"
            className={`seg-btn ${sourceMode === "upload" ? "active" : ""}`}
            onClick={() => setSourceMode("upload")}
          >
            Upload .md file
          </button>
          <button
            type="button"
            className={`seg-btn ${sourceMode === "paste" ? "active" : ""}`}
            onClick={() => setSourceMode("paste")}
          >
            Paste Markdown
          </button>
        </div>

        {sourceMode === "upload" ? (
          <div
            className={`dropzone ${dragOver ? "drag-over" : ""}`}
            role="button"
            tabIndex={0}
            aria-label="Upload a Markdown prompt file"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={onDropzoneKeyDown}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <span className="dropzone-icon" aria-hidden="true">
              ⇧
            </span>
            <p className="dropzone-title">
              Drag &amp; drop a Markdown file here, or click to browse
            </p>
            <p className="hint">Only .md files are accepted.</p>
            <input
              ref={fileInputRef}
              id="dashboard-prompt-file"
              name="promptFile"
              type="file"
              accept=".md,.markdown,text/markdown"
              className="visually-hidden"
              onChange={handlePick}
            />
          </div>
        ) : (
          <div className="paste-box">
            <textarea
              id="dashboard-paste-prompt"
              name="pastedPrompt"
              rows={8}
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder="Paste the full prompt (Markdown) here…"
              aria-label="Pasted prompt Markdown"
            />
            <div className="row" style={{ margin: "0.5rem 0 0" }}>
              <button
                type="button"
                className="btn"
                onClick={handlePasteLoad}
                disabled={pasteText.trim().length === 0}
              >
                Use pasted prompt
              </button>
            </div>
          </div>
        )}

        {uploadError && (
          <div className="check-banner banner-bad" role="alert">
            {uploadError}
          </div>
        )}

        {workspaceDoc && uploadedStats && (
          <div className="uploaded-prompt">
            <div className="uploaded-head">
              <p className="uploaded-name">
                <strong>Prompt loaded:</strong> {workspaceDoc.name}
              </p>
              <div className="doc-pills">
                <span className="doc-pill">
                  <strong>{uploadedStats.chars.toLocaleString()}</strong> chars
                </span>
                <span className="doc-pill">
                  <strong>{uploadedStats.words.toLocaleString()}</strong> words
                </span>
                <span className="doc-pill">
                  <strong>{uploadedStats.lines.toLocaleString()}</strong> lines
                </span>
              </div>
              <div className="row" style={{ margin: 0 }}>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => onNavigate("editor")}
                >
                  Edit in Markdown editor
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-outline"
                  onClick={clearUploaded}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="uploaded-preview" aria-label="Prompt preview">
              <div
                className="uploaded-preview-inner"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(workspaceDoc.content),
                }}
              />
            </div>
          </div>
        )}
      </section>

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
        <p className="hint prompt-source">
          <span
            className={`chip ${workspaceDoc ? "chip-ok" : "chip-error"}`}
            title="Prompt that will be refined"
          >
            {workspaceDoc
              ? `Prompt source: ${workspaceDoc.name} (${workspaceDoc.content.length.toLocaleString()} chars)`
              : "No prompt loaded"}
          </span>
          {!workspaceDoc && (
            <span className="hint">
              Upload or paste a Markdown prompt above to enable a run.
            </span>
          )}
        </p>
        <label className="field">
          <span className="label-text">
            Issues file (JSON, inside the project root)
          </span>
          <input
            id="dashboard-issues-file"
            name="issuesFile"
            type="text"
            value={issuesFile}
            onChange={(event) => setIssuesFile(event.target.value)}
          />
        </label>
        <div className="form-row">
          <label className="field">
            <span className="label-text">Refiner model</span>
            <select
              id="dashboard-refiner-model"
              name="refinerModel"
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
              id="dashboard-evaluator-model"
              name="evaluatorModel"
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
            id="dashboard-feedback"
            name="humanFeedback"
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
            disabled={running || !workspaceDoc}
            title={workspaceDoc ? undefined : "Load a prompt first"}
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
                <span className={`log-stage log-stage-${event.stage}`}>
                  {event.stage}
                </span>
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
