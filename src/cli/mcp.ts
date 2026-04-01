import process from "node:process";

import { Command } from "commander";

import {
  createEntrypointCliTarget,
  runVoratiqMcpStdioServer,
} from "../mcp/server.js";

export function createMcpCommand(): Command {
  return new Command("mcp")
    .description("Run the bundled Voratiq MCP server")
    .requiredOption("--stdio", "Serve MCP over stdio")
    .allowExcessArguments(false)
    .action(async (): Promise<void> => {
      await runVoratiqMcpStdioServer({
        selfCliTarget: createEntrypointCliTarget({
          cliEntrypoint: process.argv[1],
        }),
      });
    });
}
