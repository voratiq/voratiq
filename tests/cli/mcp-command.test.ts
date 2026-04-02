import { Command } from "commander";

import { createMcpCommand } from "../../src/cli/mcp.js";
import { silenceCommander } from "../support/commander.js";

describe("mcp command options", () => {
  it("parses --stdio", async () => {
    let received: { stdio?: boolean } | undefined;
    const command = silenceCommander(createMcpCommand());
    command.exitOverride().action((options: { stdio?: boolean }) => {
      received = options;
    });

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(command);

    await program.parseAsync(["mcp", "--stdio"], { from: "user" });

    expect(received?.stdio).toBe(true);
  });
});
