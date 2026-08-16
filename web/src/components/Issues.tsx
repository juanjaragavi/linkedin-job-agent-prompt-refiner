import { useCallback, useEffect, useState, type FormEvent } from "react";
import { addIssue, deleteIssue, getIssues } from "../api";
import {
  ISSUE_CATEGORIES,
  SEVERITIES,
  type IssueCategory,
  type PromptIssue,
  type Severity,
} from "../types";

const EMPTY_FORM: Omit<PromptIssue, "category" | "severity"> & {
  category: IssueCategory | "";
  severity: Severity | "";
} = {
  category: "",
  severity: "",
  evidence: "",
  expectedBehavior: "",
  observedBehavior: "",
  suggestedFix: "",
};

export default function Issues() {
  const [issues, setIssues] = useState<PromptIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<IssueCategory | "all">(
    "all",
  );
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
  const [form, setForm] = useState(EMPTY_FORM);

  const refresh = useCallback(async () => {
    try {
      setIssues((await getIssues()).issues);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = issues
    .map((issue, index) => ({ issue, index }))
    .filter(({ issue }) => {
      if (categoryFilter !== "all" && issue.category !== categoryFilter)
        return false;
      if (severityFilter !== "all" && issue.severity !== severityFilter)
        return false;
      return true;
    });

  const set = <K extends keyof typeof EMPTY_FORM>(
    key: K,
    value: (typeof EMPTY_FORM)[K],
  ): void => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (form.category === "" || form.severity === "") {
      setError("Category and severity are required.");
      return;
    }
    if (!form.evidence.trim() || !form.expectedBehavior.trim()) {
      setError("Evidence and expected behavior are required.");
      return;
    }

    const issue: PromptIssue = {
      category: form.category,
      severity: form.severity,
      evidence: form.evidence.trim(),
      expectedBehavior: form.expectedBehavior.trim(),
      observedBehavior: form.observedBehavior?.trim() || undefined,
      suggestedFix: form.suggestedFix?.trim() || undefined,
    };

    try {
      const result = await addIssue(issue);
      setNotice(`Issue added — ${result.count} on file.`);
      setForm(EMPTY_FORM);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async (index: number): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      const result = await deleteIssue(index);
      setNotice(`Issue removed — ${result.count} remaining.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="grid">
      <section className="card" aria-labelledby="add-title">
        <h2 id="add-title">Add verified issue</h2>
        <form
          className="issue-form"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <div className="form-row">
            <label className="field">
              <span className="label-text">Category</span>
              <select
                value={form.category}
                onChange={(event) =>
                  set("category", event.target.value as IssueCategory)
                }
              >
                <option value="">— select —</option>
                {ISSUE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label-text">Severity</span>
              <select
                value={form.severity}
                onChange={(event) =>
                  set("severity", event.target.value as Severity)
                }
              >
                <option value="">— select —</option>
                {SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {severity}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span className="label-text">Evidence (what was observed)</span>
            <textarea
              rows={2}
              value={form.evidence}
              onChange={(event) => set("evidence", event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="label-text">Expected behavior</span>
            <textarea
              rows={2}
              value={form.expectedBehavior}
              onChange={(event) => set("expectedBehavior", event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="label-text">Observed behavior (optional)</span>
            <textarea
              rows={2}
              value={form.observedBehavior ?? ""}
              onChange={(event) => set("observedBehavior", event.target.value)}
            />
          </label>
          <label className="field">
            <span className="label-text">Suggested fix (optional)</span>
            <input
              type="text"
              value={form.suggestedFix ?? ""}
              onChange={(event) => set("suggestedFix", event.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary">
            Add issue
          </button>
        </form>
        {error && (
          <div className="check-banner banner-bad" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="check-banner banner-ok" role="status">
            {notice}
          </div>
        )}
      </section>

      <section className="card card-wide" aria-labelledby="list-title">
        <h2 id="list-title">
          Issues on file <span className="count">({issues.length})</span>
        </h2>
        <div className="form-row">
          <label className="field">
            <span className="label-text">Filter: category</span>
            <select
              value={categoryFilter}
              onChange={(event) =>
                setCategoryFilter(event.target.value as IssueCategory | "all")
              }
            >
              <option value="all">All categories</option>
              {ISSUE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label-text">Filter: severity</span>
            <select
              value={severityFilter}
              onChange={(event) =>
                setSeverityFilter(event.target.value as Severity | "all")
              }
            >
              <option value="all">All severities</option>
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {severity}
                </option>
              ))}
            </select>
          </label>
        </div>

        {visible.length === 0 ? (
          <p className="hint">No issues match the current filters.</p>
        ) : (
          <ul className="issue-list">
            {visible.map(({ issue, index }) => (
              <li key={index} className="issue-item">
                <div className="issue-head">
                  <span className={`badge badge-${issue.severity}`}>
                    {issue.severity}
                  </span>
                  <span className="badge badge-neutral">{issue.category}</span>
                  <span className="issue-index">#{index}</span>
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    onClick={() => void handleDelete(index)}
                  >
                    Delete
                  </button>
                </div>
                <p className="issue-evidence">{issue.evidence}</p>
                <p className="issue-expected">
                  <strong>Expected:</strong> {issue.expectedBehavior}
                </p>
                {issue.observedBehavior && (
                  <p className="issue-observed">
                    <strong>Observed:</strong> {issue.observedBehavior}
                  </p>
                )}
                {issue.suggestedFix && (
                  <p className="issue-fix">
                    <strong>Suggested fix:</strong> {issue.suggestedFix}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
