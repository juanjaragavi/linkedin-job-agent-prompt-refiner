import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePrompt } from "./evaluator.js";
import {
  MODEL_REGISTRY,
  createLlmClient,
  isProviderConfigured,
  resolveModelDefinition,
} from "./providers/provider.js";
import type { ModelProvider } from "./providers/provider.js";
import { refineLinkedInJobAgentPrompt } from "./refiner.js";
import type { LlmClient, PromptIssue } from "./types.js";

/**
 * Wraps an LLM client so every request prints a start line, a completion line
 * with elapsed time, or a failure line. A run should never sit silent.
 */
function withProgress(label: string, llm: LlmClient): LlmClient {
  return {
    async generateText(prompt: string): Promise<string> {
      console.log(`[${label}] request started — ${new Date().toISOString()}`);
      const startedAt = Date.now();

      try {
        const text = await llm.generateText(prompt);
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`[${label}] completed in ${seconds}s`);
        return text;
      } catch (error) {
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.error(
          `[${label}] FAILED after ${seconds}s — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      }
    },
  };
}

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const promptPath = path.join(
  projectRoot,
  "prompts",
  "linkedin-job-assistant.system.md",
);
const historyDirectory = path.join(projectRoot, "prompt-history");
const issuesArgument = process.argv[2];

const maxCandidateLength = Number(process.env.PROMPT_MAX_LENGTH ?? 50_000);

if (!issuesArgument) {
  throw new Error(
    "Usage: npm run prompt:refine -- evaluations/prompt-refinement/issues.json",
  );
}

const issuesPath = path.resolve(projectRoot, issuesArgument);
const refinerModel = process.env.PROMPT_REFINER_MODEL;
const evaluatorModel = process.env.PROMPT_EVALUATOR_MODEL;

/**
 * Provider for a role. Registry models always use their registry provider
 * (an nvidia/* model ID routes to NVIDIA no matter what PROMPT_*_PROVIDER
 * says — a stray env default would otherwise 404 the model against the wrong
 * API). The explicit PROMPT_*_PROVIDER env only applies to custom model IDs
 * that are not in the registry.
 */
function roleProvider(
  role: "REFINER" | "EVALUATOR",
  model: string | undefined,
): ModelProvider {
  const id = model ?? "";
  const definition = resolveModelDefinition(id);
  const inRegistry = MODEL_REGISTRY.some((entry) => entry.id === id);

  if (inRegistry) {
    return definition.provider;
  }

  const explicit = process.env[`PROMPT_${role}_PROVIDER`];
  return explicit === "nvidia" || explicit === "anthropic"
    ? explicit
    : definition.provider;
}

const refinerProvider = roleProvider("REFINER", refinerModel);
const evaluatorProvider = roleProvider("EVALUATOR", evaluatorModel);

console.log("=== Prompt Refiner ===");
console.log(`Active prompt:  ${promptPath}`);
console.log(`Issues file:    ${issuesPath}`);
console.log(`Max candidate:  ${maxCandidateLength} chars`);

if (!refinerModel || !evaluatorModel) {
  throw new Error(
    "PROMPT_REFINER_MODEL and PROMPT_EVALUATOR_MODEL must be set in .env.",
  );
}

const refinerDef = resolveModelDefinition(refinerModel);
const evaluatorDef = resolveModelDefinition(evaluatorModel);

console.log(`Refiner model:  ${refinerModel} (${refinerProvider})`);
console.log(`Evaluator model: ${evaluatorModel} (${evaluatorProvider})`);

for (const provider of ["anthropic", "nvidia"] as const) {
  if (!isProviderConfigured(provider)) {
    console.warn(
      `  note: ${provider === "nvidia" ? "NVIDIA_API_KEY" : "ANTHROPIC_API_KEY"} is not set — ${provider} models are unavailable.`,
    );
  }
}

console.log("");

console.log("Reading prompt and issues...");
const [currentPrompt, rawIssues] = await Promise.all([
  readFile(promptPath, "utf8"),
  readFile(issuesPath, "utf8"),
]);

const issues = JSON.parse(rawIssues) as PromptIssue[];
console.log(
  `Loaded ${issues.length} issue(s), prompt is ${currentPrompt.length} chars.`,
);

// Optional: evaluations/prompt-refinement/feedback.txt — one line per item,
// "#" comments ignored. Used when Juan requests a narrow behavioral
// adjustment that is not yet backed by a structured issue.
let humanFeedback: string[] | undefined;

try {
  const feedbackText = await readFile(
    path.join(projectRoot, "evaluations", "prompt-refinement", "feedback.txt"),
    "utf8",
  );

  const lines = feedbackText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (lines.length > 0) {
    humanFeedback = lines;
  }
} catch {
  // feedback.txt is optional; a missing file is not an error.
}

if (humanFeedback?.length) {
  console.log(`Loaded ${humanFeedback.length} human feedback item(s).`);
}

const refinerLlm = withProgress(
  "refiner",
  createLlmClient(refinerModel, refinerProvider),
);
const evaluatorLlm = createLlmClient(evaluatorModel, evaluatorProvider);

// The refiner always runs a baseline adversarial evaluation of the current
// prompt (for the report's `before`), so the API key is required even on the
// no_change path.
const evaluate = async (candidate: string) => {
  console.log(`[evaluator] request started — ${new Date().toISOString()}`);
  const startedAt = Date.now();

  try {
    const evaluation = await evaluatePrompt(candidate, evaluatorLlm);
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `[evaluator] completed in ${seconds}s — score=${evaluation.score} passed=${evaluation.passed}`,
    );
    return evaluation;
  } catch (error) {
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.error(
      `[evaluator] FAILED after ${seconds}s — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw error;
  }
};

const result = await refineLinkedInJobAgentPrompt(
  {
    currentPrompt,
    issues,
    humanFeedback,
    runId: new Date().toISOString(),
    maxCandidateLength,
  },
  refinerLlm,
  evaluate,
);

await mkdir(historyDirectory, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(historyDirectory, `${timestamp}.report.json`);

console.log("Writing audit report...");
await writeFile(reportPath, JSON.stringify(result, null, 2), "utf8");
console.log("Audit report written.");

if (result.status === "promoted") {
  const candidatePath = path.join(
    historyDirectory,
    `${timestamp}.candidate.system.md`,
  );

  await writeFile(candidatePath, result.refinedPrompt, "utf8");

  console.log(`Candidate prompt created: ${candidatePath}`);
  console.log(`Audit report created: ${reportPath}`);
  console.log("Review the candidate diff before manual promotion.");
} else {
  console.log(`No candidate promoted. Audit report created: ${reportPath}`);
}

if (result.status === "rejected") {
  console.log("\nRejected. Reasons:");
  for (const reason of result.rationale) {
    console.log(`  - ${reason}`);
  }
  if (result.refinerResponse) {
    console.log(
      "  (The refiner's raw response is stored under refinerResponse in the report for diagnosis.)",
    );
  }
}

console.log("\nEvaluation result:");
console.log(JSON.stringify(result.after, null, 2));
