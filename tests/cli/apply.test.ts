import { Command } from "commander";

import { createApplyCommand } from "../../src/cli/apply.js";
import { silenceCommander } from "../support/commander.js";

describe("apply command options", () => {
  it("requires --run", async () => {
    const applyCommand = silenceCommander(createApplyCommand());
    applyCommand.exitOverride().action(() => {});

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(applyCommand);

    await expect(
      program.parseAsync(["apply", "--agent", "claude"], { from: "user" }),
    ).rejects.toThrow(/required option '--run <run-id>'/iu);
  });

  it("requires --agent", async () => {
    const applyCommand = silenceCommander(createApplyCommand());
    applyCommand.exitOverride().action(() => {});

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(applyCommand);

    await expect(
      program.parseAsync(["apply", "--run", "run-123"], { from: "user" }),
    ).rejects.toThrow(/required option '--agent <agent-id>'/iu);
  });

  it("parses --ignore-base-mismatch as a boolean flag", async () => {
    let received: ApplyCommandActionOptions | undefined;

    const applyCommand = silenceCommander(createApplyCommand());
    applyCommand.exitOverride().action((options: ApplyCommandActionOptions) => {
      received = options;
    });

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(applyCommand);

    await program.parseAsync(
      [
        "apply",
        "--run",
        "run-123",
        "--agent",
        "claude",
        "--ignore-base-mismatch",
      ],
      { from: "user" },
    );

    expect(received).toEqual({
      run: "run-123",
      agent: "claude",
      ignoreBaseMismatch: true,
    });
  });
});

interface ApplyCommandActionOptions {
  run: string;
  agent: string;
  ignoreBaseMismatch?: boolean;
}
