import { afterEach, describe, expect, it } from "vitest";
import {
  MODEL_REGISTRY,
  createLlmClient,
  createLlmClientFromEnv,
  isProviderConfigured,
  resolveModelDefinition,
} from "./provider.js";

const SAVED_ENV: Record<string, string | undefined> = {};

afterEach(() => {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  for (const key of Object.keys(process.env)) {
    if (
      /^(ANTHROPIC_API_KEY|NVIDIA_API_KEY)$/.test(key) &&
      !(key in SAVED_ENV)
    ) {
      delete process.env[key];
    }
  }
});

function captureEnv(...keys: string[]): void {
  for (const key of keys) {
    SAVED_ENV[key] = process.env[key];
  }
  for (const key of keys) {
    delete process.env[key];
  }
}

describe("model registry", () => {
  it("lists the NVIDIA target model with its commercial display name", () => {
    const entry = MODEL_REGISTRY.find(
      (model) => model.id === "nvidia/nemotron-3.5-lightning-30b-a3b",
    );

    expect(entry).toBeDefined();
    expect(entry?.provider).toBe("nvidia");
    expect(entry?.displayName).toBe("NVIDIA Nemotron 3.5 Lightning 30B");
  });

  it("maps every registry entry to a known provider", () => {
    for (const entry of MODEL_REGISTRY) {
      expect(["anthropic", "nvidia"]).toContain(entry.provider);
      expect(entry.displayName.length).toBeGreaterThan(0);
    }
  });

  it("falls back to Anthropic for unknown model IDs", () => {
    const resolved = resolveModelDefinition("some/custom-model");
    expect(resolved.provider).toBe("anthropic");
    expect(resolved.displayName).toBe("some/custom-model");
  });

  it("reports provider configuration from the environment", () => {
    captureEnv("ANTHROPIC_API_KEY", "NVIDIA_API_KEY");
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.NVIDIA_API_KEY = "nvapi-test";

    expect(isProviderConfigured("anthropic")).toBe(true);
    expect(isProviderConfigured("nvidia")).toBe(true);

    delete process.env.NVIDIA_API_KEY;
    expect(isProviderConfigured("nvidia")).toBe(false);
  });
});

describe("createLlmClient dispatch", () => {
  it("routes a registry NVIDIA model to the NVIDIA client and fails loudly without a key", () => {
    captureEnv("NVIDIA_API_KEY");

    expect(() =>
      createLlmClient("nvidia/nemotron-3.5-lightning-30b-a3b"),
    ).toThrow(/NVIDIA_API_KEY is missing/);
  });

  it("routes a registry Anthropic model to the Anthropic client", () => {
    captureEnv("ANTHROPIC_API_KEY");

    expect(() => createLlmClient("claude-haiku-4-5-20251001")).toThrow(
      /ANTHROPIC_API_KEY is missing/,
    );
  });

  it("routes an unknown model ID to Anthropic by default", () => {
    captureEnv("ANTHROPIC_API_KEY");

    expect(() => createLlmClient("custom-model")).toThrow(
      /ANTHROPIC_API_KEY is missing/,
    );
  });

  it("honors an explicit provider override for custom model IDs", () => {
    captureEnv("NVIDIA_API_KEY");

    expect(() => createLlmClient("custom-model", "nvidia")).toThrow(
      /NVIDIA_API_KEY is missing/,
    );
  });

  it("creates a working client when the matching key is present", () => {
    captureEnv("NVIDIA_API_KEY", "ANTHROPIC_API_KEY");
    process.env.NVIDIA_API_KEY = "nvapi-test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const nvidia = createLlmClient("nvidia/nemotron-3.5-lightning-30b-a3b");
    const anthropic = createLlmClient("claude-haiku-4-5-20251001");

    expect(typeof nvidia.generateText).toBe("function");
    expect(typeof anthropic.generateText).toBe("function");
  });

  it("routes a registry NVIDIA model to NVIDIA even if PROMPT_*_PROVIDER says anthropic", () => {
    // Regression: .env defaults PROMPT_REFINER_PROVIDER=anthropic. A registry
    // nvidia/* model must never be sent to the Anthropic API (404) because of
    // that default — the registry is authoritative for known models.
    captureEnv(
      "NVIDIA_API_KEY",
      "ANTHROPIC_API_KEY",
      "PROMPT_REFINER_MODEL",
      "PROMPT_REFINER_PROVIDER",
    );
    process.env.PROMPT_REFINER_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
    process.env.PROMPT_REFINER_PROVIDER = "anthropic";

    expect(() => createLlmClientFromEnv("refiner")).toThrow(
      /NVIDIA_API_KEY is missing/,
    );
  });

  it("applies the env provider to a custom model ID not in the registry", () => {
    captureEnv(
      "NVIDIA_API_KEY",
      "ANTHROPIC_API_KEY",
      "PROMPT_REFINER_MODEL",
      "PROMPT_REFINER_PROVIDER",
    );
    process.env.PROMPT_REFINER_MODEL = "custom-org/my-model";
    process.env.PROMPT_REFINER_PROVIDER = "nvidia";

    expect(() => createLlmClientFromEnv("refiner")).toThrow(
      /NVIDIA_API_KEY is missing/,
    );

    process.env.PROMPT_REFINER_PROVIDER = "anthropic";
    expect(() => createLlmClientFromEnv("refiner")).toThrow(
      /ANTHROPIC_API_KEY is missing/,
    );
  });
});
