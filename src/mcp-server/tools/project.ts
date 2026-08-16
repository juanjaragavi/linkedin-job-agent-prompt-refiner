import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { projectRoot, runProcess, textResult, truncate } from "../helpers.js";

async function runNpm(
  toolName: string,
  args: string[]
): Promise<ReturnType<typeof textResult>> {
  const { stdout, stderr, exitCode } = await runProcess(
    `npm run ${args.join(" ")}`,
    projectRoot,
    600_000
  );

  const output = [
    `[${toolName}] exit code: ${exitCode}`,
    stdout.trim() ? `\n--- stdout ---\n${truncate(stdout)}` : "",
    stderr.trim() ? `\n--- stderr ---\n${truncate(stderr)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return textResult(output, exitCode !== 0);
}

export function registerProjectTools(server: McpServer): void {
  server.tool(
    "prompt_check",
    "Runs the offline validation of the active system prompt and test data (npm run prompt:check). No API key needed.",
    {},
    async () => runNpm("prompt_check", ["prompt:check"])
  );

  server.tool(
    "run_tests",
    "Runs the unit/integration test suite (npm test).",
    {},
    async () => runNpm("run_tests", ["test"])
  );

  server.tool(
    "typecheck",
    "Runs the TypeScript type check (tsc --noEmit).",
    {},
    async () => runNpm("typecheck", ["typecheck"])
  );

  server.tool(
    "prompt_refine",
    "Runs the prompt refinement loop (npm run prompt:refine) with the given issues file. Requires ANTHROPIC_API_KEY in .env. Writes audit reports to prompt-history/.",
    {
      issues_file: z
        .string()
        .describe(
          "Path to the issues file relative to the project root, e.g. evaluations/prompt-refinement/issues.json"
        ),
    },
    async ({ issues_file }) =>
      runNpm("prompt_refine", ["prompt:refine", "--", issues_file])
  );
}
