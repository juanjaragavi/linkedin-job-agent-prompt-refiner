import type {
  LlmClient,
  PromptEvaluation,
  RefinerInput,
  RefinerResult,
} from "./types.js";

const IMMUTABLE_GUARDRAILS = [
  "Require explicit confirmation before every irreversible action.",
  "Treat application submission, message sending, connection requests, account creation, and external-site continuation as irreversible actions.",
  "Never fabricate, infer, or exaggerate facts about Juan, including employment, education, skills, credentials, salary, location, work authorization, or sponsorship.",
  "Never infer, select, or answer demographic, health, legal, financial, or other sensitive questions without an explicit supported fact or user instruction.",
  "Never bypass CAPTCHA, login, MFA, OTP, rate limits, access controls, or anti-automation protections.",
  "Never add stealth, evasion, or platform-detection avoidance instructions.",
  "Use only the embedded user profile as the authoritative factual source unless Juan explicitly provides an update.",
  "Halt and surface missing, ambiguous, unsupported, or legally sensitive required fields.",
  "Do not report a completed submission unless the browser displays a success state.",
];

/**
 * Removes a wrapping code fence (```diff, ```markdown, ```) from a section
 * body. Models frequently wrap the patch or revised prompt in fences even
 * though the format says plain Markdown.
 */
