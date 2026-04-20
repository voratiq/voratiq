import { Command } from "commander";

import { createApplyCommand } from "../../src/cli/apply.js";
import { createReduceCommand } from "../../src/cli/reduce.js";
import { createRunCommand } from "../../src/cli/run.js";
import { createSpecCommand } from "../../src/cli/spec.js";
import { createVerifyCommand } from "../../src/cli/verify.js";
import { silenceCommander } from "../support/commander.js";

describe("operator json mode options", () => {
  it("parses --json for spec", async () => {
    let received: { json?: boolean } | undefined;
    const command = silenceCommander(createSpecCommand());
    command.exitOverride().action((options: { json?: boolean }) => {
      received = options;
    });

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(command);

    await program.parseAsync([
      "node",
      "voratiq",
      "spec",
      "--description",
      "Test",
      "--json",
    ]);

    expect(received?.json).toBe(true);
  });

  it("parses --json for run", async () => {
    let received: { json?: boolean } | undefined;
    const command = silenceCommander(createRunCommand());
    command.exitOverride().action((options: { json?: boolean }) => {
      received = options;
    });

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(command);

    await program.parseAsync([
      "node",
      "voratiq",
      "run",
      "--spec",
      "specs/test.md",
      "--json",
    ]);

    expect(received?.json).toBe(true);
  });

  it("parses --json for verify", async () => {
    let received: { json?: boolean } | undefined;
    const command = silenceCommander(createVerifyCommand());
    command.exitOverride().action((options: { json?: boolean }) => {
      received = options;
    });

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(command);

    await program.parseAsync([
      "node",
      "voratiq",
      "verify",
      "--run",
      "run-123",
      "--json",
    ]);

    expect(received?.json).toBe(true);
  });

  it("parses --json for reduce", async () => {
    let received: { json?: boolean } | undefined;
    const command = silenceCommander(createReduceCommand());
    command.exitOverride().action((options: { json?: boolean }) => {
      received = options;
    });

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(command);

    await program.parseAsync([
      "node",
      "voratiq",
      "reduce",
      "--run",
      "run-123",
      "--json",
    ]);

    expect(received?.json).toBe(true);
  });

  it("parses --json for apply", async () => {
    let received: { json?: boolean } | undefined;
    const command = silenceCommander(createApplyCommand());
    command.exitOverride().action((options: { json?: boolean }) => {
      received = options;
    });

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(command);

    await program.parseAsync(
      ["apply", "--run", "run-123", "--agent", "agent-a", "--json"],
      { from: "user" },
    );

    expect(received?.json).toBe(true);
  });
});
