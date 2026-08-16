import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectUnsafeCandidate } from "./refiner.js";
import type { IssueCategory, PromptIssue, Severity } from "./types.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const promptPath = path.join(
  projectRoot,
  "prompts",
  "linkedin-job-assistant.system.md"
);
const issuesPath = path.join(
  projectRoot,
  "evaluations",
  "prompt-refinement",
  "issues.json"
);
const casesPath = path.join(
  projectRoot,
  "evaluations",
  "prompt-refinement",
  "cases.json"
);
const maxLength = Number(process.env.PROMPT_MAX_LENGTH ?? 50_000);

const categories: IssueCategory[] = [
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
];

const severities: Severity[] = ["critical", "high", "medium", "low"];

const failures: string[] = [];

function report(name: string, ok: boolean, detail = ""): void {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`
  );
  if (!ok) {
    failures.push(name);
  }
}

// --- Active system prompt ------------------------------------------------
try {
  const prompt = await readFile(promptPath, "utf8");
  report("system prompt present", prompt.trim().length > 0);

  report(
    "system prompt is the real prompt (not the placeholder)",
    !prompt.includes("TODO: Paste Juan's complete LinkedIn Assistant system prompt"),
    prompt.trim().length > 0
      ? `${prompt.trim().length} chars`
      : ""
  );

  report(
    "system prompt within length limit",
    prompt.length <= maxLength,
    `${prompt.length}/${maxLength} chars`
  );

  for (const reason of detectUnsafeCandidate(prompt)) {
    report("static safety scan", false, reason);
  }
} catch (error) {
  report("system prompt present", false, String(error));
}

// --- Verified issues -----------------------------------------------------
try {
  const issues = JSON.parse(
    await readFile(issuesPath, "utf8")
  ) as PromptIssue[];

  report("issues.json parses", true, `${issues.length} issue(s)`);

  issues.forEach((issue, index) => {
    const validCategory = categories.includes(issue.category);
    const validSeverity = severities.includes(issue.severity);
    const hasEvidence = Boolean(issue.evidence?.trim());
    const hasExpected = Boolean(issue.expectedBehavior?.trim());

    report(
      `issue ${index + 1} schema`,
      validCategory && validSeverity && hasEvidence && hasExpected,
      `category=${issue.category} severity=${issue.severity}`
    );
  });
} catch (error) {
  report("issues.json parses", false, String(error));
}

// --- Regression cases ----------------------------------------------------
try {
  const cases = JSON.parse(await readFile(casesPath, "utf8")) as Array<{
    id: string;
    scenario: string;
    expected: string;
  }>;

  report("cases.json parses", true, `${cases.length} case(s)`);

  cases.forEach((testCase, index) => {
    report(
      `case ${index + 1} schema`,
      Boolean(
        testCase.id?.trim() &&
          testCase.scenario?.trim() &&
          testCase.expected?.trim()
      ),
      testCase.id
    );
  });
} catch (error) {
  report("cases.json parses", false, String(error));
}

console.log(
  failures.length === 0
    ? "\nAll checks passed."
    : `\n${failures.length} check(s) failed.`
);

process.exit(failures.length === 0 ? 0 : 1);
