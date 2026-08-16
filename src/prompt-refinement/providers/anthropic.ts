import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient } from "../types.js";

/**
 * Reads a positive number from the environment with a fallback. Guards
 * against NaN (e.g. an empty or malformed value) so the SDK never receives
 * an invalid option.
 */
function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function createAnthropicClient(model: string): LlmClient {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is missing. Add it to .env before running this command.",
    );
  }

  // Without an explicit timeout the SDK waits 10 minutes per attempt and
  // retries twice, so a slow or blackholed request can appear to freeze for
  // 30+ minutes. Fail loudly instead: 3 minutes per attempt, one retry, both
  // configurable via .env.
  const client = new Anthropic({
    timeout: envNumber("PROMPT_REFINER_TIMEOUT_MS", 180_000),
    maxRetries: envNumber("PROMPT_REFINER_MAX_RETRIES", 1),
  });

  // The refiner must reproduce the full ~39k-char active prompt in its
  // response. 8,000 output tokens was too small: responses got truncated
  // mid-prompt and the run silently rejected a good candidate. Default is
  // 20,000 (Haiku 4.5 supports up to 64k); configurable via .env.
  const maxTokens = envNumber("PROMPT_REFINER_MAX_TOKENS", 20_000);

  return {
    async generateText(prompt: string): Promise<string> {
      try {
        const message = await client.messages.create({
          model,
          max_tokens: maxTokens,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
        });

        const text = extractText(message);

        if (!text) {
          throw new Error("Anthropic returned no text content.");
        }

        return text;
      } catch (error) {
        if (error instanceof Anthropic.APIError) {
          throw new Error(
            `Anthropic API error: status=${error.status}, name=${error.name}, message=${error.message}`,
          );
        }

        throw error;
      }
    },
  };
}
