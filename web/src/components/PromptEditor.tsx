import { useCallback, useEffect, useMemo, useState } from "react";
import { getCases, getPrompt, savePrompt, ApiError } from "../api";
import type { RegressionCase } from "../types";
import { renderMarkdown } from "../markdown";

type Mode = "split" | "preview";

export default function PromptEditor() {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<Mode>("split");
  const [dirty, setDirty] = useState(false);
  const [armed, setArmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [cases, setCases] = useState<RegressionCase[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [promptResult, casesResult] = await Promise.all([
        getPrompt(),
        getCases(),
      ]);
      setContent(promptResult.content);
      setCases(casesResult.cases);
      setDirty(false);
      setArmed(false);
      setMessage(null);
      setLoaded(true);
    } catch (e) {
      setMessage({
        kind: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const previewHtml = useMemo(() => renderMarkdown(content), [content]);
  const charCount = content.length;

  const handleSave = async (): Promise<void> => {
    setMessage(null);

    if (content.length === 0) {
      setMessage({ kind: "error", text: "Prompt content must not be empty." });
      return;
    }

    try {
      if (!armed) {
        try {
          await savePrompt(content, false);
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

      setSaving(true);
      const result = await savePrompt(content, true);
      setArmed(false);
      setDirty(false);
      setMessage({
        kind: "ok",
        text: `Saved ${result.chars.toLocaleString()} chars. Backup: ${result.backup}`,
      });
    } catch (e) {
      setMessage({
        kind: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid">
      <section className="card card-wide" aria-labelledby="editor-title">
        <div className="editor-head">
          <h2 id="editor-title">Active prompt editor</h2>
          <div className="row">
            <div className="seg" role="group" aria-label="Editor mode">
              <button
                type="button"
                className={`seg-btn ${mode === "split" ? "active" : ""}`}
                onClick={() => setMode("split")}
              >
                Edit + preview
              </button>
              <button
                type="button"
                className={`seg-btn ${mode === "preview" ? "active" : ""}`}
                onClick={() => setMode("preview")}
              >
                Preview only
              </button>
            </div>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => void refresh()}
              disabled={!loaded}
            >
              Reload from disk
            </button>
            <button
              type="button"
              className={`btn ${armed ? "btn-danger" : "btn-primary"}`}
              onClick={() => void handleSave()}
              disabled={saving || !loaded}
            >
              {saving
                ? "Saving…"
                : armed
                  ? "Confirm save (final)"
                  : dirty
                    ? "Save changes (step 1 of 2)"
                    : "Save changes"}
            </button>
          </div>
        </div>

        <p className="hint">
          {charCount.toLocaleString()} chars · editing is backed up to{" "}
          <code>prompt-history/</code> and always requires two-step
          confirmation.
        </p>

        {message && (
          <div
            className={`check-banner ${message.kind === "ok" ? "banner-ok" : "banner-bad"}`}
            role={message.kind === "ok" ? "status" : "alert"}
          >
            {message.text}
          </div>
        )}

        {!loaded ? (
          <p className="hint">Loading…</p>
        ) : mode === "split" ? (
          <div className="editor-split">
            <label className="field editor-pane">
              <span className="label-text">Markdown source</span>
              <textarea
                className="editor-textarea"
                value={content}
                onChange={(event) => {
                  setContent(event.target.value);
                  setDirty(true);
                  setArmed(false);
                }}
                spellCheck={false}
              />
            </label>
            <div className="editor-pane">
              <span className="label-text">Visual preview</span>
              <div
                className="editor-preview"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </div>
        ) : (
          <div
            className="editor-preview editor-preview-only"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}
      </section>

      <section className="card" aria-labelledby="cases-title">
        <h2 id="cases-title">
          Regression cases <span className="count">({cases.length})</span>
        </h2>
        {cases.length === 0 ? (
          <p className="hint">No regression cases on file.</p>
        ) : (
          <ul className="case-list">
            {cases.map((item) => (
              <li key={item.id} className="case-item">
                <code className="case-id">{item.id}</code>
                <p className="case-scenario">{item.scenario}</p>
                <p className="case-expected">
                  <strong>Expected:</strong> {item.expected}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
