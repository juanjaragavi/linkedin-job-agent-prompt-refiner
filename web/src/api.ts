import type {
  CheckResult,
  HealthStatus,
  HistoryItem,
  ModelsResponse,
  PipelineEvent,
  PromoteResponse,
  PromptIssue,
  RefineRunResponse,
  RegressionCase,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError("Network error — is the API server running?", 0, null);
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(message, res.status, body);
  }

  return body as T;
}

export const getHealth = () => request<HealthStatus>("/api/health");
export const getModels = () => request<ModelsResponse>("/api/models");
export const getLogs = () => request<{ events: PipelineEvent[] }>("/api/logs");
export const getPrompt = () =>
  request<{ path: string; content: string; chars: number }>("/api/prompt");
export const savePrompt = (content: string, confirm: boolean) =>
  request<{ ok: boolean; chars: number; backup: string }>("/api/prompt", {
    method: "PUT",
    body: JSON.stringify({ content, confirm }),
  });
export const getIssues = () =>
  request<{ issues: PromptIssue[] }>("/api/issues");
export const addIssue = (issue: PromptIssue) =>
  request<{ ok: boolean; issue: PromptIssue; count: number }>("/api/issues", {
    method: "POST",
    body: JSON.stringify(issue),
  });
export const deleteIssue = (index: number) =>
  request<{ ok: boolean; removed: PromptIssue; count: number }>("/api/issues", {
    method: "DELETE",
    body: JSON.stringify({ index }),
  });
export const getCases = () =>
  request<{ cases: RegressionCase[] }>("/api/cases");
export const runCheck = () => request<CheckResult>("/api/check");
export const getHistory = () =>
  request<{ items: HistoryItem[] }>("/api/history");
export const getHistoryFile = (name: string) =>
  request<string>(`/api/history/${encodeURIComponent(name)}`);
export const startRefine = (
  issuesFile: string,
  feedback?: string[],
  refinerModel?: string,
  evaluatorModel?: string,
) =>
  request<RefineRunResponse>("/api/refine", {
    method: "POST",
    body: JSON.stringify({
      issuesFile,
      feedback,
      refinerModel,
      evaluatorModel,
    }),
  });
export const promote = (candidatePath: string, confirm: boolean) =>
  request<PromoteResponse>("/api/promote", {
    method: "POST",
    body: JSON.stringify({ candidatePath, confirm }),
  });

/** Stage names the backend pipeline emits (see src/server/pipeline.ts). */
const EVENT_STAGES = ["load", "llm", "evaluator", "write", "done", "error"];

/**
 * Subscribes to the SSE pipeline event stream. Returns an unsubscribe fn.
 * The server emits *named* events (`event: <stage>`), so we register one
 * listener per known stage.
 */
export function subscribePipeline(
  onEvent: (event: PipelineEvent) => void,
  onError?: () => void,
): () => void {
  const source = new EventSource("/api/events");
  const handlers = new Map<string, (msg: MessageEvent<string>) => void>();

  for (const stage of EVENT_STAGES) {
    const handler = (msg: MessageEvent<string>): void => {
      try {
        onEvent(JSON.parse(msg.data) as PipelineEvent);
      } catch {
        // Ignore malformed frames; keep the stream alive.
      }
    };
    handlers.set(stage, handler);
    source.addEventListener(stage, handler);
  }

  source.onerror = () => onError?.();

  return () => {
    for (const [stage, handler] of handlers) {
      source.removeEventListener(stage, handler);
    }
    source.close();
  };
}
