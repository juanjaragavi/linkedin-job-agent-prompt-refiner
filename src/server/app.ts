import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { detectUnsafeCandidate } from "../prompt-refinement/refiner.js";
import type { LlmClient, PromptIssue } from "../prompt-refinement/types.js";
import { resolveWithin, runProcess } from "../mcp-server/helpers.js";
import { runRefinePipeline } from "./pipeline.js";
import type { PipelineProgress } from "./pipeline.js";

export const ISSUE_CATEGORIES = [
  "truthfulness",
  "confirmation",
  "privacy",
  "security",
  "platform_compliance",
  "job_matching",
  "browser_failure",
  "output_format",
  "usability",
  "other",
] as const;

const issueSchema = z.object({
  category: z.enum(ISSUE_CATEGORIES),
  severity: z.enum(["critical", "high", "medium", "low"]),
  evidence: z.string().min(1),
  expectedBehavior: z.string().min(1),
  observedBehavior: z.string().optional(),
  suggestedFix: z.string().optional(),
});

const DEFAULT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export interface ServerDeps {
  projectRoot?: string;
  refinerLlm?: LlmClient;
  evaluatorLlm?: LlmClient;
}

export interface App {
  server: Server;
  root: string;
  start(port: number): Promise<void>;
  stop(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function readBody(req: IncomingMessage, limit = 2 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseJsonBody(raw: string, res: ServerResponse): unknown | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON payload." });
    return undefined;
  }
}

async function serveStatic(
  res: ServerResponse,
  filePath: string,
  webDist: string
): Promise<void> {
  const resolved = resolveWithin(webDist, path.relative(webDist, filePath));

  if (!existsSync(resolved) || (await stat(resolved)).isDirectory()) {
    // SPA fallback: serve index.html for client-side routes.
    const index = path.join(webDist, "index.html");
    if (existsSync(index)) {
      const html = await readFile(index, "utf8");
      res.writeHead(200, { "content-type": CONTENT_TYPES[".html"] });
      res.end(html);
      return;
    }
    sendText(res, 404, "Not found");
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  res.writeHead(200, { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
  res.end(await readFile(resolved));
}

export function createApp(deps: ServerDeps = {}): App {
  const root = deps.projectRoot ?? DEFAULT_ROOT;
  const historyDirectory = path.join(root, "prompt-history");
  const webDist = path.join(root, "web", "dist");

  const bus = new EventEmitter();
  const recentEvents: PipelineProgress[] = [];
  let refineRunning = false;

  function publish(event: PipelineProgress): void {
    recentEvents.push(event);
    if (recentEvents.length > 200) recentEvents.shift();
    bus.emit("event", event);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    try {
      if (pathname === "/api/health" && method === "GET") {
        const [prompt, issues] = await Promise.all([
          readFile(path.join(root, "prompts", "linkedin-job-assistant.system.md"), "utf8").catch(() => null),
          readFile(path.join(root, "evaluations", "prompt-refinement", "issues.json"), "utf8").catch(() => null),
        ]);
        sendJson(res, 200, {
          ok: true,
          service: "linkedin-job-agent-prompt-refiner",
          status: {
            promptPresent: prompt !== null,
            promptChars: prompt?.length ?? 0,
            issuesParsed: issues ? (JSON.parse(issues) as unknown[]).length : 0,
            model: process.env.PROMPT_REFINER_MODEL ?? "unset",
          },
        });
        return;
      }

      if (pathname === "/api/events" && method === "GET") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write("retry: 2000\n\n");

        const listener = (event: PipelineProgress): void => {
          res.write(`event: ${event.stage}\ndata: ${JSON.stringify(event)}\n\n`);
        };
        bus.on("event", listener);
        req.on("close", () => bus.off("event", listener));
        return;
      }

      if (pathname === "/api/logs" && method === "GET") {
        sendJson(res, 200, { events: recentEvents });
        return;
      }

      if (pathname === "/api/prompt" && method === "GET") {
        const promptPath = path.join(root, "prompts", "linkedin-job-assistant.system.md");
        const content = await readFile(promptPath, "utf8");
        sendJson(res, 200, { path: promptPath, content, chars: content.length });
        return;
      }

      if (pathname === "/api/prompt" && method === "PUT") {
        const raw = await readBody(req);
        const body = parseJsonBody(raw, res);
        if (!body) return;
        const { content, confirm } = body as { content?: string; confirm?: boolean };

        if (typeof content !== "string" || content.length === 0) {
          sendJson(res, 400, { error: "content must be a non-empty string." });
          return;
        }
        if (confirm !== true) {
          sendJson(res, 409, {
            error: "Two-step confirmation required: call again with confirm: true.",
          });
          return;
        }

        const promptPath = path.join(root, "prompts", "linkedin-job-assistant.system.md");
        await mkdir(historyDirectory, { recursive: true });
        const backup = path.join(
          historyDirectory,
          `${new Date().toISOString().replace(/[:.]/g, "-")}.prompt-edit.backup.md`
        );
        await copyFile(promptPath, backup);
        await writeFile(promptPath, content, "utf8");
        sendJson(res, 200, { ok: true, chars: content.length, backup });
        return;
      }

      if (pathname === "/api/issues" && method === "GET") {
        const issues = JSON.parse(
          await readFile(path.join(root, "evaluations", "prompt-refinement", "issues.json"), "utf8")
        ) as PromptIssue[];
        sendJson(res, 200, { issues });
        return;
      }

      if (pathname === "/api/issues" && method === "POST") {
        const raw = await readBody(req);
        const body = parseJsonBody(raw, res);
        if (!body) return;

        const parsed = issueSchema.safeParse(body);
        if (!parsed.success) {
          sendJson(res, 400, { error: "Invalid issue schema.", details: parsed.error.flatten() });
          return;
        }

        const issuesPath = path.join(root, "evaluations", "prompt-refinement", "issues.json");
        const issues = JSON.parse(await readFile(issuesPath, "utf8")) as PromptIssue[];
        issues.push(parsed.data);
        await writeFile(issuesPath, JSON.stringify(issues, null, 2), "utf8");

        sendJson(res, 201, { ok: true, issue: parsed.data, count: issues.length });
        return;
      }

      if (pathname === "/api/issues" && method === "PUT") {
        const raw = await readBody(req);
        const body = parseJsonBody(raw, res);
        if (!body) return;
        const { issues } = body as { issues?: unknown };

        if (!Array.isArray(issues)) {
          sendJson(res, 400, { error: "issues must be an array." });
          return;
        }

        const validated: PromptIssue[] = [];
        for (const item of issues) {
          const parsed = issueSchema.safeParse(item);
          if (!parsed.success) {
            sendJson(res, 400, { error: "Invalid issue schema.", details: parsed.error.flatten() });
            return;
          }
          validated.push(parsed.data);
        }

        const issuesPath = path.join(root, "evaluations", "prompt-refinement", "issues.json");
        await writeFile(issuesPath, JSON.stringify(validated, null, 2), "utf8");
        sendJson(res, 200, { ok: true, count: validated.length });
        return;
      }

      if (pathname === "/api/issues" && method === "DELETE") {
        const raw = await readBody(req);
        const body = parseJsonBody(raw, res);
        if (!body) return;
        const { index } = body as { index?: unknown };

        if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
          sendJson(res, 400, { error: "index must be a non-negative integer." });
          return;
        }

        const issuesPath = path.join(root, "evaluations", "prompt-refinement", "issues.json");
        const issues = JSON.parse(await readFile(issuesPath, "utf8")) as PromptIssue[];
        if (index >= issues.length) {
          sendJson(res, 404, { error: `No issue at index ${index}.` });
          return;
        }
        const removed = issues.splice(index, 1)[0];
        await writeFile(issuesPath, JSON.stringify(issues, null, 2), "utf8");
        sendJson(res, 200, { ok: true, removed, count: issues.length });
        return;
      }

      if (pathname === "/api/cases" && method === "GET") {
        const cases = JSON.parse(
          await readFile(path.join(root, "evaluations", "prompt-refinement", "cases.json"), "utf8")
        );
        sendJson(res, 200, { cases });
        return;
      }

      if (pathname === "/api/check" && method === "GET") {
        const { stdout, stderr, exitCode } = await runProcess("npm run prompt:check", root, 120_000);
        sendJson(res, 200, {
          exitCode,
          passed: exitCode === 0,
          lines: `${stdout}\n${stderr}`.split("\n").filter(Boolean),
        });
        return;
      }

      if (pathname === "/api/history" && method === "GET") {
        await mkdir(historyDirectory, { recursive: true });
        const entries = await readdir(historyDirectory);
        const items = await Promise.all(
          entries
            .filter((name) => !name.startsWith("."))
            .map(async (name) => {
              const full = path.join(historyDirectory, name);
              const s = await stat(full);
              return { name, size: s.size, mtime: s.mtime.toISOString() };
            })
        );
        items.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
        sendJson(res, 200, { items });
        return;
      }

      if (pathname.startsWith("/api/history/") && method === "GET") {
        const fileName = decodeURIComponent(pathname.slice("/api/history/".length));
        const filePath = resolveWithin(historyDirectory, fileName);
        const content = await readFile(filePath, "utf8");
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(content);
        return;
      }

      if (pathname === "/api/refine" && method === "POST") {
        if (refineRunning) {
          sendJson(res, 409, { error: "A refinement run is already in progress." });
          return;
        }

        const raw = await readBody(req);
        const body = parseJsonBody(raw, res);
        if (!body) return;
        const { issuesFile, feedback } = body as {
          issuesFile?: string;
          feedback?: string[];
        };

        if (typeof issuesFile !== "string" || !issuesFile.endsWith(".json")) {
          sendJson(res, 400, { error: "issuesFile must point to a .json file." });
          return;
        }

        const resolvedIssues = resolveWithin(root, issuesFile);

        refineRunning = true;
        try {
          const run = await runRefinePipeline({
            root,
            issuesFile: resolvedIssues,
            feedback: Array.isArray(feedback) ? feedback : undefined,
            refinerLlm: deps.refinerLlm,
            evaluatorLlm: deps.evaluatorLlm,
            onProgress: publish,
          });
          sendJson(res, 200, {
            status: run.result.status,
            reportPath: run.reportPath,
            candidatePath: run.candidatePath,
            result: run.result,
          });
        } finally {
          refineRunning = false;
        }
        return;
      }

      if (pathname === "/api/promote" && method === "POST") {
        const raw = await readBody(req);
        const body = parseJsonBody(raw, res);
        if (!body) return;
        const { candidatePath, confirm } = body as {
          candidatePath?: string;
          confirm?: boolean;
        };

        if (typeof candidatePath !== "string") {
          sendJson(res, 400, { error: "candidatePath must be a string." });
          return;
        }
        if (confirm !== true) {
          sendJson(res, 409, {
            error: "Two-step confirmation required: call again with confirm: true.",
          });
          return;
        }

        const candidate = resolveWithin(historyDirectory, candidatePath);
        const content = await readFile(candidate, "utf8");

        const safetyFailures = detectUnsafeCandidate(content);
        if (safetyFailures.length > 0) {
          sendJson(res, 409, {
            error: "Candidate failed the static safety scan; promotion blocked.",
            failures: safetyFailures,
          });
          return;
        }

        const promptPath = path.join(root, "prompts", "linkedin-job-assistant.system.md");
        await mkdir(historyDirectory, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backup = path.join(historyDirectory, `${timestamp}.active-backup.system.md`);
        await copyFile(promptPath, backup);
        await copyFile(candidate, promptPath);

        const audit = {
          promotedAt: new Date().toISOString(),
          candidatePath,
          backup,
          safetyFailures,
        };
        await writeFile(
          path.join(historyDirectory, `${timestamp}.promotion.json`),
          JSON.stringify(audit, null, 2),
          "utf8"
        );

        sendJson(res, 200, { ok: true, backup, audit });
        return;
      }

      // Static frontend (built SPA) for any non-API path.
      if (!pathname.startsWith("/api/") && existsSync(webDist)) {
        const requested = pathname === "/" ? "/index.html" : pathname;
        await serveStatic(res, path.join(webDist, requested), webDist);
        return;
      }

      sendJson(res, 404, { error: `No route for ${method} ${pathname}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /outside the root|no such file/i.test(message) ? 404 : 500;
      sendJson(res, status, { error: message });
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  return {
    server,
    root,
    start(port: number): Promise<void> {
      return new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolvePromise());
      });
    },
    stop(): Promise<void> {
      return new Promise((resolvePromise) => server.close(() => resolvePromise()));
    },
  };
}
