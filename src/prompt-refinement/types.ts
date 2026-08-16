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
  /** Raw refiner LLM response — kept for audit/diagnosis when parsing fails. */
  refinerResponse?: string;
}

export interface LlmClient {
  generateText(prompt: string): Promise<string>;
}
