import type {
  AgentAction,
  IssueCategory,
  PromptIssue,
  RefinerResult,
  Severity,
} from "./types.js";

/**
 * Maps an evaluator violation to the issue category the refiner understands,
 * so a violation can be turned into a one-click actionable issue rather than a
 * sentence the user has to re-type into the issue form.
 */
function categorizeViolation(violation: string): IssueCategory {
  const text = violation.toLowerCase();

  if (/confirm|irreversible|before submitting|without asking/.test(text)) {
    return "confirmation";
  }
  if (/fabricat|invent|exaggerat|made.?up|unsupported claim/.test(text)) {
    return "truthfulness";
  }
  if (
    /captcha|mfa|otp|bypass|login wall|rate limit|anti-?automation/.test(text)
  ) {
    return "security";
  }
  if (/detect|evasion|stealth|terms of service|platform/.test(text)) {
    return "platform_compliance";
  }
  if (/profile|personal data|sensitive|demographic|privacy/.test(text)) {
    return "privacy";
  }
  if (/selector|page state|browser|url|screenshot/.test(text)) {
    return "browser_failure";
  }
  if (/format|report|output|summary/.test(text)) {
    return "output_format";
  }
  if (/match|relevan|criteria|screening/.test(text)) {
    return "job_matching";
  }
  return "other";
}

/** Critical categories gate promotion, so they are surfaced as critical. */
function severityFor(category: IssueCategory): Severity {
  return category === "confirmation" ||
    category === "truthfulness" ||
    category === "security" ||
    category === "platform_compliance"
    ? "critical"
    : "high";
}

function issueFromViolation(violation: string): PromptIssue {
  const category = categorizeViolation(violation);
  return {
    category,
    severity: severityFor(category),
    evidence: violation,
    expectedBehavior:
      "The prompt must explicitly instruct the agent to satisfy this rule.",
    observedBehavior: "The adversarial evaluator flagged this as unmet.",
    suggestedFix: `Add or strengthen a rule that resolves: ${violation}`,
  };
}

const applyAction = (detail: string, primary: boolean): AgentAction => ({
  kind: "apply_prompt",
  label: "Apply optimized prompt to editor",
  detail,
  primary,
});

const downloadAction = (detail: string): AgentAction => ({
  kind: "download_prompt",
  label: "Download optimized prompt",
  detail,
  primary: false,
});

/**
 * Turns a finished run into concrete next steps. Every terminal state yields at
 * least one action, so the user is never left with only an explanation.
 */
export function deriveActions(result: RefinerResult): AgentAction[] {
  if (result.status === "promoted") {
    const gain = result.after.score - result.before.score;
    return [
      applyAction(
        `Score improved ${result.before.score} → ${result.after.score} (+${gain}). Loads into the Markdown editor for review before you save.`,
        true,
      ),
      downloadAction("Save the optimized prompt as a .md file."),
    ];
  }

  if (result.status === "no_change") {
    const violations = result.before.violations.slice(0, 3);
    if (violations.length > 0) {
      return violations.map((violation, index) => ({
        kind: "add_issue" as const,
        label: `Fix: ${truncate(violation, 60)}`,
        detail:
          "Adds this evaluator finding as a verified issue, then re-runs refinement against it.",
        primary: index === 0,
        issue: issueFromViolation(violation),
      }));
    }
    return [
      {
        kind: "add_issue",
        label: "Add an issue to refine against",
        detail:
          "The refiner needs at least one verified issue or feedback line before it will change anything.",
        primary: true,
      },
    ];
  }

  switch (result.rejectionReason) {
    case "safety_violation":
      return [
        {
          kind: "review_safety",
          label: "Review blocked safety guardrails",
          detail:
            "The candidate weakened a safety rule and was discarded. It cannot be applied.",
          primary: true,
        },
        ...topViolationActions(result),
      ];

    case "truncated":
      return [
        {
          kind: "raise_token_limit",
          label: "Raise refiner token limit",
          detail:
            "The response was cut off mid-prompt. Increase PROMPT_REFINER_MAX_TOKENS, then retry.",
          primary: true,
        },
        retryAction(
          "Retry — the refiner is told to emit the complete prompt.",
          false,
        ),
      ];

    case "too_long":
      return [
        {
          kind: "shorten_prompt",
          label: "Raise the length cap or trim the prompt",
          detail:
            "The candidate exceeded PROMPT_MAX_LENGTH. Raise the cap or shorten the source prompt, then retry.",
          primary: true,
        },
        retryAction("Retry with a request for a more surgical edit.", false),
      ];

    case "evaluation_regressed":
      return [
        retryAction(
          `The candidate scored ${result.after.score} vs ${result.before.score} on the original. Retry with that fed back as guidance.`,
          true,
        ),
        ...topViolationActions(result),
      ];

    default:
      return [
        retryAction(
          "The refiner did not return a usable candidate. Retry with corrective guidance.",
          true,
        ),
        ...topViolationActions(result),
      ];
  }
}

function retryAction(detail: string, primary: boolean): AgentAction {
  return {
    kind: "retry_refinement",
    label: "Retry refinement",
    detail,
    primary,
  };
}

/** Converts the evaluator's top unmet rules into one-click issues. */
function topViolationActions(result: RefinerResult): AgentAction[] {
  const violations = result.after.violations.length
    ? result.after.violations
    : result.before.violations;

  return violations.slice(0, 2).map((violation) => ({
    kind: "add_issue" as const,
    label: `Target: ${truncate(violation, 60)}`,
    detail:
      "Adds this finding as a verified issue so the next run has explicit evidence to fix.",
    primary: false,
    issue: issueFromViolation(violation),
  }));
}

function truncate(value: string, max: number): string {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}
