import { Command, Option } from "commander";

import { renderAutoSummaryTranscript } from "../render/transcripts/auto.js";
import { renderCliError } from "../render/utils/errors.js";
import type { RunStatus } from "../status/index.js";
import { parsePositiveInteger } from "../utils/validators.js";
import { toCliError } from "./errors.js";
import { writeCommandOutput } from "./output.js";
import { runReviewCommand } from "./review.js";
import { runRunCommand } from "./run.js";
import { runSpecCommand } from "./spec.js";

export interface AutoCommandOptions {
  description?: string;
  specPath?: string;
  specAgent?: string;
  title?: string;
  output?: string;
  reviewerAgent: string;
  maxParallel?: number;
  branch?: boolean;
}

export interface AutoCommandResult {
  exitCode: number;
  specOutputPath?: string;
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

  let exitCode = 0;

  let specStartedAt: number | undefined;
  let specStatus: "succeeded" | "failed" | "skipped" = "skipped";
  let specOutputPath: string | undefined;
  let specDetail: string | undefined;

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

  if (options.description) {
    specStartedAt = now();

    try {
      if (!options.specAgent) {
        throw new Error(
          "Expected --spec-agent when --description is provided.",
        );
      }

      const specResult = await runSpecCommand({
        description: options.description,
        agent: options.specAgent,
        title: options.title,
        output: options.output,
        yes: true,
        suppressHint: true,
      });

      specStatus = "succeeded";
      specOutputPath = specResult.outputPath;

      writeCommandOutput({ body: specResult.body });
    } catch (error) {
      specStatus = "failed";
      specDetail = toCliError(error).headline;
      exitCode = 1;
      writeCommandOutput({
        body: renderCliError(toCliError(error)),
        formatBody: { leadingNewline: false },
      });
    }
  } else if (options.specPath) {
    specStatus = "skipped";
    specOutputPath = options.specPath;
  } else {
    specStatus = "failed";
    specDetail = "Either --description or --spec must be provided.";
    exitCode = 1;
    writeCommandOutput({
      body: renderCliError(toCliError(new Error(specDetail))),
      formatBody: { leadingNewline: false },
    });
  }

  if (exitCode === 0 && specOutputPath) {
    runStartedAt = now();

    try {
      const runResult = await runRunCommand({
        specPath: specOutputPath,
        maxParallel: options.maxParallel,
        branch: options.branch,
        suppressHint: true,
        suppressLeadingBlankLine: true,
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

      writeCommandOutput({
        body: runResult.body,
        formatBody: { leadingNewline: false, trailingNewline: false },
      });
    } catch (error) {
      runStatus = "failed";
      runDetail = toCliError(error).headline;
      exitCode = 1;
      writeCommandOutput({
        body: renderCliError(toCliError(error)),
        formatBody: { leadingNewline: false },
      });
    }
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
        writeCommandOutput({
          body: renderCliError(toCliError(error)),
          formatBody: { leadingNewline: false },
        });
      }
    }
  }

  const overallDurationMs = now() - overallStart;
  const specDurationMs =
    specStartedAt !== undefined ? now() - specStartedAt : undefined;
  const runDurationMs =
    runStartedAt !== undefined ? now() - runStartedAt : undefined;
  const reviewDurationMs =
    reviewStartedAt !== undefined ? now() - reviewStartedAt : undefined;

  const summaryBody = renderAutoSummaryTranscript({
    totalDurationMs: overallDurationMs,
    spec: {
      status: specStatus,
      ...(typeof specDurationMs === "number"
        ? { durationMs: specDurationMs }
        : {}),
      outputPath: specOutputPath,
      ...(specDetail ? { detail: specDetail } : {}),
    },
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
    formatBody: { leadingNewline: false },
  });

  return {
    exitCode,
    specOutputPath,
    runId,
    reviewOutputPath,
  };
}

interface AutoCommandActionOptions {
  description?: string;
  spec?: string;
  specAgent?: string;
  title?: string;
  output?: string;
  reviewAgent: string;
  maxParallel?: number;
  branch?: boolean;
}

export function createAutoCommand(): Command {
  return new Command("auto")
    .description(
      "Generate a spec, run agents, and review results in one command",
    )
    .addOption(
      new Option(
        "--description <text>",
        "Generate a spec from a description, then run and review",
      ).conflicts("spec"),
    )
    .addOption(
      new Option(
        "--spec <path>",
        "Use an existing spec path, then run and review",
      ).conflicts("description"),
    )
    .requiredOption("--review-agent <agent-id>", "Reviewer agent identifier")
    .option("--spec-agent <agent-id>", "Spec generator agent identifier")
    .option("--title <text>", "Optional spec title (description mode only)")
    .option(
      "--output <path>",
      "Optional spec output path within .voratiq/specs/ (description mode only)",
    )
    .option(
      "--max-parallel <count>",
      "Maximum number of agents to run concurrently",
      parseMaxParallelOption,
    )
    .option("--branch", "Checkout or create a branch named after the spec file")
    .allowExcessArguments(false)
    .action(async (options: AutoCommandActionOptions, command: Command) => {
      const hasDescription =
        typeof options.description === "string" &&
        options.description.length > 0;
      const hasSpec =
        typeof options.spec === "string" && options.spec.length > 0;

      if (!hasDescription && !hasSpec) {
        command.error(
          "error: either --description <text> or --spec <path> must be provided",
          {
            exitCode: 1,
          },
        );
      }

      if (
        hasDescription &&
        (!options.specAgent || options.specAgent.length === 0)
      ) {
        command.error(
          "error: --spec-agent <agent-id> is required with --description",
          {
            exitCode: 1,
          },
        );
      }

      if (hasSpec && (options.specAgent || options.title || options.output)) {
        command.error(
          "error: --spec-agent/--title/--output are only valid with --description",
          { exitCode: 1 },
        );
      }

      await runAutoCommand({
        description: options.description,
        specPath: options.spec,
        specAgent: options.specAgent,
        title: options.title,
        output: options.output,
        reviewerAgent: options.reviewAgent,
        maxParallel: options.maxParallel,
        branch: options.branch,
      });
    });
}
