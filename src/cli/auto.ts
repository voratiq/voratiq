import { dirname, join } from "node:path";

import { Command, Option } from "commander";

import {
  type AutoCommandDependencies,
  type AutoCommandEvent,
  type AutoReviewStageReview,
  executeAutoCommand,
} from "../commands/auto/command.js";
import { readReviewRecommendation } from "../domains/reviews/competition/recommendation.js";
import { readReviewRecords } from "../domains/reviews/persistence/adapter.js";
import type {
  AutoApplyStatus,
  AutoTerminalStatus,
  RunAutoOutcome,
} from "../domains/runs/model/types.js";
import { rewriteRunRecord } from "../domains/runs/persistence/adapter.js";
import { type ReviewSelectionInput } from "../policy/index.js";
import { resolveCliContext } from "../preflight/index.js";
import { renderAutoSummaryTranscript } from "../render/transcripts/auto.js";
import { renderCliError } from "../render/utils/errors.js";
import { formatAlertMessage } from "../utils/output.js";
import { normalizePathForDisplay, resolveDisplayPath } from "../utils/path.js";
import { parsePositiveInteger } from "../utils/validators.js";
import { REVIEW_RECOMMENDATION_FILENAME } from "../workspace/structure.js";
import { runApplyCommand } from "./apply.js";
import { CliError, toCliError } from "./errors.js";
import { beginChainedCommandOutput, writeCommandOutput } from "./output.js";
import { runReviewCommand } from "./review.js";
import { runRunCommand } from "./run.js";
import { runSpecCommand } from "./spec.js";

export interface AutoCommandOptions {
  specPath?: string;
  description?: string;
  runAgentIds?: readonly string[];
  reviewerAgentIds?: readonly string[];
  profile?: string;
  maxParallel?: number;
  branch?: boolean;
  apply?: boolean;
  commit?: boolean;
}

