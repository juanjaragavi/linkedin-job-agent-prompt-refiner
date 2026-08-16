import OpenAI from "openai";
import type { LlmClient } from "../types.js";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

/**
 * Reads a positive number from the environment with a fallback. Guards
 * against NaN (e.g. an empty or malformed value) so the SDK never receives
 * an invalid option.
 */
function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Creates an OpenAI-compatible client pointed at NVIDIA's hosted inference
 * endpoints (https://integrate.api.nvidia.com/v1). Uses streaming so that
 * thinking-enabled models can be parsed chunk by chunk.
 *
 * Reasoning tokens (`delta.reasoning_content`) are deliberately discarded:
 * this model family is trained to narrate its chain of thought, and letting
 * that text reach the pipeline would corrupt section extraction in refiner.ts
 * and JSON parsing in evaluator.ts. `enable_thinking` is passed *explicitly*
 * (false by default) because omitting it lets the model emit a reasoning
 * preamble straight into `delta.content`.
 */
type ChunkDelta =
  OpenAI.Chat.Completions.ChatCompletionChunk["choices"][number]["delta"];

export function createNvidiaClient(model: string): LlmClient {
  if (!process.env.NVIDIA_API_KEY) {
    throw new Error(
      "NVIDIA_API_KEY is missing. Add it to .env before running this command.",
    );
  }

  const client = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: NVIDIA_BASE_URL,
    timeout: envNumber("PROMPT_REFINER_TIMEOUT_MS", 180_000),
    maxRetries: envNumber("PROMPT_REFINER_MAX_RETRIES", 1),
  });

  const maxTokens = envNumber("PROMPT_REFINER_MAX_TOKENS", 20_000);
  const enableThinking = process.env.NVIDIA_ENABLE_THINKING === "true";

  return {
    async generateText(prompt: string): Promise<string> {
      try {
        // The openai SDK (v7+) has no `extra_body` option — the body object is
        // serialized as-is, so `chat_template_kwargs` goes top-level. The cast
        // is required because NVIDIA's extension is not part of the SDK types.
        const stream = await client.chat.completions.create({
          model,
          max_tokens: maxTokens,
          temperature: 0,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          chat_template_kwargs: { enable_thinking: enableThinking },
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);

        let text = "";

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta as
            (ChunkDelta & { reasoning_content?: string }) | undefined;

          // Thinking tokens are deliberately dropped: appending
          // `reasoning_content` would corrupt the refiner's section parsing
          // and the evaluator's JSON parsing.
          const { content, reasoning_content: _reasoning } = delta ?? {};

          if (content) {
            text += content;
          }
        }

        const trimmed = text.trim();

        if (!trimmed) {
          throw new Error("NVIDIA returned no text content.");
        }

        return trimmed;
      } catch (error) {
        if (error instanceof OpenAI.APIError) {
          throw new Error(
            `NVIDIA API error: status=${error.status}, name=${error.name}, message=${error.message}`,
          );
        }

        throw error;
      }
    },
  };
}
