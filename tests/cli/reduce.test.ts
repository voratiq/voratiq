import { Command } from "commander";

import { createReduceCommand } from "../../src/cli/reduce.js";
import { silenceCommander } from "../support/commander.js";

describe("reduce command options", () => {
  it("requires exactly one target flag", async () => {
    const reduceCommand = silenceCommander(createReduceCommand());
    reduceCommand.exitOverride();

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(reduceCommand);

    await expect(
      program.parseAsync(["reduce", "--agent", "alpha"], { from: "user" }),
    ).rejects.toThrow(
      /exactly one target flag is required: `--spec`, `--run`, `--verify`, or `--reduce`/i,
    );
  });

  it("rejects multiple target flags", async () => {
    const reduceCommand = silenceCommander(createReduceCommand());
    reduceCommand.exitOverride();

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(reduceCommand);

    await expect(
      program.parseAsync(["reduce", "--spec", "spec-1", "--run", "run-2"], {
        from: "user",
      }),
    ).rejects.toThrow(
      /exactly one target flag is required: `--spec`, `--run`, `--verify`, or `--reduce`/i,
    );
  });

  it("parses reducer options", async () => {
    let received: ReduceCommandActionOptions | undefined;

    const reduceCommand = silenceCommander(createReduceCommand());
    reduceCommand
      .exitOverride()
      .action((options: ReduceCommandActionOptions) => {
        received = options;
      });

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(reduceCommand);

    await program.parseAsync(
      [
        "reduce",
        "--spec",
        "spec-123",
        "--agent",
        "alpha",
        "--agent",
        "beta",
        "--profile",
        "quality",
        "--max-parallel",
        "2",
      ],
      { from: "user" },
    );

    expect(received).toEqual({
      spec: "spec-123",
      agent: ["alpha", "beta"],
      profile: "quality",
      maxParallel: 2,
      extraContext: [],
    });
  });

  it("parses repeatable --extra-context preserving order", async () => {
    let received: ReduceCommandActionOptions | undefined;

    const reduceCommand = silenceCommander(createReduceCommand());
    reduceCommand
      .exitOverride()
      .action((options: ReduceCommandActionOptions) => {
        received = options;
      });

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(reduceCommand);

    await program.parseAsync(
      [
        "reduce",
        "--run",
        "run-123",
        "--extra-context",
        "notes/a.md",
        "--extra-context",
        "notes/b.json",
      ],
      { from: "user" },
    );

    expect(received?.extraContext).toEqual(["notes/a.md", "notes/b.json"]);
  });
});

interface ReduceCommandActionOptions {
  spec?: string;
  run?: string;
  verify?: string;
  reduce?: string;
  agent?: string[];
  profile?: string;
  maxParallel?: number;
  extraContext?: string[];
}
