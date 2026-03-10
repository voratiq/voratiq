import { Command, Option } from "commander";

import { checkPlatformSupport } from "../agents/runtime/sandbox.js";
import { executeSpecCommand } from "../commands/spec/command.js";
import { resolveExtraContextFiles } from "../competition/shared/extra-context.js";
import {
  ensureSandboxDependencies,
  resolveCliContext,
} from "../preflight/index.js";
import { renderWorkspaceAutoInitializedNotice } from "../render/transcripts/shared.js";
import { renderSpecTranscript } from "../render/transcripts/spec.js";
import { createStageStartLineEmitter } from "../render/utils/stage-output.js";
import { parsePositiveInteger } from "../utils/validators.js";
import { type CommandOutputWriter, writeCommandOutput } from "./output.js";

export interface SpecCommandOptions {
  description: string;
  agent?: string;
  profile?: string;
  maxParallel?: number;
  title?: string;
  output?: string;
  extraContext?: string[];
  suppressHint?: boolean;
  writeOutput?: CommandOutputWriter;
}

export interface SpecCommandResult {
  body: string;
  outputPath: string;
  specPath?: string;
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
    extraContext,
    suppressHint,
    writeOutput = writeCommandOutput,
  } = options;

  const { root, workspacePaths, workspaceAutoInitialized } =
    await resolveCliContext({
      workspaceAutoInitMode: "when-missing",
    });

  if (workspaceAutoInitialized) {
    writeOutput({
      alerts: [
        { severity: "info", message: renderWorkspaceAutoInitializedNotice() },
      ],
      leadingNewline: false,
    });
  }

  checkPlatformSupport();
  ensureSandboxDependencies();
  const extraContextFiles = await resolveExtraContextFiles({
    root,
    paths: extraContext,
  });

  const startLine = createStageStartLineEmitter((message) => {
    writeOutput({
      alerts: [{ severity: "info", message }],
    });
  });

  const result = await executeSpecCommand({
    root,
    specsFilePath: workspacePaths.specsFile,
    description,
    agentId: agent,
    profileName: profile,
    maxParallel,
    title,
    outputPath: output,
    extraContextFiles,
    onStatus: (message) => {
      startLine.emit(message);
    },
  });

  const body = renderSpecTranscript(result.outputPath, { suppressHint });

  return {
    body,
    outputPath: result.outputPath,
    specPath: result.outputPath,
  };
}

export function createSpecCommand(): Command {
  const parseMaxParallelOption = (value: string): number =>
    parsePositiveInteger(
      value,
      "Expected positive integer after --max-parallel",
      "--max-parallel must be greater than 0",
    );
  const collectExtraContextOption = (
    value: string,
    previous: string[],
  ): string[] => [...previous, value];

  return new Command("spec")
    .description("Generate a spec from a task description")
    .requiredOption("--description <text>", "Task description")
    .option(
      "--agent <agent-id>",
      "Agent to draft the spec (uses orchestration config if omitted)",
    )
    .option("--profile <name>", 'Orchestration profile (default: "default")')
    .addOption(
      new Option("--max-parallel <count>", "Max concurrent agents")
        .argParser(parseMaxParallelOption)
        .hideHelp(),
    )
    .option("--title <text>", "Spec title; agent infers if omitted")
    .option(
      "--output <path>",
      "Output path (default: .voratiq/specs/<slug>.md)",
    )
    .addOption(
      new Option(
        "--extra-context <path>",
        "Stage an extra context file into the spec workspace (repeatable)",
      )
        .default([], "")
        .argParser(collectExtraContextOption),
    )
    .allowExcessArguments(false)
    .action(async (commandOptions: SpecCommandOptions) => {
      const result = await runSpecCommand(commandOptions);
      writeCommandOutput({ body: result.body });
    });
}
