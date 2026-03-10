import { Command } from "commander";

import { executeApplyCommand } from "../commands/apply/command.js";
import type { ApplyResult } from "../commands/apply/types.js";
import {
  ensureCleanWorkingTree,
  resolveCliContext,
} from "../preflight/index.js";
import { renderApplyTranscript } from "../render/transcripts/apply.js";
import { type CommandOutputWriter, writeCommandOutput } from "./output.js";

export interface ApplyCommandOptions {
  runId: string;
  agentId: string;
  ignoreBaseMismatch?: boolean;
  commit?: boolean;
  writeOutput?: CommandOutputWriter;
}

export interface ApplyCommandResult {
  result: ApplyResult;
  body: string;
  exitCode?: number;
}

export async function runApplyCommand(
  options: ApplyCommandOptions,
): Promise<ApplyCommandResult> {
  const {
    runId,
    agentId,
    ignoreBaseMismatch = false,
    commit = false,
  } = options;

  const { root, workspacePaths } = await resolveCliContext();

  await ensureCleanWorkingTree(root);

  const result = await executeApplyCommand({
    root,
    runsFilePath: workspacePaths.runsFile,
    reviewsFilePath: workspacePaths.reviewsFile,
    runId,
    agentId,
    ignoreBaseMismatch,
    commit,
  });

  const body = renderApplyTranscript(result);

  return { result, body };
}

interface ApplyCommandActionOptions {
  run: string;
  agent: string;
  ignoreBaseMismatch?: boolean;
  commit?: boolean;
}

export function createApplyCommand(): Command {
  return new Command("apply")
    .description("Apply an agent's diff from a run")
    .requiredOption("--run <run-id>", "Run ID containing the agent")
    .requiredOption("--agent <agent-id>", "Agent ID whose diff to apply")
    .option("--ignore-base-mismatch", "Skip base revision check", () => true)
    .option(
      "--commit",
      "Commit after apply, using the agent's summary as the message",
      () => true,
    )
    .allowExcessArguments(false)
    .action(async (options: ApplyCommandActionOptions) => {
      const result = await runApplyCommand({
        runId: options.run,
        agentId: options.agent,
        ignoreBaseMismatch: options.ignoreBaseMismatch ?? false,
        commit: options.commit ?? false,
        writeOutput: writeCommandOutput,
      });

      writeCommandOutput({
        body: result.body,
        exitCode: result.exitCode,
      });
    });
}
