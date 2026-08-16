import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import type { App } from "./app.js";
import type { LlmClient, PromptEvaluation } from "../prompt-refinement/types.js";

const STABLE_TAIL =
  "## Final Section\nThis stable trailing section is deliberately long so the tail comparison covers more than eighty characters of unchanged content.\nEnd of the document.";

const FAKE_PROMPT = `# Test Prompt
Keep it simple.

${STABLE_TAIL}
`;

const FAKE_ISSUES = [
  {
    category: "confirmation",
    severity: "critical",
    evidence: "evidence one",
    expectedBehavior: "expected one",
  },
  {
    category: "browser_failure",
    severity: "medium",
    evidence: "evidence two",
    expectedBehavior: "expected two",
  },
];

const FAKE_CASES = [
  {
    id: "external-apply-confirmation",
    scenario: "LinkedIn Apply opens an employer ATS.",
    expected: "Pause before interacting with the ATS.",
  },
];

const fakeRefinerLlm: LlmClient = {
  async generateText() {
    return `## Decision
PROMOTE

## Patch
+ improved

## Revised Prompt
# Test Prompt
Now improved.

${STABLE_TAIL}

## Rationale
- improved the test prompt

## Guardrail Check
- Confirmation: PASS
- Truthfulness: PASS
- Security: PASS
- Platform compliance: PASS
- Profile source of truth: PASS`;
  },
};

const fakeEvaluatorLlm: LlmClient = {
  async generateText() {
    return JSON.stringify({
      score: 90,
      passed: true,
      violations: [],
      strengths: ["confirmation enforced"],
      recommendedChanges: [],
    } satisfies PromptEvaluation);
  },
};

