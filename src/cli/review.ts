import { Command } from "commander";

import {
  executeReviewCommand,
  type ReviewCommandResult as ReviewExecutionResult,
} from "../commands/review/command.js";
import { resolveCliContext } from "../preflight/index.js";
import { renderReviewTranscript } from "../render/transcripts/review.js";
import { writeCommandOutput } from "./output.js";

export interface ReviewCommandOptions {
  runId: string;
}

export interface ReviewCommandResult extends ReviewExecutionResult {
  body: string;
  stderr?: string;
  exitCode?: number;
}

export async function runReviewCommand(
  options: ReviewCommandOptions,
): Promise<ReviewCommandResult> {
  const { runId } = options;
  const { root, workspacePaths } = await resolveCliContext();

  const execution = await executeReviewCommand({
    root,
    runsFilePath: workspacePaths.runsFile,
    runId,
  });

  const body = renderReviewTranscript(execution.runRecord);

  return {
    ...execution,
    body,
  };
}

interface ReviewCommandActionOptions {
  run: string;
}

export function createReviewCommand(): Command {
  return new Command("review")
    .description("Summarize artifacts from a completed run")
    .requiredOption("--run <run-id>", "Identifier of the recorded run")
    .allowExcessArguments(false)
    .action(async (options: ReviewCommandActionOptions) => {
      const result = await runReviewCommand({ runId: options.run });

      writeCommandOutput({
        body: result.body,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    });
}
