import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluatePrompt } from "../prompt-refinement/evaluator.js";
import {
  MODEL_REGISTRY,
  createLlmClient,
  resolveModelDefinition,
} from "../prompt-refinement/providers/provider.js";
import type { ModelProvider } from "../prompt-refinement/providers/provider.js";
import { refineLinkedInJobAgentPrompt } from "../prompt-refinement/refiner.js";
import type {
  LlmClient,
  PromptIssue,
  RefinerResult,
} from "../prompt-refinement/types.js";

export interface PipelineProgress {
  stage: string;
  message: string;
  at: string;
}

export interface RefineRunOptions {
  root: string;
  issuesFile: string;
  feedback?: string[];
  /** In-memory prompt to refine instead of the active prompt file (GUI upload workflow). */
  promptContent?: string;
  /** Per-run model override (technical ID, e.g. from the GUI dropdown). */
  refinerModel?: string;
  /** Per-run model override (technical ID, e.g. from the GUI dropdown). */
  evaluatorModel?: string;
  refinerLlm?: LlmClient;
  evaluatorLlm?: LlmClient;
  onProgress?: (event: PipelineProgress) => void;
}

/** Refiner attempts per run; retries feed the rejection reason back to the model. */
const MAX_REFINER_ATTEMPTS = 3;

export interface RefineRunResult {
  result: RefinerResult;
  reportPath: string;
  candidatePath?: string;
}

function emit(
  onProgress: RefineRunOptions["onProgress"],
  stage: string,
  message: string,
): void {
  onProgress?.({ stage, message, at: new Date().toISOString() });
}

/**
 * Runs the same refinement loop as the CLI, but reports each stage through an
 * `onProgress` callback (used to stream events over SSE) and writes the audit
 * report to prompt-history/.
 */
export async function runRefinePipeline(
  options: RefineRunOptions,
): Promise<RefineRunResult> {
  const { root, issuesFile, feedback, onProgress } = options;

  const promptPath = path.join(
    root,
    "prompts",
    "linkedin-job-assistant.system.md",
  );
  const historyDirectory = path.join(root, "prompt-history");

  emit(onProgress, "load", "Reading prompt and issues...");

  const [currentPrompt, rawIssues] = await Promise.all([
    options.promptContent !== undefined
      ? Promise.resolve(options.promptContent)
      : readFile(promptPath, "utf8"),
    readFile(issuesFile, "utf8"),
  ]);

  const issues = JSON.parse(rawIssues) as PromptIssue[];
  const promptSource =
    options.promptContent !== undefined
      ? "uploaded prompt (active file untouched)"
      : "active prompt";
  emit(
    onProgress,
    "load",
    `Loaded ${issues.length} issue(s), ${promptSource} is ${currentPrompt.length} chars.`,
  );

  if (feedback?.length) {
    emit(
      onProgress,
      "load",
      `Loaded ${feedback.length} human feedback item(s).`,
    );
  }

  const maxCandidateLength = Number(process.env.PROMPT_MAX_LENGTH ?? 50_000);

  // Only resolve real models when a client is not injected (tests and the
  // MCP layer inject fakes, so the env is never read on those paths).
  const refinerLlm =
    options.refinerLlm ??
    (() => {
      const config = modelConfig("refiner", options.refinerModel);
      emit(
        onProgress,
        "load",
        `Refiner model: ${config.model} (${config.label})`,
      );
      return withProgress(
        "refiner",
        createLlmClient(config.model, config.provider),
        onProgress,
      );
    })();
  const evaluatorLlm =
    options.evaluatorLlm ??
    (() => {
      const config = modelConfig("evaluator", options.evaluatorModel);
      emit(
        onProgress,
        "load",
        `Evaluator model: ${config.model} (${config.label})`,
      );
      return createLlmClient(config.model, config.provider);
    })();

  const evaluate = async (candidate: string) => {
    emit(onProgress, "evaluator", "Adversarial evaluation started…");
    const startedAt = Date.now();

    try {
      const evaluation = await evaluatePrompt(candidate, evaluatorLlm);
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      emit(
        onProgress,
        "evaluator",
        `Evaluation completed in ${seconds}s — score=${evaluation.score} passed=${evaluation.passed}`,
      );
      return evaluation;
    } catch (error) {
      emit(
        onProgress,
        "evaluator",
        `Evaluation FAILED after ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ${
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
      humanFeedback: feedback,
      runId: new Date().toISOString(),
      maxCandidateLength,
      maxAttempts: MAX_REFINER_ATTEMPTS,
    },
    refinerLlm,
    evaluate,
  );

  if ((result.attempts ?? 1) > 1) {
    emit(
      onProgress,
      "refiner",
      `Refiner needed ${result.attempts} attempt(s); each retry fed the rejection reason back.`,
    );
  }

  await mkdir(historyDirectory, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(historyDirectory, `${timestamp}.report.json`);

  emit(onProgress, "write", `Writing audit report…`);
  await writeFile(reportPath, JSON.stringify(result, null, 2), "utf8");

  let candidatePath: string | undefined;

  if (result.status === "promoted") {
    candidatePath = path.join(
      historyDirectory,
      `${timestamp}.candidate.system.md`,
    );
    await writeFile(candidatePath, result.refinedPrompt, "utf8");
    emit(onProgress, "write", `Candidate prompt created: ${candidatePath}`);
  }

  emit(onProgress, "done", `Run finished with status: ${result.status}`);

  return { result, reportPath, candidatePath };
}

interface ModelConfig {
  model: string;
  provider?: ModelProvider;
  label: string;
}

/**
 * Resolves which model + provider to use for one pipeline role. An explicit
 * per-run override (GUI dropdown) wins and derives its provider from the
 * model registry; otherwise the PROMPT_*_MODEL / PROMPT_*_PROVIDER env vars
 * apply, with the provider inferred from the registry when not set.
 */
function modelConfig(
  role: "refiner" | "evaluator",
  override?: string,
): ModelConfig {
  const upper = role === "refiner" ? "REFINER" : "EVALUATOR";
  const model = override ?? process.env[`PROMPT_${upper}_MODEL`];
  if (!model) {
    throw new Error(`PROMPT_${upper}_MODEL must be set in .env.`);
  }

  const definition = resolveModelDefinition(model);

  // Registry models always use their registry provider: an nvidia/* model ID
  // must never be sent to the Anthropic API because a stray
  // PROMPT_*_PROVIDER default says "anthropic". The env provider only applies
  // to custom model IDs not in the registry.
  if (MODEL_REGISTRY.some((entry) => entry.id === model)) {
    return { model, label: definition.provider };
  }

  const envProvider = process.env[`PROMPT_${upper}_PROVIDER`];
  const provider: ModelProvider | undefined =
    envProvider === "nvidia" || envProvider === "anthropic"
      ? envProvider
      : definition.provider;

  return { model, provider, label: provider };
}

/** Wraps an LLM client so each request reports start/completion/failure. */
export function withProgress(
  label: string,
  llm: LlmClient,
  onProgress: RefineRunOptions["onProgress"],
): LlmClient {
  return {
    async generateText(prompt: string): Promise<string> {
      emit(
        onProgress,
        "llm",
        `[${label}] request started — ${new Date().toISOString()}`,
      );
      const startedAt = Date.now();

      try {
        const text = await llm.generateText(prompt);
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        emit(onProgress, "llm", `[${label}] completed in ${seconds}s`);
        return text;
      } catch (error) {
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        emit(
          onProgress,
          "llm",
          `[${label}] FAILED after ${seconds}s — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      }
    },
  };
}
