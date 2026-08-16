import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCommandTools } from "./tools/commands.js";
import { registerFileTools } from "./tools/files.js";
import { registerProjectTools } from "./tools/project.js";

const server = new McpServer({
  name: "prompt-refiner-mcp",
  version: "1.0.0",
});

registerFileTools(server);
registerCommandTools(server);
registerProjectTools(server);

// IMPORTANT: never write to stdout — it is the MCP transport channel.
console.error(
  "[prompt-refiner-mcp] started — tools: read_file, list_directory, search_files, write_file, edit_file, append_file, run_command (approval-gated), prompt_check, run_tests, typecheck, prompt_refine",
);

const transport = new StdioServerTransport();
await server.connect(transport);
