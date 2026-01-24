import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Command } from "commander";

import { checkPlatformSupport } from "../agents/runtime/sandbox.js";
import {
  executeReviewCommand,
  type ReviewCommandResult as ReviewExecutionResult,
} from "../commands/review/command.js";
import { buildMarkdownPreviewLines } from "../commands/shared/preview.js";
import {
  ensureSandboxDependencies,
  resolveCliContext,
} from "../preflight/index.js";
import { renderReviewTranscript } from "../render/transcripts/review.js";
import { writeCommandOutput } from "./output.js";

export interface ReviewCommandOptions {
  runId: string;
  agentId: string;
  suppressHint?: boolean;
}

export interface ReviewCommandResult extends ReviewExecutionResult {
  body: string;
  stderr?: string;
  exitCode?: number;
}

export async function runReviewCommand(
  options: ReviewCommandOptions,
): Promise<ReviewCommandResult> {
  const { runId, agentId, suppressHint } = options;
  const { root, workspacePaths } = await resolveCliContext();
  checkPlatformSupport();
  ensureSandboxDependencies();

  writeCommandOutput({
    alerts: [{ severity: "info", message: "Generating review..." }],
  });

  const execution = await executeReviewCommand({
    root,
    runsFilePath: workspacePaths.runsFile,
    reviewsFilePath: workspacePaths.reviewsFile,
    runId,
    agentId,
  });

  let previewLines: string[] | undefined;
  try {
    const reviewContent = await readFile(
      resolve(root, execution.outputPath),
      "utf8",
    );
    previewLines = buildMarkdownPreviewLines(reviewContent);
  } catch {
    previewLines = undefined;
  }

  const body = renderReviewTranscript({
    runId: execution.runRecord.runId,
    outputPath: execution.outputPath,
    previewLines,
    suppressHint,
    ...(execution.missingArtifacts.length > 0
      ? { missingArtifacts: execution.missingArtifacts }
      : {}),
  });

  return {
    ...execution,
    body,
  };
}

interface ReviewCommandActionOptions {
  run: string;
  agent: string;
}

export function createReviewCommand(): Command {
  return new Command("review")
    .description("Generate a one-shot, headless review of run artifacts")
    .requiredOption("--run <run-id>", "Identifier of the recorded run")
    .requiredOption("--agent <agent-id>", "Reviewer agent identifier")
    .allowExcessArguments(false)
    .action(async (options: ReviewCommandActionOptions) => {
      const result = await runReviewCommand({
        runId: options.run,
        agentId: options.agent,
      });

      writeCommandOutput({
        body: result.body,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    });
}
