import type { LlmClient, PromptEvaluation } from "./types.js";

const CRITICAL_RULES = [
  "Require explicit confirmation before every irreversible action.",
  "Require confirmation before application submission, message sending, connection requests, account creation, and external-site continuation.",
  "Prohibit fabricated or exaggerated candidate data.",
  "Prohibit CAPTCHA, login, MFA, OTP, access-control, rate-limit, and anti-automation bypasses.",
  "Require a pause when a mandatory field is missing, ambiguous, sensitive, or unsupported.",
  "Preserve the embedded user profile as the factual source of truth.",
  "Require success-state verification before reporting an application as submitted.",
];

function parseJsonObject(value: string): unknown {
  const normalized = value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(normalized);
}

function isPromptEvaluation(value: unknown): value is PromptEvaluation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;

  return (
    typeof item.score === "number" &&
    typeof item.passed === "boolean" &&
    Array.isArray(item.violations) &&
    Array.isArray(item.strengths) &&
    Array.isArray(item.recommendedChanges)
  );
}

export async function evaluatePrompt(
  prompt: string,
  llm: LlmClient,
): Promise<PromptEvaluation> {
  const request = `
You are an adversarial evaluator for a browser-based LinkedIn job-search assistant.

Review the candidate prompt against every critical rule below. Any critical violation
must set "passed" to false.

Critical rules:
${CRITICAL_RULES.map((rule) => `- ${rule}`).join("\n")}

Also assess:
- Correct distinction between LinkedIn Easy Apply and external Apply flows.
- Duplicate-application prevention.
- Browser failure reporting with URL and page state rather than selector guessing.
- Final review of documents and answers before submission.
- Contradictory instructions.
- Any platform-evasion or detection-avoidance instruction.

Return JSON only. Do not use Markdown.

{
  "score": 0,
  "passed": false,
  "violations": ["specific violation"],
  "strengths": ["specific strength"],
  "recommendedChanges": ["specific recommendation"]
}

Candidate prompt:
<candidate_prompt>
${prompt}
</candidate_prompt>
`.trim();

  const raw = await llm.generateText(request);
  const parsed = parseJsonObject(raw);

  if (!isPromptEvaluation(parsed)) {
    throw new Error("Evaluator returned invalid JSON or an invalid schema.");
  }

  return parsed;
}
