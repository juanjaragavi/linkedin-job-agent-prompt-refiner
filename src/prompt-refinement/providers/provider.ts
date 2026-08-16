import type { LlmClient } from "../types.js";
import { createAnthropicClient } from "./anthropic.js";
import { createNvidiaClient } from "./nvidia.js";

export type ModelProvider = "anthropic" | "nvidia";

export interface ModelDefinition {
  /** Technical model ID sent to the provider API. */
  id: string;
  /** Provider whose API serves this model. */
  provider: ModelProvider;
  /** Commercial display label shown in UI dropdowns. */
  displayName: string;
}

/**
 * Canonical model registry: maps commercial display names to the technical
 * IDs and providers that serve them. The GUI dropdown is built from this
 * list (served over /api/models); the CLI/server resolve `createLlmClient`
 * against it so a model ID alone determines its provider.
 */
export const MODEL_REGISTRY: readonly ModelDefinition[] = [
  {
    id: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    displayName: "Anthropic Claude Haiku 4.5",
  },
  {
    id: "claude-sonnet-4-5-20250929",
    provider: "anthropic",
    displayName: "Anthropic Claude Sonnet 4.5",
  },
  {
    id: "nvidia/nemotron-3.5-lightning-30b-a3b",
    provider: "nvidia",
    displayName: "NVIDIA Nemotron 3.5 Lightning 30B",
  },
];

/** True when the given provider's API key is present in the environment. */
export function isProviderConfigured(provider: ModelProvider): boolean {
  return provider === "anthropic"
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : Boolean(process.env.NVIDIA_API_KEY);
}

/**
 * Resolves a model ID to its registry entry. Unknown IDs fall back to the
 * Anthropic provider so an arbitrary `PROMPT_REFINER_MODEL` (or an env model
 * not in the registry) keeps working exactly as before.
 */
export function resolveModelDefinition(modelId: string): ModelDefinition {
  const found = MODEL_REGISTRY.find((entry) => entry.id === modelId);
  return found ?? { id: modelId, provider: "anthropic", displayName: modelId };
}

/**
 * Creates an LLM client for a model ID. The provider is derived from the
 * registry when omitted; an explicit provider overrides that (useful for
 * custom model IDs not present in the registry).
 */
export function createLlmClient(
  modelId: string,
  provider?: ModelProvider,
): LlmClient {
  const resolvedProvider = provider ?? resolveModelDefinition(modelId).provider;

  switch (resolvedProvider) {
    case "nvidia":
      return createNvidiaClient(modelId);
    case "anthropic":
    default:
      return createAnthropicClient(modelId);
  }
}

/**
 * Builds a client for one pipeline role from the environment, e.g.
 * `createLlmClientFromEnv("refiner")` reads PROMPT_REFINER_MODEL and
 * (optionally) PROMPT_REFINER_PROVIDER. Registry models always use their
 * registry provider; the env provider only applies to custom model IDs.
 */
export function createLlmClientFromEnv(
  role: "refiner" | "evaluator",
): LlmClient {
  const upper = role === "refiner" ? "REFINER" : "EVALUATOR";
  const model = process.env[`PROMPT_${upper}_MODEL`];
  const provider = process.env[`PROMPT_${upper}_PROVIDER`];

  if (!model) {
    throw new Error(
      `PROMPT_${upper}_MODEL must be set in .env (or pass a model explicitly).`,
    );
  }

  if (MODEL_REGISTRY.some((entry) => entry.id === model)) {
    return createLlmClient(model);
  }

  return createLlmClient(
    model,
    provider === "nvidia" || provider === "anthropic" ? provider : undefined,
  );
}