export interface AutoCommandResult {
  exitCode: number;
  runId?: string;
  reviewOutputPath?: string;
  appliedAgentId?: string;
  auto: {
    status: AutoTerminalStatus;
    detail?: string;
  };
  apply: {
    status: AutoApplyStatus;
    detail?: string;
  };
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

function collectRunAgentOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function collectReviewAgentOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function loadAutoRecommendation(options: {
  reviewOutputPath: string;
  resolutionRoot: string;
}): Promise<{
  preferredCandidateId: string;
  resolvedPreferredCandidateId?: string;
}> {
  const recommendationPath = normalizePathForDisplay(
    join(dirname(options.reviewOutputPath), REVIEW_RECOMMENDATION_FILENAME),
  );
  const recommendationAbsolutePath =
    resolveDisplayPath(options.resolutionRoot, recommendationPath) ??
    recommendationPath;

  try {
    const recommendation = await readReviewRecommendation(
      recommendationAbsolutePath,
    );
    return {
      preferredCandidateId: recommendation.preferred_agent,
      resolvedPreferredCandidateId:
        recommendation.resolved_preferred_agent?.trim() || undefined,
    };
  } catch (error) {
    throw new CliError(
      `Failed to load \`${REVIEW_RECOMMENDATION_FILENAME}\`.`,
      [toCliError(error).headline],
      ["Re-run `voratiq review` to regenerate review artifacts."],
    );
  }
}

async function loadReviewSelectionInputForAuto(options: {
  reviewId: string;
  reviews: readonly AutoReviewStageReview[];
  availableAgents: readonly string[];
}): Promise<ReviewSelectionInput> {
  let resolutionRoot = process.cwd();
  let reviewsFilePath: string | undefined;
  try {
    const { root, workspacePaths } = await resolveCliContext();
    resolutionRoot = root;
    reviewsFilePath = workspacePaths.reviewsFile;
  } catch {
    // Unit tests and non-repo contexts may not resolve CLI root.
    // Fall back to cwd for compatibility.
  }

  const persistedRecord = reviewsFilePath
    ? (
        await readReviewRecords({
          root: resolutionRoot,
          reviewsFilePath,
          limit: 1,
          predicate: (record) => record.sessionId === options.reviewId,
        }).catch(() => [])
      )[0]
    : undefined;

  const reviewerArtifacts = persistedRecord
    ? persistedRecord.reviewers.map((reviewer) => ({
        reviewerAgentId: reviewer.agentId,
        status: reviewer.status === "succeeded" ? "succeeded" : "failed",
        outputPath: reviewer.outputPath,
      }))
    : options.reviews.map((review) => ({
        reviewerAgentId: review.agentId,
        status: review.status,
        outputPath: review.outputPath,
      }));

  const reviewers = await Promise.all(
    reviewerArtifacts.map(async (review) => {
      if (review.status !== "succeeded") {
        return {
          reviewerAgentId: review.reviewerAgentId,
          status: "failed" as const,
        };
      }

      const recommendation = await loadAutoRecommendation({
        reviewOutputPath: review.outputPath,
        resolutionRoot,
      });
      return {
        reviewerAgentId: review.reviewerAgentId,
        status: "succeeded" as const,
        preferredCandidateId: recommendation.preferredCandidateId,
        resolvedPreferredCandidateId:
          recommendation.resolvedPreferredCandidateId,
      };
    }),
  );

  return {
    canonicalAgentIds: [...options.availableAgents],
    ...(persistedRecord?.blinded?.aliasMap
      ? { aliasMap: persistedRecord.blinded.aliasMap }
      : {}),
    reviewers,
  };
}

function replayAutoCommandEvent(event: AutoCommandEvent): void {
  if (event.kind === "body") {
    writeCommandOutput({
      body: event.body,
      stderr: event.stderr,
      exitCode: event.exitCode,
    });
    return;
  }

  if (event.kind === "error") {
    writeCommandOutput({ body: renderCliError(toCliError(event.error)) });
    return;
  }

  const warningBody = formatAlertMessage(
    "Action required",
    "yellow",
    event.message,
  );
  writeCommandOutput({
    body: event.separateWithDivider ? `---\n\n${warningBody}` : warningBody,
  });
}

async function persistAutoOutcome(options: {
  runId?: string;
  outcome: RunAutoOutcome;
}): Promise<void> {
  const { runId, outcome } = options;
  if (!runId) {
    return;
  }

  try {
    const { root, workspacePaths } = await resolveCliContext();
    await rewriteRunRecord({
      root,
      runsFilePath: workspacePaths.runsFile,
      runId,
      mutate: (record) => ({
        ...record,
        auto: outcome,
      }),
      forceFlush: true,
    });
  } catch {
    // Keep auto command behavior resilient in unit tests and non-standard
    // harnesses where run records may be mocked or unavailable.
  }
}

export async function runAutoCommand(
  options: AutoCommandOptions,
  runtime: AutoRuntimeOptions = {},
): Promise<AutoCommandResult> {
  const now = runtime.now ?? Date.now.bind(Date);
  const chainedOutput = beginChainedCommandOutput();

  try {
    const dependencies: AutoCommandDependencies = {
      now,
      onEvent: replayAutoCommandEvent,
      runSpecStage: async (input) =>
        runSpecCommand({
          description: input.description,
          profile: input.profile,
          maxParallel: input.maxParallel,
          suppressHint: input.suppressHint,
          writeOutput: writeCommandOutput,
        }),
      runRunStage: async (input) => {
        const suppressBlankLines = !process.stdout.isTTY;
        return runRunCommand({
          specPath: input.specPath,
          agentIds: input.agentIds ? [...input.agentIds] : undefined,
          agentOverrideFlag: input.agentOverrideFlag,
          profile: input.profile,
          maxParallel: input.maxParallel,
          branch: input.branch,
          writeOutput: writeCommandOutput,
          suppressHint: true,
          suppressLeadingBlankLine: suppressBlankLines,
          suppressTrailingBlankLine: suppressBlankLines,
          stdout: chainedOutput.stdout,
          stderr: chainedOutput.stderr,
        });
      },
      runReviewStage: async (input) =>
        runReviewCommand({
          runId: input.runId,
          agentIds: input.agentIds ? [...input.agentIds] : undefined,
          agentOverrideFlag: input.agentOverrideFlag,
          profile: input.profile,
          maxParallel: input.maxParallel,
          suppressHint: input.suppressHint,
          stdout: chainedOutput.stdout,
          stderr: chainedOutput.stderr,
          suppressLeadingBlankLine: !process.stdout.isTTY,
          suppressTrailingBlankLine: !process.stdout.isTTY,
        }),
      runApplyStage: async (input) =>
        runApplyCommand({
          runId: input.runId,
          agentId: input.agentId,
          commit: input.commit,
        }),
      loadReviewSelectionInput: loadReviewSelectionInputForAuto,
    };

    const execution = await executeAutoCommand(options, dependencies);

    const autoOutcome: RunAutoOutcome = {
      status: execution.auto.status,
      completedAt: new Date(now()).toISOString(),
      ...(execution.auto.detail ? { detail: execution.auto.detail } : {}),
      apply: {
        status: execution.apply.status,
        ...(execution.appliedAgentId
          ? { agentId: execution.appliedAgentId }
          : {}),
        ...(execution.apply.detail ? { detail: execution.apply.detail } : {}),
      },
    };

    await persistAutoOutcome({
      runId: execution.runId,
      outcome: autoOutcome,
    });

    writeCommandOutput({
      body: renderAutoSummaryTranscript(execution.summary),
      exitCode: execution.exitCode,
    });

    return {
      exitCode: execution.exitCode,
      runId: execution.runId,
      reviewOutputPath: execution.reviewOutputPath,
      ...(execution.appliedAgentId
        ? { appliedAgentId: execution.appliedAgentId }
        : {}),
      auto: execution.auto,
      apply: execution.apply,
    };
  } finally {
    chainedOutput.end();
  }
}

interface AutoCommandActionOptions {
  spec?: string;
  description?: string;
  runAgent?: string[];
  reviewAgent?: string[];
  profile?: string;
  maxParallel?: number;
  branch?: boolean;
  apply?: boolean;
  commit?: boolean;
}

export function createAutoCommand(): Command {
  return new Command("auto")
    .description("Run spec, run, review, and apply as one command")
    .option("--spec <path>", "Existing spec to run")
    .option("--description <text>", "Generate a spec, then run and review it")
    .addOption(
      new Option(
        "--run-agent <agent-id>",
        "Set run-stage agents directly (repeatable; order preserved)",
      )
        .default([], "")
        .argParser(collectRunAgentOption),
    )
    .addOption(
      new Option(
        "--review-agent <agent-id>",
        "Set review-stage agents directly (repeatable)",
      )
        .default([], "")
        .argParser(collectReviewAgentOption),
    )
    .option("--profile <name>", 'Orchestration profile (default: "default")')
    .option(
      "--max-parallel <count>",
      "Max concurrent agents/reviewers",
      parseMaxParallelOption,
    )
    .option("--branch", "Create or checkout a branch named after the spec")
    .option(
      "--apply",
      "Apply the recommended candidate after review",
      () => true,
    )
    .option("--commit", "Commit after apply (requires --apply)", () => true)
    .allowExcessArguments(false)
    .action(async (options: AutoCommandActionOptions) => {
      await runAutoCommand({
        specPath: options.spec,
        description: options.description,
        runAgentIds: options.runAgent,
        reviewerAgentIds: options.reviewAgent,
        profile: options.profile,
        maxParallel: options.maxParallel,
        branch: options.branch,
        apply: options.apply ?? false,
        commit: options.commit ?? false,
      });
    });
}