describe("prompt-refiner web API", () => {
  let tempRoot: string;
  let app: App;
  let base: string;

  beforeAll(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "pr-gui-test-"));
    await mkdir(path.join(tempRoot, "prompts"), { recursive: true });
    await mkdir(path.join(tempRoot, "evaluations", "prompt-refinement"), {
      recursive: true,
    });
    await mkdir(path.join(tempRoot, "prompt-history"), { recursive: true });

    await writeFile(
      path.join(tempRoot, "prompts", "linkedin-job-assistant.system.md"),
      FAKE_PROMPT,
      "utf8"
    );
    await writeFile(
      path.join(tempRoot, "evaluations", "prompt-refinement", "issues.json"),
      JSON.stringify(FAKE_ISSUES, null, 2),
      "utf8"
    );
    await writeFile(
      path.join(tempRoot, "evaluations", "prompt-refinement", "cases.json"),
      JSON.stringify(FAKE_CASES, null, 2),
      "utf8"
    );

    app = createApp({
      projectRoot: tempRoot,
      refinerLlm: fakeRefinerLlm,
      evaluatorLlm: fakeEvaluatorLlm,
    });
    await app.start(0);
    const address = app.server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.stop();
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function getJson(pathname: string) {
    const res = await fetch(`${base}${pathname}`);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  async function sendJson(method: string, pathname: string, body: unknown) {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it("reports health with prompt and issues status", async () => {
    const { status, body } = await getJson("/api/health");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const statusObj = body.status as Record<string, unknown>;
    expect(statusObj.promptPresent).toBe(true);
    expect(statusObj.issuesParsed).toBe(2);
  });

  it("returns the active prompt", async () => {
    const { status, body } = await getJson("/api/prompt");
    expect(status).toBe(200);
    expect((body.content as string).startsWith("# Test Prompt")).toBe(true);
  });

  it("requires two-step confirmation before saving the prompt", async () => {
    const denied = await sendJson("PUT", "/api/prompt", {
      content: "# Changed",
      confirm: false,
    });
    expect(denied.status).toBe(409);

    const accepted = await sendJson("PUT", "/api/prompt", {
      content: `# Changed

${STABLE_TAIL}`,
      confirm: true,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.ok).toBe(true);

    const prompt = await readFile(
      path.join(tempRoot, "prompts", "linkedin-job-assistant.system.md"),
      "utf8"
    );
    expect(prompt).toContain("# Changed");

    // Restore the fixture prompt so later tests (refine truncation gate) see
    // a prompt whose tail matches the fake refiner's revised prompt.
    await writeFile(
      path.join(tempRoot, "prompts", "linkedin-job-assistant.system.md"),
      FAKE_PROMPT,
      "utf8"
    );
  });

  it("lists, adds, replaces, and deletes issues with validation", async () => {
    const listed = await getJson("/api/issues");
    expect(listed.status).toBe(200);
    expect((listed.body.issues as unknown[]).length).toBe(2);

    const added = await sendJson("POST", "/api/issues", {
      category: "usability",
      severity: "low",
      evidence: "evidence three",
      expectedBehavior: "expected three",
    });
    expect(added.status).toBe(201);
    expect(added.body.count).toBe(3);

    const invalid = await sendJson("POST", "/api/issues", {
      category: "banana",
      severity: "low",
      evidence: "x",
      expectedBehavior: "y",
    });
    expect(invalid.status).toBe(400);

    const replaced = await sendJson("PUT", "/api/issues", {
      issues: [FAKE_ISSUES[0]],
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body.count).toBe(1);

    const deleted = await sendJson("DELETE", "/api/issues", { index: 0 });
    expect(deleted.status).toBe(200);
    expect(deleted.body.count).toBe(0);

    const missing = await sendJson("DELETE", "/api/issues", { index: 5 });
    expect(missing.status).toBe(404);
  });

  it("lists and reads history files", async () => {
    const { status, body } = await getJson("/api/history");
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
  });

  it("runs a refinement pipeline and writes report + candidate", async () => {
    await writeFile(
      path.join(tempRoot, "evaluations", "prompt-refinement", "refine-issues.json"),
      JSON.stringify(FAKE_ISSUES, null, 2),
      "utf8"
    );

    const { status, body } = await sendJson("POST", "/api/refine", {
      issuesFile: "evaluations/prompt-refinement/refine-issues.json",
    });

    expect(status).toBe(200);
    expect(body.status).toBe("promoted");
    expect(typeof body.reportPath).toBe("string");
    expect(typeof body.candidatePath).toBe("string");

    const report = JSON.parse(
      await readFile(body.reportPath as string, "utf8")
    ) as { status: string; after: { score: number } };
    expect(report.status).toBe("promoted");
    expect(report.after.score).toBe(90);

    const history = await getJson("/api/history");
    const names = (history.body.items as Array<{ name: string }>).map(
      (item) => item.name
    );
    expect(names.some((name) => name.endsWith(".report.json"))).toBe(true);
    expect(names.some((name) => name.endsWith(".candidate.system.md"))).toBe(true);
  });

  it("returns no_change for an empty issues file", async () => {
    await writeFile(
      path.join(tempRoot, "evaluations", "prompt-refinement", "empty-issues.json"),
      "[]",
      "utf8"
    );
    const { status, body } = await sendJson("POST", "/api/refine", {
      issuesFile: "evaluations/prompt-refinement/empty-issues.json",
    });
    expect(status).toBe(200);
    expect(body.status).toBe("no_change");
  });

  it("blocks promotion without confirmation and for unsafe candidates", async () => {
    const candidatePath = "2026-01-01T00-00-00-000Z.candidate.system.md";

    const denied = await sendJson("POST", "/api/promote", {
      candidatePath,
      confirm: false,
    });
    expect(denied.status).toBe(409);

    await writeFile(
      path.join(tempRoot, "prompt-history", candidatePath),
      "The agent may auto-submit applications without confirmation.",
      "utf8"
    );

    const unsafe = await sendJson("POST", "/api/promote", {
      candidatePath,
      confirm: true,
    });
    expect(unsafe.status).toBe(409);
    expect(String(unsafe.body.error)).toContain("static safety scan");
  });

  it("promotes a safe candidate with backup and audit trail", async () => {
    const candidatePath = "2026-01-02T00-00-00-000Z.candidate.system.md";
    await writeFile(
      path.join(tempRoot, "prompt-history", candidatePath),
      FAKE_PROMPT,
      "utf8"
    );

    const { status, body } = await sendJson("POST", "/api/promote", {
      candidatePath,
      confirm: true,
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);

    const active = await readFile(
      path.join(tempRoot, "prompts", "linkedin-job-assistant.system.md"),
      "utf8"
    );
    expect(active).toContain("# Test Prompt");

    const history = await getJson("/api/history");
    const names = (history.body.items as Array<{ name: string }>).map(
      (item) => item.name
    );
    expect(names.some((name) => name.endsWith(".promotion.json"))).toBe(true);
  });

  it("rejects path traversal attempts", async () => {
    const { status } = await getJson("/api/history/..%2F..%2Fpackage.json");
    expect(status).toBe(404);
  });

  it("exposes an SSE event stream and recent logs", async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/events`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    controller.abort();

    const logs = await getJson("/api/logs");
    expect(logs.status).toBe(200);
    expect(Array.isArray(logs.body.events)).toBe(true);
  });
});
