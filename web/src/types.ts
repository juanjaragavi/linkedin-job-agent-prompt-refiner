export interface PipelineEvent {
  stage: string;
  message: string;
  at: string;
}

export type ModelProvider = "anthropic" | "nvidia";

export interface ModelInfo {
  id: string;
  provider: ModelProvider;
  displayName: string;
  configured: boolean;
}

export interface ModelsResponse {
  models: ModelInfo[];
  defaultRefiner: string;
  defaultEvaluator: string;
}

export interface HealthStatus {
  ok: boolean;
  service: string;
  status: {
    promptPresent: boolean;
    promptChars: number;
    issuesParsed: number;
    model: string;
  };
  providers: {
    anthropic: boolean;
    nvidia: boolean;
  };
}

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

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;

export type Severity = (typeof SEVERITIES)[number];

export interface PromptIssue {
  category: IssueCategory;
  severity: Severity;
  evidence: string;
  expectedBehavior: string;
  observedBehavior?: string;
  suggestedFix?: string;
}

export interface RegressionCase {
  id: string;
  scenario: string;
  expected: string;
}

export interface HistoryItem {
  name: string;
  size: number;
  mtime: string;
}

export interface CheckResult {
  exitCode: number;
  passed: boolean;
  lines: string[];
}

export interface EvaluationSummary {
  score: number;
  passed: boolean;
  violations: string[];
  strengths: string[];
  recommendedChanges: string[];
}

export interface RefineReport {
  status: "promoted" | "rejected" | "no_change";
  refinedPrompt: string;
  patch: string;
  rationale: string[];
  before: EvaluationSummary;
  after: EvaluationSummary;
  refinerResponse?: string;
}

export interface RefineRunResponse {
  status: string;
  reportPath: string;
  candidatePath?: string;
  result: RefineReport;
}

export interface PromoteResponse {
  ok: boolean;
  backup: string;
  audit: {
    promotedAt: string;
    candidatePath: string;
    backup: string;
    safetyFailures: string[];
  };
}
