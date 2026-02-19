import { dirname, join } from "node:path";

import { Command } from "commander";

import {
  readReviewRecommendation,
  type ReviewRecommendation,
} from "../commands/review/recommendation.js";
import { resolveCliContext } from "../preflight/index.js";
import { renderAutoSummaryTranscript } from "../render/transcripts/auto.js";
import { renderCliError } from "../render/utils/errors.js";
import { readReviewRecords } from "../reviews/records/persistence.js";
import type { RunStatus } from "../status/index.js";
import { normalizePathForDisplay, resolveDisplayPath } from "../utils/path.js";
import { parsePositiveInteger } from "../utils/validators.js";
import { REVIEW_RECOMMENDATION_FILENAME } from "../workspace/structure.js";
import { runApplyCommand } from "./apply.js";
import { CliError, toCliError } from "./errors.js";
import { beginChainedCommandOutput, writeCommandOutput } from "./output.js";
import { runReviewCommand } from "./review.js";
import { runRunCommand } from "./run.js";

export interface AutoCommandOptions {
  specPath: string;
  runAgentIds?: readonly string[];
  reviewerAgent?: string;
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

function assertAutoOptionCompatibility(options: AutoCommandOptions): void {
  if (options.commit && !options.apply) {
    throw new CliError(
      "Option `--commit` requires `--apply`.",
      [],
      [
        "Re-run with `--apply --commit`, or omit `--commit` to keep apply disabled.",
      ],
    );
  }
}

interface AutoRecommendationLoadResult {
  recommendationPath: string;
  preferredAgents: readonly string[];
}

async function loadAutoRecommendation(options: {
  reviewOutputPath: string;
  runId: string;
}): Promise<AutoRecommendationLoadResult> {
  const recommendationPath = normalizePathForDisplay(
    join(dirname(options.reviewOutputPath), REVIEW_RECOMMENDATION_FILENAME),
  );
  let resolutionRoot = process.cwd();
  let reviewsFilePath = join(
    resolutionRoot,
    ".voratiq",
    "reviews",
    "index.json",
  );
  try {
    const { root, workspacePaths } = await resolveCliContext();
    resolutionRoot = root;
    reviewsFilePath = workspacePaths.reviewsFile;
  } catch {
    // Unit tests and non-repo contexts may not resolve CLI root.
    // Fall back to cwd for compatibility.
  }
  const recommendationAbsolutePath =
    resolveDisplayPath(resolutionRoot, recommendationPath) ??
    recommendationPath;

  try {
    const recommendation = await readReviewRecommendation(
      recommendationAbsolutePath,
    );
    const preferredAgents = await resolvePreferredAgentsForAuto({
      recommendation,
      reviewOutputPath: options.reviewOutputPath,
      root: resolutionRoot,
      reviewsFilePath,
    });
    return {
      recommendationPath,
      preferredAgents,
    };
  } catch (error) {
    throw new CliError(
      "Failed to load structured review recommendation.",
      [
        `Expected ${REVIEW_RECOMMENDATION_FILENAME} at ${recommendationPath}.`,
        toCliError(error).headline,
      ],
      [
        `Re-run review to regenerate artifacts: voratiq review --run ${options.runId} --agent <agent-id>`,
      ],
    );
  }
}

async function resolvePreferredAgentsForAuto(options: {
  recommendation: ReviewRecommendation;
  reviewOutputPath: string;
  root: string;
  reviewsFilePath: string;
}): Promise<string[]> {
  const { recommendation, reviewOutputPath, root, reviewsFilePath } = options;
  if (recommendation.resolved_preferred_agents !== undefined) {
    return normalizeAgentSelectors(recommendation.resolved_preferred_agents);
  }

  const preferredAgents = normalizeAgentSelectors(
    recommendation.preferred_agents,
  );
  if (preferredAgents.length === 0) {
    return [];
  }

  const aliasMap = await readReviewAliasMap({
    reviewOutputPath,
    root,
    reviewsFilePath,
  });
  if (!aliasMap) {
    return preferredAgents;
  }

  return normalizeAgentSelectors(
    preferredAgents.map((agentId) => aliasMap[agentId] ?? agentId),
  );
}

async function readReviewAliasMap(options: {
  reviewOutputPath: string;
  root: string;
  reviewsFilePath: string;
}): Promise<Record<string, string> | undefined> {
  const { reviewOutputPath, root, reviewsFilePath } = options;
  const reviewId = extractReviewIdFromOutputPath(reviewOutputPath);
  if (!reviewId) {
    return undefined;
  }

  try {
    const records = await readReviewRecords({
      root,
      reviewsFilePath,
      limit: 1,
      predicate: (record) => record.sessionId === reviewId,
    });
    return records[0]?.blinded?.aliasMap;
  } catch {
    return undefined;
  }
}

function extractReviewIdFromOutputPath(
  reviewOutputPath: string,
): string | undefined {
  const segments = normalizePathForDisplay(reviewOutputPath).split("/");
  for (let index = 0; index < segments.length - 2; index += 1) {
    if (segments[index] === "reviews" && segments[index + 1] === "sessions") {
      const reviewId = segments[index + 2];
      return reviewId ? reviewId : undefined;
    }
  }
  return undefined;
}

function normalizeAgentSelectors(selectors: readonly string[]): string[] {
  return Array.from(
    new Set(selectors.map((selector) => selector.trim()).filter(Boolean)),
  );
}

function resolveRecommendedAgent(options: {
  runId: string;
  recommendationPath: string;
  preferredAgents: readonly string[];
  availableAgents: readonly string[];
}): string {
  const { runId, recommendationPath, preferredAgents, availableAgents } =
    options;

  const preferredUnique = normalizeAgentSelectors(preferredAgents);
  if (preferredUnique.length === 0) {
    throw new CliError(
      "Recommendation is missing a preferred agent.",
      [`No preferred agent is listed in ${recommendationPath}.`],
      [
        `Update ${recommendationPath} to include exactly one preferred agent or apply manually: voratiq apply --run ${runId} --agent <agent-id>`,
      ],
    );
  }

  const availableSet = new Set(availableAgents);
  const resolved = preferredUnique.filter((agentId) =>
    availableSet.has(agentId),
  );
  const resolvedUnique = Array.from(new Set(resolved));

  if (resolvedUnique.length === 0) {
    throw new CliError(
      "Recommendation did not match any run agent.",
      [
        `Preferred agents: ${preferredUnique.join(", ")}`,
        `Available agents: ${availableAgents.join(", ") || "(none recorded)"}`,
      ],
      [
        `Review ${recommendationPath} and rerun auto apply, or apply manually: voratiq apply --run ${runId} --agent <agent-id>`,
      ],
    );
  }

  if (resolvedUnique.length > 1) {
    throw new CliError(
      "Recommendation is ambiguous; exactly one agent is required for auto apply.",
      [
        `Matched agents: ${resolvedUnique.join(", ")}`,
        `Source: ${recommendationPath}`,
      ],
      [
        `Keep exactly one preferred agent in ${recommendationPath}, or apply manually: voratiq apply --run ${runId} --agent <agent-id>`,
      ],
    );
  }

  return resolvedUnique[0];
}

export async function runAutoCommand(
  options: AutoCommandOptions,
  runtime: AutoRuntimeOptions = {},
): Promise<AutoCommandResult> {
  assertAutoOptionCompatibility(options);

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
    let runAgentIds: string[] = [];

    let reviewStartedAt: number | undefined;
    let reviewStatus: "succeeded" | "failed" | "skipped" = "skipped";
    let reviewOutputPath: string | undefined;
    let reviewDetail: string | undefined;

    let applyStartedAt: number | undefined;
    let applyStatus: "succeeded" | "failed" | "skipped" = "skipped";
    let applyAgentId: string | undefined;
    let applyDetail: string | undefined;

    runStartedAt = now();

    try {
      // For non-TTY, suppress run renderer blank lines and let the chained
      // output system handle spacing. For TTY, let the run renderer handle
      // its own spacing since cursor control requires precise line counts.
      const suppressBlankLines = !process.stdout.isTTY;
      const runResult = await runRunCommand({
        specPath: options.specPath,
        agentIds: options.runAgentIds ? [...options.runAgentIds] : undefined,
        agentOverrideFlag: "--run-agent",
        profile: options.profile,
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
      runAgentIds = runResult.report.agents.map((agent) => agent.agentId);

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
            agentOverrideFlag: "--review-agent",
            profile: options.profile,
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

    if (
      options.apply &&
      runId &&
      reviewStatus === "succeeded" &&
      reviewOutputPath
    ) {
      applyStartedAt = now();
      try {
        const recommendationResult = await loadAutoRecommendation({
          reviewOutputPath,
          runId,
        });
        const recommendedAgentId = resolveRecommendedAgent({
          runId,
          recommendationPath: recommendationResult.recommendationPath,
          preferredAgents: recommendationResult.preferredAgents,
          availableAgents: runAgentIds,
        });

        const applyResult = await runApplyCommand({
          runId,
          agentId: recommendedAgentId,
          commit: options.commit ?? false,
        });

        applyStatus = "succeeded";
        applyAgentId = recommendedAgentId;

        writeCommandOutput({
          body: applyResult.body,
          exitCode: applyResult.exitCode,
        });
        if (applyResult.exitCode === 1) {
          exitCode = 1;
        }
      } catch (error) {
        applyStatus = "failed";
        applyDetail = toCliError(error).headline;
        exitCode = 1;
        writeCommandOutput({ body: renderCliError(toCliError(error)) });
      }
    }

    const overallDurationMs = now() - overallStart;
    const runDurationMs =
      runStartedAt !== undefined ? now() - runStartedAt : undefined;
    const reviewDurationMs =
      reviewStartedAt !== undefined ? now() - reviewStartedAt : undefined;
    const applyDurationMs =
      applyStartedAt !== undefined ? now() - applyStartedAt : undefined;

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
      ...(options.apply
        ? {
            apply: {
              status: applyStatus,
              ...(typeof applyDurationMs === "number"
                ? { durationMs: applyDurationMs }
                : {}),
              ...(applyAgentId ? { agentId: applyAgentId } : {}),
              ...(applyDetail ? { detail: applyDetail } : {}),
            },
          }
        : {}),
    });

    writeCommandOutput({
      body: summaryBody,
      exitCode,
    });

    return {
      exitCode,
      runId,
      reviewOutputPath,
      ...(applyAgentId ? { appliedAgentId: applyAgentId } : {}),
    };
  } finally {
    chainedOutput.end();
  }
}

interface AutoCommandActionOptions {
  spec?: string;
  runAgent?: string[];
  reviewAgent?: string;
  profile?: string;
  maxParallel?: number;
  branch?: boolean;
  apply?: boolean;
  commit?: boolean;
}

export function createAutoCommand(): Command {
  return new Command("auto")
    .description("Run agents and review results from an existing spec")
    .requiredOption(
      "--spec <path>",
      "Path to an existing spec file to run and review",
    )
    .option(
      "--run-agent <agent-id>",
      "Run-stage agent override (repeatable; preserves CLI order; overrides orchestration stage config)",
      collectRunAgentOption,
      [],
    )
    .option(
      "--review-agent <agent-id>",
      "Reviewer agent identifier override (overrides orchestration stage config)",
    )
    .option("--profile <name>", 'Orchestration profile (default: "default")')
    .option(
      "--max-parallel <count>",
      "Maximum number of agents to run concurrently",
      parseMaxParallelOption,
    )
    .option("--branch", "Checkout or create a branch named after the spec file")
    .option(
      "--apply",
      "Apply the structured review recommendation after review completes",
      () => true,
    )
    .option(
      "--commit",
      "When applying, commit immediately using `voratiq apply --commit` behavior",
      () => true,
    )
    .addHelpText(
      "after",
      [
        "",
        "Agent resolution precedence (per stage):",
        "  1) CLI override flag",
        "  2) orchestration profile stage config (.voratiq/orchestration.yaml)",
        "  3) fail fast (no implicit fallback)",
      ].join("\n"),
    )
    .allowExcessArguments(false)
    .action(async (options: AutoCommandActionOptions) => {
      await runAutoCommand({
        specPath: options.spec!,
        runAgentIds: options.runAgent,
        reviewerAgent: options.reviewAgent,
        profile: options.profile,
        maxParallel: options.maxParallel,
        branch: options.branch,
        apply: options.apply ?? false,
        commit: options.commit ?? false,
      });
    });
}
