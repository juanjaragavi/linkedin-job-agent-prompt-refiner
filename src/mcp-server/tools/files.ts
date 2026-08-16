import {
  readdir,
  readFile,
  writeFile,
  appendFile,
  mkdir,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  projectRoot,
  resolveInProject,
  textResult,
  truncate,
} from "../helpers.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "logs"]);

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        files.push(...(await walkFiles(full)));
      }
    } else if (entry.isFile()) {
      files.push(full);
    }
  }

  return files;
}

export function registerFileTools(server: McpServer): void {
  server.tool(
    "read_file",
    "Reads a text file inside the project. Use for prompts, issues, cases, source, reports.",
    {
      path: z
        .string()
        .describe(
          "File path relative to the project root, e.g. prompts/linkedin-job-assistant.system.md",
        ),
    },
    async ({ path: inputPath }) => {
      try {
        const resolved = resolveInProject(inputPath);
        const content = await readFile(resolved, "utf8");
        return textResult(
          `[read_file] ${inputPath} (${content.length} chars)\n\n${truncate(content)}`,
        );
      } catch (error) {
        return textResult(`[read_file] error: ${String(error)}`, true);
      }
    },
  );

  server.tool(
    "list_directory",
    "Lists a directory inside the project (files and subdirectories).",
    {
      path: z
        .string()
        .optional()
        .describe(
          "Directory relative to project root; defaults to the project root.",
        ),
    },
    async ({ path: inputPath = "." }) => {
      try {
        const resolved = resolveInProject(inputPath);
        const entries = await readdir(resolved, { withFileTypes: true });
        const lines = entries.map(
          (entry) =>
            `${entry.isDirectory() ? "[dir] " : "      "}${entry.name}`,
        );
        return textResult(`[list_directory] ${inputPath}\n${lines.join("\n")}`);
      } catch (error) {
        return textResult(`[list_directory] error: ${String(error)}`, true);
      }
    },
  );

  server.tool(
    "search_files",
    "Searches file contents inside the project with a regular expression. Returns file:line matches (max 100).",
    {
      pattern: z
        .string()
        .describe("Regular expression to search for, e.g. 'external.*confirm'"),
      path: z
        .string()
        .optional()
        .describe(
          "Directory to search, relative to project root; defaults to the project root.",
        ),
      flags: z
        .string()
        .optional()
        .describe("Regex flags, e.g. 'i' for case-insensitive."),
    },
    async ({ pattern, path: inputPath = ".", flags = "" }) => {
      try {
        const resolved = resolveInProject(inputPath);
        const regex = new RegExp(pattern, flags);
        const files = await walkFiles(resolved);
        const matches: string[] = [];

        for (const file of files) {
          if (matches.length >= 100) break;
          const content = await readFile(file, "utf8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length && matches.length < 100; i++) {
            if (regex.test(lines[i])) {
              matches.push(
                `${path.relative(projectRoot, file)}:${i + 1}: ${lines[i].trim()}`,
              );
            }
          }
        }

        return textResult(
          matches.length
            ? `[search_files] ${matches.length} match(es)\n${matches.join("\n")}`
            : `[search_files] no matches for /${pattern}/${flags}`,
        );
      } catch (error) {
        return textResult(`[search_files] error: ${String(error)}`, true);
      }
    },
  );

  server.tool(
    "write_file",
    "Creates or overwrites a file inside the project (parent directories are created as needed).",
    {
      path: z.string().describe("File path relative to the project root"),
      content: z.string().describe("Full file content to write"),
    },
    async ({ path: inputPath, content }) => {
      try {
        const resolved = resolveInProject(inputPath);
        await mkdir(path.dirname(resolved), { recursive: true });
        await writeFile(resolved, content, "utf8");
        return textResult(
          `[write_file] wrote ${content.length} chars to ${inputPath}`,
        );
      } catch (error) {
        return textResult(`[write_file] error: ${String(error)}`, true);
      }
    },
  );

  server.tool(
    "edit_file",
    "Applies an exact old_string → new_string replacement in a file inside the project. Fails if old_string is not found, or if it appears multiple times and allow_multiple is false.",
    {
      path: z.string().describe("File path relative to the project root"),
      old_string: z
        .string()
        .describe("Exact text to find (including whitespace)"),
      new_string: z.string().describe("Replacement text"),
      allow_multiple: z
        .boolean()
        .optional()
        .describe(
          "Allow replacing every occurrence when old_string appears more than once",
        ),
    },
    async ({
      path: inputPath,
      old_string,
      new_string,
      allow_multiple = false,
    }) => {
      try {
        const resolved = resolveInProject(inputPath);
        const current = await readFile(resolved, "utf8");

        if (old_string.length === 0) {
          return textResult(
            "[edit_file] error: old_string must not be empty",
            true,
          );
        }

        const occurrences = current.split(old_string).length - 1;
        if (occurrences === 0) {
          return textResult(
            `[edit_file] error: old_string not found in ${inputPath}. First 200 chars of file:\n${current.slice(0, 200)}`,
            true,
          );
        }
        if (occurrences > 1 && !allow_multiple) {
          return textResult(
            `[edit_file] error: old_string appears ${occurrences} times; set allow_multiple: true to replace all`,
            true,
          );
        }

        const updated = current.replaceAll(old_string, new_string);
        await writeFile(resolved, updated, "utf8");
        return textResult(
          `[edit_file] replaced ${occurrences} occurrence(s) in ${inputPath}`,
        );
      } catch (error) {
        return textResult(`[edit_file] error: ${String(error)}`, true);
      }
    },
  );

  server.tool(
    "append_file",
    "Appends text to a file inside the project (creates it if missing).",
    {
      path: z.string().describe("File path relative to the project root"),
      content: z.string().describe("Text to append"),
    },
    async ({ path: inputPath, content }) => {
      try {
        const resolved = resolveInProject(inputPath);
        await mkdir(path.dirname(resolved), { recursive: true });
        await appendFile(resolved, content, "utf8");
        const stats = await readFile(resolved, "utf8");
        return textResult(
          `[append_file] appended ${content.length} chars to ${inputPath} (now ${stats.length} chars)`,
        );
      } catch (error) {
        return textResult(`[append_file] error: ${String(error)}`, true);
      }
    },
  );
}
