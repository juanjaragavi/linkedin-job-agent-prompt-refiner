export type IssueCategory =
  | "truthfulness"
  | "confirmation"
  | "privacy"
  | "security"
  | "platform_compliance"
  | "job_matching"
  | "browser_failure"
  | "output_format"
  | "usability"
  | "other";

export type Severity = "critical" | "high" | "medium" | "low";

export interface PromptIssue {
  category: IssueCategory;
  severity: Severity;
  evidence: string;
  expectedBehavior: string;
  observedBehavior?: string;
  suggestedFix?: string;
}

export interface PromptEvaluation {
  score: number;
  passed: boolean;
  violations: string[];
  strengths: string[];
  recommendedChanges: string[];
}

export interface RefinerInput {
  currentPrompt: string;
  issues: PromptIssue[];
  humanFeedback?: string[];
  runId?: string;
  maxCandidateLength?: number;
  /** Total refiner attempts before giving up. Retries feed the rejection reason back. */
  maxAttempts?: number;
}

/**
 * Why a candidate was rejected, in machine-readable form. `safety_violation`
 * is terminal — the guardrail fired and the candidate must never be offered.
 * Every other reason is recoverable by re-prompting the refiner.
 */
export type RejectionReason =
  | "no_decision"
  | "not_promoted"
  | "empty_candidate"
  | "truncated"
  | "too_long"
  | "safety_violation"
  | "evaluation_regressed";

export const RECOVERABLE_REJECTIONS: readonly RejectionReason[] = [
  "no_decision",
  "not_promoted",
  "empty_candidate",
  "truncated",
  "too_long",
  "evaluation_regressed",
];

export type AgentActionKind =
  | "apply_prompt"
  | "download_prompt"
  | "retry_refinement"
  | "add_issue"
  | "raise_token_limit"
  | "shorten_prompt"
  | "review_safety";

export interface AgentAction {
  kind: AgentActionKind;
  label: string;
  /** Why this action is being offered — shown under the button. */
  detail: string;
  /** Exactly one action per result is primary. */
  primary: boolean;
  /** Prefilled issue for `add_issue`, so the fix is one click, not a form. */
  issue?: PromptIssue;
  /** Feedback lines to resend for `retry_refinement`. */
  feedback?: string[];
}

export interface RefinerResult {
  status: "promoted" | "rejected" | "no_change";
  refinedPrompt: string;
  patch: string;
  rationale: string[];
  before: PromptEvaluation;
  after: PromptEvaluation;
  changelogEntry: {
    version: string;
    runId?: string;
    createdAt: string;
    issuesAddressed: string[];
  };
  /** Set when status is "rejected". Drives the offered actions. */
  rejectionReason?: RejectionReason;
  /** Guardrail messages from the static scan; non-empty only on safety_violation. */
  safetyFailures?: string[];
  /** Refiner attempts made, including the successful one. */
  attempts?: number;
  /** Next steps the user can execute directly. */
  actions?: AgentAction[];
  /** Raw refiner LLM response — kept for audit/diagnosis when parsing fails. */
  refinerResponse?: string;
}

export interface LlmClient {
  generateText(prompt: string): Promise<string>;
}
