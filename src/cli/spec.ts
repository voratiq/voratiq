import { Command, Option } from "commander";

import { checkPlatformSupport } from "../agents/runtime/sandbox.js";
import { executeSpecCommand } from "../commands/spec/command.js";
import {
  ensureSandboxDependencies,
  resolveCliContext,
} from "../preflight/index.js";
import { renderSpecTranscript } from "../render/transcripts/spec.js";
import { parsePositiveInteger } from "../utils/validators.js";
import { type CommandOutputWriter, writeCommandOutput } from "./output.js";

export interface SpecCommandOptions {
  description: string;
  agent?: string;
  profile?: string;
  maxParallel?: number;
  title?: string;
  output?: string;
  suppressHint?: boolean;
  writeOutput?: CommandOutputWriter;
}

export interface SpecCommandResult {
  body: string;
  outputPath: string;
}

export async function runSpecCommand(
  options: SpecCommandOptions,
): Promise<SpecCommandResult> {
  const {
    description,
    agent,
    profile,
    maxParallel,
    title,
    output,
    suppressHint,
    writeOutput = writeCommandOutput,
  } = options;

  const { root, workspacePaths } = await resolveCliContext();
  checkPlatformSupport();
  ensureSandboxDependencies();

  const result = await executeSpecCommand({
    root,
    specsFilePath: workspacePaths.specsFile,
    description,
    agentId: agent,
    profileName: profile,
    maxParallel,
    title,
    outputPath: output,
    onStatus: (message) => {
      writeOutput({ alerts: [{ severity: "info", message }] });
    },
  });

  const body = renderSpecTranscript(result.outputPath, { suppressHint });

  return {
    body,
    outputPath: result.outputPath,
  };
}

export function createSpecCommand(): Command {
  const parseMaxParallelOption = (value: string): number =>
    parsePositiveInteger(
      value,
      "Expected positive integer after --max-parallel",
      "--max-parallel must be greater than 0",
    );

  return new Command("spec")
    .description("Generate a structured spec via a sandboxed agent")
    .requiredOption(
      "--description <text>",
      "Human description to convert into a spec",
    )
    .option("--agent <agent-id>", "Agent identifier to use")
    .option("--profile <name>", 'Orchestration profile (default: "default")')
    .addOption(
      new Option(
        "--max-parallel <count>",
        "Maximum number of spec agents to run concurrently",
      ).argParser(parseMaxParallelOption),
    )
    .option("--title <text>", "Optional spec title")
    .option("--output <path>", "Optional output path within .voratiq/specs/")
    .allowExcessArguments(false)
    .action(async (commandOptions: SpecCommandOptions) => {
      const result = await runSpecCommand(commandOptions);
      writeCommandOutput({ body: result.body });
    });
}
