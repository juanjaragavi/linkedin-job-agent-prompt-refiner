import { exec } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Builds a text-only CallToolResult for MCP tool handlers. */
export function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], isError };
}

/** Truncates long command output so tool results stay readable. */
export function truncate(text: string, maxChars = 50_000): string {
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}\n… [truncated ${text.length - maxChars} chars]`
    : text;
}

/**
 * Resolves a user-supplied path against an explicit root and refuses paths
 * that escape it. File tools and API endpoints are confined to their root.
 */
export function resolveWithin(root: string, inputPath: string): string {
  const resolved = path.resolve(root, inputPath);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path is outside the root (${root}): ${inputPath}`);
  }

  return resolved;
}

/**
 * Resolves a user-supplied path against the project root and refuses paths
 * that escape it. File tools are confined to the project by default.
 */
export function resolveInProject(inputPath: string): string {
  return resolveWithin(projectRoot, inputPath);
}

/** Runs a shell command and captures stdout/stderr/exit code without throwing. */
export async function runProcess(
  command: string,
  cwd: string,
  timeoutMs = 300_000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: process.env,
      },
      (error, stdout, stderr) => {
        const exitCode =
          error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolve({ stdout, stderr, exitCode });
      }
    );
  });
}

/**
 * Appends one line to logs/mcp-commands.log. Every executed command is
 * recorded here so command activity is auditable.
 */
export async function appendAuditLog(line: string): Promise<void> {
  const logPath = path.join(projectRoot, "logs", "mcp-commands.log");
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${new Date().toISOString()} ${line}\n`, "utf8");
}
