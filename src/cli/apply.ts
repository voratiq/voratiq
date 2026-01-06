import { Command } from "commander";

import { executeApplyCommand } from "../commands/apply/command.js";
import type { ApplyResult } from "../commands/apply/types.js";
import {
  ensureCleanWorkingTree,
  resolveCliContext,
} from "../preflight/index.js";
import { renderApplyTranscript } from "../render/transcripts/apply.js";
import { writeCommandOutput } from "./output.js";

export interface ApplyCommandOptions {
  runId: string;
  agentId: string;
  ignoreBaseMismatch?: boolean;
  commit?: boolean;
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
    .description("Apply the winning agent implementation from a run")
    .requiredOption("--run <run-id>", "Identifier of the recorded run")
    .requiredOption("--agent <agent-id>", "Agent id to apply from the run")
    .option(
      "--ignore-base-mismatch",
      "Apply even if the current HEAD differs from the recorded base",
      () => true,
    )
    .option(
      "--commit",
      "Commit the applied diff immediately using the agent summary",
      () => true,
    )
    .allowExcessArguments(false)
    .action(async (options: ApplyCommandActionOptions) => {
      const result = await runApplyCommand({
        runId: options.run,
        agentId: options.agent,
        ignoreBaseMismatch: options.ignoreBaseMismatch ?? false,
        commit: options.commit ?? false,
      });

      writeCommandOutput({
        body: result.body,
        exitCode: result.exitCode,
      });
    });
}
