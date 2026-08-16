import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

function extractText(result: unknown): string {
  if (!result || typeof result !== "object") {
    return "";
  }

  const content = (result as { content?: Array<{ type?: string; text?: string }> })
    .content;

  return (content ?? [])
    .filter((block) => block?.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

describe("prompt-refiner MCP server", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/mcp-server/index.ts"],
      cwd: projectRoot,
      stderr: "pipe",
    });
    client = new Client({ name: "mcp-server-test", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  it("exposes the expected tool set", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    for (const expected of [
      "read_file",
      "list_directory",
      "search_files",
      "write_file",
      "edit_file",
      "append_file",
      "run_command",
      "prompt_check",
      "run_tests",
      "typecheck",
      "prompt_refine",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("reads the active system prompt", async () => {
    const result = await client.callTool({
      name: "read_file",
      arguments: { path: "prompts/linkedin-job-assistant.system.md" },
    });

    expect(extractText(result)).toContain("# System");
  });

  it("writes, edits, and appends files inside the project", async () => {
    const target = "logs/mcp-server-test.md";

    await client.callTool({
      name: "write_file",
      arguments: { path: target, content: "line one\n" },
    });
    await client.callTool({
      name: "edit_file",
      arguments: {
        path: target,
        old_string: "line one",
        new_string: "line one edited",
      },
    });
    await client.callTool({
      name: "append_file",
      arguments: { path: target, content: "line two\n" },
    });

    const read = await client.callTool({
      name: "read_file",
      arguments: { path: target },
    });
    const text = extractText(read);

    expect(text).toContain("line one edited");
    expect(text).toContain("line two");

    await rm(path.join(projectRoot, target), { force: true });
  });

  it("refuses writes outside the project root", async () => {
    const result = await client.callTool({
      name: "write_file",
      arguments: { path: "/tmp/mcp-forbidden-write.txt", content: "nope" },
    });

    expect(extractText(result)).toContain("outside the root");
  });

  it("requires approval before running a command", async () => {
    const preview = await client.callTool({
      name: "run_command",
      arguments: { command: "echo hello-mcp", confirm: false },
    });

    const text = extractText(preview);
    expect(text).toContain("APPROVAL REQUIRED");
    expect(text).toContain("echo hello-mcp");
    expect(text).toContain("confirm: true");
  });

  it("executes an approved command and writes the audit log", async () => {
    const result = await client.callTool({
      name: "run_command",
      arguments: { command: "echo hello-mcp-approved", confirm: true },
    });

    const text = extractText(result);
    expect(text).toContain("hello-mcp-approved");
    expect(text).toContain("exit code: 0");

    const audit = await readFile(
      path.join(projectRoot, "logs", "mcp-commands.log"),
      "utf8"
    );
    expect(audit).toContain("echo hello-mcp-approved");
  });

  it("runs the offline prompt check", async () => {
    const result = await client.callTool({ name: "prompt_check", arguments: {} });

    const text = extractText(result);
    expect(text).toContain("All checks passed.");
    expect(text).toContain("exit code: 0");
  });
});
