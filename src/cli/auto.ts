import { Command } from "commander";

import { renderAutoSummaryTranscript } from "../render/transcripts/auto.js";
import { renderCliError } from "../render/utils/errors.js";
import type { RunStatus } from "../status/index.js";
import { parsePositiveInteger } from "../utils/validators.js";
import { toCliError } from "./errors.js";
import { beginChainedCommandOutput, writeCommandOutput } from "./output.js";
import { runReviewCommand } from "./review.js";
import { runRunCommand } from "./run.js";

export interface AutoCommandOptions {
  specPath: string;
  reviewerAgent: string;
  maxParallel?: number;
  branch?: boolean;
}

export interface AutoCommandResult {
  exitCode: number;
  runId?: string;
  reviewOutputPath?: string;
}

interface AutoRuntimeOptions {
  now?: () => number;
}

function parseMaxParallelOption(value: string): number {
  return parsePositiveInteger(
    value,
    "Expected positive integer after --max-parallel",
    "--max-parallel must be greater than 0",
  );
}

export async function runAutoCommand(
  options: AutoCommandOptions,
  runtime: AutoRuntimeOptions = {},
): Promise<AutoCommandResult> {
  const now = runtime.now ?? Date.now.bind(Date);

  const overallStart = now();
  const chainedOutput = beginChainedCommandOutput();

  try {
    let exitCode = 0;

    let runStartedAt: number | undefined;
    let runStatus: "succeeded" | "failed" | "skipped" = "skipped";
    let runId: string | undefined;
    let runDetail: string | undefined;
    let runRecordStatus: RunStatus | undefined;
    let runCreatedAt: string | undefined;
    let runSpecPath: string | undefined;
    let runBaseRevisionSha: string | undefined;

    let reviewStartedAt: number | undefined;
    let reviewStatus: "succeeded" | "failed" | "skipped" = "skipped";
    let reviewOutputPath: string | undefined;
    let reviewDetail: string | undefined;

    runStartedAt = now();

    try {
      // For non-TTY, suppress run renderer blank lines and let the chained
      // output system handle spacing. For TTY, let the run renderer handle
      // its own spacing since cursor control requires precise line counts.
      const suppressBlankLines = !process.stdout.isTTY;
      const runResult = await runRunCommand({
        specPath: options.specPath,
        maxParallel: options.maxParallel,
        branch: options.branch,
        suppressHint: true,
        suppressLeadingBlankLine: suppressBlankLines,
        suppressTrailingBlankLine: suppressBlankLines,
        stdout: chainedOutput.stdout,
        stderr: chainedOutput.stderr,
      });

      runStatus = "succeeded";
      runId = runResult.report.runId;
      runRecordStatus = runResult.report.status;
      runCreatedAt = runResult.report.createdAt;
      runSpecPath = runResult.report.spec?.path;
      runBaseRevisionSha = runResult.report.baseRevisionSha;

      if (runResult.exitCode === 1) {
        exitCode = 1;
      }

      writeCommandOutput({ body: runResult.body });
    } catch (error) {
      runStatus = "failed";
      runDetail = toCliError(error).headline;
      exitCode = 1;
      writeCommandOutput({ body: renderCliError(toCliError(error)) });
    }

    if (exitCode === 0 || runId) {
      if (!runId) {
        reviewStatus = "skipped";
      } else {
        reviewStartedAt = now();

        try {
          const reviewResult = await runReviewCommand({
            runId,
            agentId: options.reviewerAgent,
            suppressHint: true,
          });

          reviewStatus = "succeeded";
          reviewOutputPath = reviewResult.outputPath;

          writeCommandOutput({
            body: reviewResult.body,
            stderr: reviewResult.stderr,
          });
        } catch (error) {
          reviewStatus = "failed";
          reviewDetail = toCliError(error).headline;
          exitCode = 1;
          writeCommandOutput({ body: renderCliError(toCliError(error)) });
        }
      }
    }

    const overallDurationMs = now() - overallStart;
    const runDurationMs =
      runStartedAt !== undefined ? now() - runStartedAt : undefined;
    const reviewDurationMs =
      reviewStartedAt !== undefined ? now() - reviewStartedAt : undefined;

    const summaryBody = renderAutoSummaryTranscript({
      totalDurationMs: overallDurationMs,
      run: {
        status: runStatus,
        ...(typeof runDurationMs === "number"
          ? { durationMs: runDurationMs }
          : {}),
        ...(runId ? { runId } : {}),
        ...(runRecordStatus ? { runStatus: runRecordStatus } : {}),
        ...(runCreatedAt ? { createdAt: runCreatedAt } : {}),
        ...(runSpecPath ? { specPath: runSpecPath } : {}),
        ...(runBaseRevisionSha ? { baseRevisionSha: runBaseRevisionSha } : {}),
        ...(runDetail ? { detail: runDetail } : {}),
      },
      review: {
        status: reviewStatus,
        ...(typeof reviewDurationMs === "number"
          ? { durationMs: reviewDurationMs }
          : {}),
        ...(reviewOutputPath ? { outputPath: reviewOutputPath } : {}),
        ...(reviewDetail ? { detail: reviewDetail } : {}),
      },
    });

    writeCommandOutput({
      body: summaryBody,
      exitCode,
    });

    return {
      exitCode,
      runId,
      reviewOutputPath,
    };
  } finally {
    chainedOutput.end();
  }
}

interface AutoCommandActionOptions {
  spec?: string;
  reviewAgent: string;
  maxParallel?: number;
  branch?: boolean;
}

export function createAutoCommand(): Command {
  return new Command("auto")
    .description("Run agents and review results from an existing spec")
    .requiredOption(
      "--spec <path>",
      "Path to an existing spec file to run and review",
    )
    .requiredOption("--review-agent <agent-id>", "Reviewer agent identifier")
    .option(
      "--max-parallel <count>",
      "Maximum number of agents to run concurrently",
      parseMaxParallelOption,
    )
    .option("--branch", "Checkout or create a branch named after the spec file")
    .allowExcessArguments(false)
    .action(async (options: AutoCommandActionOptions) => {
      await runAutoCommand({
        specPath: options.spec!,
        reviewerAgent: options.reviewAgent,
        maxParallel: options.maxParallel,
        branch: options.branch,
      });
    });
}