function stripFences(value: string): string {
  return value
    .replace(/^\s*```[a-z]*\s*\n?/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

/**
 * Extracts the body of a `## Heading` section from an LLM response, up to
 * (but not including) the next `## Heading`. If the closing heading is missing
 * (e.g. a response truncated before the trailing sections), falls back to
 * capturing everything from the section start to the end of the response.
 */
export function section(
  response: string,
  heading: string,
  nextHeading: string
): string {
  const pattern = new RegExp(
    `## ${heading}\\s*\\n([\\s\\S]*?)\\n## ${nextHeading}`,
    "i"
  );

  const matched = response.match(pattern);
  if (matched) {
    return stripFences(matched[1]);
  }

  const open = response.match(
    new RegExp(`## ${heading}\\s*\\n([\\s\\S]*)$`, "i")
  );

  return stripFences(open?.[1] ?? "");
}

/**
 * Tolerant decision extraction. Models deviate from the requested format in
 * predictable ways: trailing annotations ("PROMOTE — subject to review"),
 * a "Decision: PROMOTE" prefix, or echoing the template line "PROMOTE |
 * REJECT | NO_CHANGE". Accepts a bare decision word on its own line and
 * falls back to scanning the preamble before the revised prompt.
 */
export function extractDecision(response: string): string {
  const DECISION_PATTERN =
    /^(?:decision\s*[:：]\s*)?(promote|reject|no_change)\b(?!\s*\|)/im;

  const sectionText = section(response, "Decision", "Patch");

  if (sectionText) {
    const match = sectionText.match(DECISION_PATTERN);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  // Fallback: the model may have echoed the format template (whose first
  // "## Decision" block says "PROMOTE | REJECT | NO_CHANGE"). Look for a
  // real decision line before the revised prompt body. The (?!\s*\|) guard
  // skips the template echo itself.
  const preamble = response.split(/\n## Revised Prompt\b/i)[0];
  const fallback = preamble.match(DECISION_PATTERN);

  return fallback ? fallback[1].toUpperCase() : "";
}

/**
 * True when the matched phrase sits inside a negated clause such as "never
 * submit", "do not auto-submit", or "without confirmation". This prevents
 * safety prohibitions ("Never submit without explicit confirmation") from
 * being misread as unsafe behavior by the static scan. The heuristic looks
 * for a negation token anywhere earlier in the same sentence, so "No
 * fabricated data" and "must not bypass" are treated as prohibitions too.
 */
const NEGATION_TOKENS =
  /\b(?:never|no|not|don'?t|doesn'?t|won'?t|cannot|without|must not|shall not|should not)\b/i;

function isNegatedClause(prompt: string, index: number): boolean {
  const sentenceStart = Math.max(
    prompt.lastIndexOf(".", index - 1),
    prompt.lastIndexOf("!", index - 1),
    prompt.lastIndexOf("?", index - 1),
    prompt.lastIndexOf("\n", index - 1)
  );

  return NEGATION_TOKENS.test(prompt.slice(sentenceStart + 1, index));
}

/**
 * True when the matched verb is a gerund ("Bypassing...", "Submitting...").
 * Prohibition lists are typically written as gerund phrases under a
 * "Prohibited actions" heading ("Bypassing login walls, CAPTCHAs, OTP, ..."),
 * which must not be mistaken for an instruction to bypass controls.
 */
function isGerundForm(prompt: string, index: number): boolean {
  const tail = prompt.slice(index).match(/^[a-z]*/i)?.[0] ?? "";
  return tail.length > 3 && /ing$/i.test(tail);
}

function matchesNegationAware(pattern: RegExp, prompt: string): boolean {
  const regex = new RegExp(pattern.source, `${pattern.flags}g`);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(prompt)) !== null) {
    const isProhibition =
      isNegatedClause(prompt, match.index) ||
      isGerundForm(prompt, match.index);

    if (!isProhibition) {
      return true;
    }
  }

  return false;
}

export function detectUnsafeCandidate(prompt: string): string[] {
  const prohibited: Array<[RegExp, string]> = [
    [
      /submit.*without.*confirm|auto-?submit|submit.*automatically/i,
      "Candidate may permit submission without explicit confirmation.",
    ],
    [
      /bypass.*(captcha|login|mfa|otp|verification)|evade.*detection/i,
      "Candidate may permit a security-control or anti-detection bypass.",
    ],
    [
      /fabricate|invent.*(experience|credential|authorization|answer)/i,
      "Candidate may permit fabricated application information.",
    ],
    [
      /assume.*work authorization|default.*work authorization.*yes/i,
      "Candidate may permit unsupported work-authorization claims.",
    ],
  ];

  return prohibited
    .filter(([pattern]) => matchesNegationAware(pattern, prompt))
    .map(([, reason]) => reason);
}

export async function refineLinkedInJobAgentPrompt(
  input: RefinerInput,
  refinerLlm: LlmClient,
  evaluate: (candidate: string) => Promise<PromptEvaluation>
): Promise<RefinerResult> {
  const before = await evaluate(input.currentPrompt);

  if (input.issues.length === 0 && !input.humanFeedback?.length) {
    return {
      status: "no_change",
      refinedPrompt: input.currentPrompt,
      patch: "No verified issue or human feedback was supplied.",
      rationale: ["The refiner does not modify prompts without evidence."],
      before,
      after: before,
      changelogEntry: {
        version: "unchanged",
        runId: input.runId,
        createdAt: new Date().toISOString(),
        issuesAddressed: [],
      },
    };
  }

  const issueText = input.issues
    .map((issue, index) =>
      [
        `${index + 1}. Category: ${issue.category}`,
        `Severity: ${issue.severity}`,
        `Evidence: ${issue.evidence}`,
        `Expected behavior: ${issue.expectedBehavior}`,
        issue.observedBehavior
          ? `Observed behavior: ${issue.observedBehavior}`
          : "",
        issue.suggestedFix ? `Suggested fix: ${issue.suggestedFix}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");

  const feedback = input.humanFeedback?.length
    ? input.humanFeedback.map((item) => `- ${item}`).join("\n")
    : "- No additional feedback.";

  const request = `
You maintain Juan's safety-critical LinkedIn job-search assistant system prompt.

Make the smallest possible changes needed to address verified issues. Do not rewrite
unrelated sections. Do not change Juan's personal-profile facts. Do not add new
browser, outreach, data-collection, or account-management capabilities.

Immutable guardrails:
${IMMUTABLE_GUARDRAILS.map((rule) => `- ${rule}`).join("\n")}

Verified issues:
${issueText}

Human feedback:
${feedback}

Return exactly this Markdown structure:

## Decision
PROMOTE | REJECT | NO_CHANGE

## Patch
A concise unified-diff-like patch.

## Revised Prompt
The complete revised prompt. If the decision is REJECT or NO_CHANGE, reproduce the
current prompt exactly.

## Rationale
- One concise evidence-based reason for each change.

## Guardrail Check
- Confirmation: PASS | FAIL
- Truthfulness: PASS | FAIL
- Security: PASS | FAIL
- Platform compliance: PASS | FAIL
- Profile source of truth: PASS | FAIL

Current prompt:
<current_prompt>
${input.currentPrompt}
</current_prompt>
`.trim();

  const response = await refinerLlm.generateText(request);
  const decision = extractDecision(response);
  const patch = section(response, "Patch", "Revised Prompt");
  const refinedPrompt = section(response, "Revised Prompt", "Rationale");
  const rationale = section(response, "Rationale", "Guardrail Check")
    .split("\n")
    .map((line) => line.replace(/^- /, "").trim())
    .filter(Boolean);

  if (decision !== "PROMOTE" || !refinedPrompt) {
    return {
      status: "rejected",
      refinedPrompt: input.currentPrompt,
      patch: patch || "The refiner returned no valid patch.",
      rationale: rationale.length
        ? rationale
        : ["The candidate was not eligible for promotion."],
      before,
      after: before,
      changelogEntry: {
        version: "rejected",
        runId: input.runId,
        createdAt: new Date().toISOString(),
        issuesAddressed: input.issues.map((issue) => issue.category),
      },
      refinerResponse: response,
    };
  }

  // Integrity gate: a minimal revision reproduces the full current prompt, so
  // its ending must match. A mismatch means the response was truncated (e.g.
  // hit the token limit) or the model dropped content — reject rather than
  // promote a corrupted candidate.
  const currentTail = input.currentPrompt.trimEnd().slice(-80);
  if (refinedPrompt.trimEnd().slice(-80) !== currentTail) {
    return {
      status: "rejected",
      refinedPrompt: input.currentPrompt,
      patch,
      rationale: [
        ...rationale,
        "The candidate appears truncated: its ending does not match the current prompt. Likely the response hit the token limit — raise PROMPT_REFINER_MAX_TOKENS and re-run.",
      ],
      before,
      after: before,
      changelogEntry: {
        version: "rejected",
        runId: input.runId,
        createdAt: new Date().toISOString(),
        issuesAddressed: input.issues.map((issue) => issue.category),
      },
      refinerResponse: response,
    };
  }

  const staticSafetyFailures = detectUnsafeCandidate(refinedPrompt);
  const isTooLong =
    input.maxCandidateLength !== undefined &&
    refinedPrompt.length > input.maxCandidateLength;

  if (staticSafetyFailures.length > 0 || isTooLong) {
    return {
      status: "rejected",
      refinedPrompt: input.currentPrompt,
      patch,
      rationale: [
        ...rationale,
        ...staticSafetyFailures,
        ...(isTooLong
          ? [`Candidate exceeds ${input.maxCandidateLength} characters.`]
          : []),
      ],
      before,
      after: before,
      changelogEntry: {
        version: "rejected",
        runId: input.runId,
        createdAt: new Date().toISOString(),
        issuesAddressed: input.issues.map((issue) => issue.category),
      },
      refinerResponse: response,
    };
  }

  const after = await evaluate(refinedPrompt);

  if (!after.passed || after.score < before.score) {
    return {
      status: "rejected",
      refinedPrompt: input.currentPrompt,
      patch,
      rationale: [
        ...rationale,
        "The candidate failed post-revision evaluation or scored below the current prompt.",
      ],
      before,
      after,
      changelogEntry: {
        version: "rejected",
        runId: input.runId,
        createdAt: new Date().toISOString(),
        issuesAddressed: input.issues.map((issue) => issue.category),
      },
      refinerResponse: response,
    };
  }

  return {
    status: "promoted",
    refinedPrompt,
    patch,
    rationale,
    before,
    after,
    changelogEntry: {
      version: `v${Date.now()}`,
      runId: input.runId,
      createdAt: new Date().toISOString(),
      issuesAddressed: input.issues.map(
        (issue) => `${issue.category}: ${issue.expectedBehavior}`
      ),
    },
    refinerResponse: response,
  };
}
