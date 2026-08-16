import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  appendAuditLog,
  projectRoot,
  runProcess,
  textResult,
  truncate,
} from "../helpers.js";

export function registerCommandTools(server: McpServer): void {
  server.tool(
    "run_command",
    `Executes a shell command (including SSH to remote hosts) and returns stdout/stderr and the exit code.

APPROVAL FLOW — commands never execute without your consent:
1. The model calls run_command with confirm: false (or omits it) to preview the exact command.
2. You review the command and tell the model to proceed.
3. The model calls run_command again with confirm: true, and only then does it execute.

Every executed command is appended to logs/mcp-commands.log with a timestamp for auditing.

For the app's own operations, prefer the dedicated tools prompt_check, run_tests, typecheck,
and prompt_refine over hand-written npm commands.`,
    {
      command: z
        .string()
        .describe(
          "The full shell command to run, e.g. ssh user@host 'tail -50 /var/log/app.log'",
        ),
      cwd: z
        .string()
        .optional()
        .describe(
          "Working directory, relative to the project root. Defaults to the project root.",
        ),
      confirm: z
        .boolean()
        .describe(
          "Must be true to execute. Pass false or omit to preview the command for approval.",
        ),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional timeout in milliseconds (default 300000)."),
    },
    async ({ command, cwd, confirm, timeoutMs }) => {
      const workingDir = cwd ? path.resolve(projectRoot, cwd) : projectRoot;

      if (confirm !== true) {
        return textResult(
          `APPROVAL REQUIRED — command NOT executed.\n\nCommand:\n${command}\n\nCWD: ${workingDir}\n\nTo execute, call run_command again with confirm: true.`,
        );
      }

      const startedAt = Date.now();
      const { stdout, stderr, exitCode } = await runProcess(
        command,
        workingDir,
        timeoutMs,
      );
      const durationMs = Date.now() - startedAt;

      await appendAuditLog(
        `[exit=${exitCode}] cwd=${workingDir} took=${durationMs}ms cmd=${command}`,
      );

      const output = [
        `[run_command] exit code: ${exitCode}`,
        `[run_command] duration: ${durationMs}ms`,
        stdout.trim() ? `\n--- stdout ---\n${truncate(stdout)}` : "",
        stderr.trim() ? `\n--- stderr ---\n${truncate(stderr)}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return textResult(
        output || `[run_command] exit code: ${exitCode} (no output)`,
      );
    },
  );
}
