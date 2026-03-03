import { dirname, join } from "node:path";

import { Command, Option } from "commander";

import {
  readReviewRecommendation,
  type ReviewRecommendation,
} from "../commands/review/recommendation.js";
import { resolveCliContext } from "../preflight/index.js";
import { renderAutoSummaryTranscript } from "../render/transcripts/auto.js";
import { renderCliError } from "../render/utils/errors.js";
import { rewriteRunRecord } from "../runs/records/persistence.js";
import type {
  AutoApplyStatus,
  AutoTerminalStatus,
  RunAutoOutcome,
} from "../runs/records/types.js";
import type { RunStatus } from "../status/index.js";
import { formatAlertMessage } from "../utils/output.js";
import { normalizePathForDisplay, resolveDisplayPath } from "../utils/path.js";
import { parsePositiveInteger } from "../utils/validators.js";
import { REVIEW_RECOMMENDATION_FILENAME } from "../workspace/structure.js";
import { runApplyCommand } from "./apply.js";
import { CliError, toCliError } from "./errors.js";
import { beginChainedCommandOutput, writeCommandOutput } from "./output.js";
import { type ReviewCommandResult, runReviewCommand } from "./review.js";
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

function assertAutoOptionCompatibility(options: AutoCommandOptions): void {
  const hasSpecPath =
    typeof options.specPath === "string" && options.specPath.trim().length > 0;
  const hasDescription =
    typeof options.description === "string" &&
    options.description.trim().length > 0;

  if (hasSpecPath === hasDescription) {
    throw new CliError(
      "Exactly one of `--spec` or `--description` is required.",
      [],
      ["Pass one flag, not both (or neither)."],
    );
  }

  if (options.commit && !options.apply) {
    throw new CliError(
      "Option `--commit` requires `--apply`.",
      [],
      ["Add `--apply` when using `--commit`."],
    );
  }
}

interface AutoRecommendationLoadResult {
  recommendationPath: string;
  preferredAgent?: string;
}

interface ReviewerRecommendation extends AutoRecommendationLoadResult {
  reviewerAgentId: string;
}

async function loadAutoRecommendation(options: {
  reviewOutputPath: string;
}): Promise<AutoRecommendationLoadResult> {
  const recommendationPath = normalizePathForDisplay(
    join(dirname(options.reviewOutputPath), REVIEW_RECOMMENDATION_FILENAME),
  );
  let resolutionRoot = process.cwd();
  try {
    const { root } = await resolveCliContext();
    resolutionRoot = root;
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
    const preferredAgent = resolvePreferredAgentForAuto({ recommendation });
    return {
      recommendationPath,
      preferredAgent,
    };
  } catch (error) {
    throw new CliError(
      `Failed to load \`${REVIEW_RECOMMENDATION_FILENAME}\`.`,
      [toCliError(error).headline],
      ["Re-run `voratiq review` to regenerate review artifacts."],
    );
  }
}

async function loadReviewerRecommendationsForAuto(options: {
  reviews: ReviewCommandResult["reviews"];
}): Promise<ReviewerRecommendation[]> {
  const successfulReviews = options.reviews.filter(
    (
      review,
    ): review is (typeof options.reviews)[number] & {
      status: "succeeded";
    } => review.status === "succeeded",
  );

  return Promise.all(
    successfulReviews.map(async (review) => {
      const recommendation = await loadAutoRecommendation({
        reviewOutputPath: review.outputPath,
      });
      return {
        reviewerAgentId: review.agentId,
        recommendationPath: recommendation.recommendationPath,
        preferredAgent: recommendation.preferredAgent,
      };
    }),
  );
}

function resolvePreferredAgentForAuto(options: {
  recommendation: ReviewRecommendation;
}): string | undefined {
  const { recommendation } = options;
  const resolvedPreferredAgent =
    recommendation.resolved_preferred_agent?.trim();
  return resolvedPreferredAgent && resolvedPreferredAgent.length > 0
    ? resolvedPreferredAgent
    : undefined;
}

function resolveRecommendedAgent(options: {
  recommendationPath: string;
  preferredAgent: string;
  availableAgents: readonly string[];
}): string {
  const { recommendationPath, preferredAgent, availableAgents } = options;

  const normalizedPreferredAgent = preferredAgent.trim();
  if (normalizedPreferredAgent.length === 0) {
    throw new CliError(
      `No preferred agent in \`${recommendationPath}\`.`,
      [],
      ["Re-run `voratiq review` to regenerate the recommendation."],
    );
  }

  const availableSet = new Set(availableAgents);
  if (!availableSet.has(normalizedPreferredAgent)) {
    const availableDisplay = availableAgents
      .map((agentId) => `\`${agentId}\``)
      .join(", ");
    throw new CliError(
      "Recommendation did not match any run agent.",
      [
        `Preferred agent: \`${normalizedPreferredAgent}\`.`,
        ...(availableDisplay.length > 0
          ? [`Available agents: ${availableDisplay}.`]
          : []),
      ],
      ["Use an agent id present in the run report or review output."],
    );
  }

  return normalizedPreferredAgent;
}

function resolveAutoTerminalStatus(options: {
  hardFailure: boolean;
  actionRequired: boolean;
}): AutoTerminalStatus {
  if (options.hardFailure) {
    return "failed";
  }
  if (options.actionRequired) {
    return "action_required";
  }
  return "succeeded";
}

function mapAutoTerminalStatusToExitCode(status: AutoTerminalStatus): number {
  return status === "succeeded" ? 0 : 1;
}

function truncateOutcomeDetail(detail?: string): string | undefined {
  if (!detail) {
    return undefined;
  }
  const trimmed = detail.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.length > 256 ? trimmed.slice(0, 256) : trimmed;
}

function resolveAutoTerminalDetail(options: {
  status: AutoTerminalStatus;
  actionRequiredDetail?: string;
  applyDetail?: string;
  reviewDetail?: string;
  runDetail?: string;
}): string | undefined {
  if (options.status === "action_required") {
    return truncateOutcomeDetail(
      options.actionRequiredDetail ?? options.applyDetail,
    );
  }

  if (options.status === "failed") {
    return truncateOutcomeDetail(
      options.applyDetail ?? options.reviewDetail ?? options.runDetail,
    );
  }

  return undefined;
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
  assertAutoOptionCompatibility(options);

  const now = runtime.now ?? Date.now.bind(Date);

  const overallStart = now();
  const chainedOutput = beginChainedCommandOutput();

  try {
    let hardFailure = false;
    let actionRequired = false;
    let actionRequiredDetail: string | undefined;

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
    let reviewResultCount = 0;
    let reviewResults: ReviewCommandResult["reviews"] | undefined;

    let applyStartedAt: number | undefined;
    let applyStatus: AutoApplyStatus = "skipped";
    let applyAgentId: string | undefined;
    let applyDetail: string | undefined;

    const markActionRequired = (
      detail: string,
      warningMessage: string,
    ): void => {
      actionRequired = true;
      actionRequiredDetail = detail;
      applyStatus = "skipped";
      applyDetail = detail;
      writeCommandOutput({
        body: formatAlertMessage("Warning", "yellow", warningMessage),
      });
    };

    let resolvedSpecPath = options.specPath;

    if (options.description) {
      try {
        const specResult = await runSpecCommand({
          description: options.description,
          profile: options.profile,
          maxParallel: options.maxParallel,
          suppressHint: true,
          writeOutput: writeCommandOutput,
        });
        resolvedSpecPath = specResult.outputPath;
        writeCommandOutput({ body: specResult.body });
      } catch (error) {
        hardFailure = true;
        writeCommandOutput({ body: renderCliError(toCliError(error)) });
      }
    }

    if (!hardFailure && resolvedSpecPath) {
      runStartedAt = now();

      try {
        // For non-TTY, suppress run renderer blank lines and let the chained
        // output system handle spacing. For TTY, let the run renderer handle
        // its own spacing since cursor control requires precise line counts.
        const suppressBlankLines = !process.stdout.isTTY;
        const runResult = await runRunCommand({
          specPath: resolvedSpecPath,
          agentIds: options.runAgentIds ? [...options.runAgentIds] : undefined,
          agentOverrideFlag: "--run-agent",
          profile: options.profile,
          maxParallel: options.maxParallel,
          branch: options.branch,
          writeOutput: writeCommandOutput,
          suppressHint: true,
          suppressLeadingBlankLine: suppressBlankLines,
          suppressTrailingBlankLine: suppressBlankLines,
          stdout: chainedOutput.stdout,
          stderr: chainedOutput.stderr,
        });

        runStatus =
          runResult.report.status === "succeeded" && runResult.exitCode !== 1
            ? "succeeded"
            : "failed";
        runId = runResult.report.runId;
        runRecordStatus = runResult.report.status;
        runCreatedAt = runResult.report.createdAt;
        runSpecPath = runResult.report.spec?.path;
        runBaseRevisionSha = runResult.report.baseRevisionSha;
        runAgentIds = runResult.report.agents.map((agent) => agent.agentId);

        if (runStatus === "failed") {
          hardFailure = true;
        }

        writeCommandOutput({ body: runResult.body });
      } catch (error) {
        runStatus = "failed";
        runDetail = toCliError(error).headline;
        hardFailure = true;
        writeCommandOutput({ body: renderCliError(toCliError(error)) });
      }
    }

    if (!hardFailure || runId) {
      if (!runId) {
        reviewStatus = "skipped";
      } else {
        reviewStartedAt = now();

        try {
          const reviewResult = await runReviewCommand({
            runId,
            agentIds: options.reviewerAgentIds
              ? [...options.reviewerAgentIds]
              : undefined,
            agentOverrideFlag: "--review-agent",
            profile: options.profile,
            maxParallel: options.maxParallel,
            stdout: chainedOutput.stdout,
            stderr: chainedOutput.stderr,
            suppressLeadingBlankLine: !process.stdout.isTTY,
            suppressTrailingBlankLine: !process.stdout.isTTY,
          });

          reviewStatus = "succeeded";
          reviewOutputPath = reviewResult.outputPath;
          reviewResultCount = reviewResult.reviews?.length ?? 1;
          reviewResults = reviewResult.reviews;
          if (reviewResult.exitCode === 1) {
            reviewStatus = "failed";
            reviewDetail = "One or more reviewers failed.";
            hardFailure = true;
          }

          writeCommandOutput({
            body: reviewResult.body,
            stderr: reviewResult.stderr,
          });
        } catch (error) {
          reviewStatus = "failed";
          reviewDetail = toCliError(error).headline;
          hardFailure = true;
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
        let recommendationPath: string | undefined;
        let preferredAgent: string | undefined;

        if (reviewResultCount <= 1) {
          const recommendationResult = await loadAutoRecommendation({
            reviewOutputPath,
          });
          recommendationPath = recommendationResult.recommendationPath;
          preferredAgent = recommendationResult.preferredAgent;
          if (!preferredAgent) {
            markActionRequired(
              "No resolvable recommendation was produced; manual arbitration required.",
              "No resolvable recommendation was produced. Review manually and apply the best solution.",
            );
          }
        } else if (reviewResults && reviewResults.length > 0) {
          const reviewerRecommendations =
            await loadReviewerRecommendationsForAuto({
              reviews: reviewResults,
            });
          if (reviewerRecommendations.length === 0) {
            markActionRequired(
              "No shared reviewer recommendation could be resolved; manual arbitration required.",
              "No shared recommendation was resolved. Review manually and apply the best solution.",
            );
          } else {
            const resolvedPreferredAgents = reviewerRecommendations
              .map(
                (recommendation) => recommendation.preferredAgent?.trim() ?? "",
              )
              .filter((agent): agent is string => agent.length > 0);

            if (
              resolvedPreferredAgents.length !== reviewerRecommendations.length
            ) {
              markActionRequired(
                "No shared reviewer recommendation could be resolved; manual arbitration required.",
                "No shared recommendation was resolved. Review manually and apply the best solution.",
              );
            } else {
              const distinctPreferredAgents = new Set(resolvedPreferredAgents);

              if (distinctPreferredAgents.size === 1) {
                const unanimousPreferredAgent =
                  [...distinctPreferredAgents][0] ?? "";
                const firstRecommendation = reviewerRecommendations[0];
                if (!firstRecommendation) {
                  throw new CliError(
                    "Failed to resolve reviewer recommendation.",
                    [],
                    ["Re-run `voratiq review` to regenerate review artifacts."],
                  );
                }
                recommendationPath = firstRecommendation.recommendationPath;
                preferredAgent = unanimousPreferredAgent;
              } else {
                markActionRequired(
                  "Reviewers disagreed on preferred candidate; manual arbitration required.",
                  "Reviewers disagreed. Review manually and apply the best solution.",
                );
              }
            }
          }
        } else {
          throw new CliError(
            "Failed to resolve reviewer recommendations.",
            [],
            ["Re-run `voratiq review` to regenerate review artifacts."],
          );
        }

        if (!preferredAgent || !recommendationPath) {
          // Apply intentionally skipped because reviewers did not converge.
        } else {
          const recommendedAgentId = resolveRecommendedAgent({
            recommendationPath,
            preferredAgent,
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
            applyStatus = "failed";
            applyDetail = "Apply stage reported a non-zero exit code.";
            hardFailure = true;
          }
        }
      } catch (error) {
        applyStatus = "failed";
        applyDetail = toCliError(error).headline;
        hardFailure = true;
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

    const autoStatus = resolveAutoTerminalStatus({
      hardFailure,
      actionRequired,
    });
    const autoDetail = resolveAutoTerminalDetail({
      status: autoStatus,
      actionRequiredDetail,
      applyDetail,
      reviewDetail,
      runDetail,
    });
    const normalizedApplyDetail = truncateOutcomeDetail(applyDetail);

    const autoOutcome: RunAutoOutcome = {
      status: autoStatus,
      completedAt: new Date(now()).toISOString(),
      ...(autoDetail ? { detail: autoDetail } : {}),
      apply: {
        status: applyStatus,
        ...(applyAgentId ? { agentId: applyAgentId } : {}),
        ...(normalizedApplyDetail ? { detail: normalizedApplyDetail } : {}),
      },
    };

    await persistAutoOutcome({
      runId,
      outcome: autoOutcome,
    });

    const exitCode = mapAutoTerminalStatusToExitCode(autoStatus);

    const summaryBody = renderAutoSummaryTranscript({
      status: autoStatus,
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
      apply: {
        status: applyStatus,
        ...(typeof applyDurationMs === "number"
          ? { durationMs: applyDurationMs }
          : {}),
        ...(applyAgentId ? { agentId: applyAgentId } : {}),
        ...(normalizedApplyDetail ? { detail: normalizedApplyDetail } : {}),
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
      ...(applyAgentId ? { appliedAgentId: applyAgentId } : {}),
      auto: {
        status: autoStatus,
        ...(autoDetail ? { detail: autoDetail } : {}),
      },
      apply: {
        status: applyStatus,
        ...(normalizedApplyDetail ? { detail: normalizedApplyDetail } : {}),
      },
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
    .description(
      "End-to-end pipeline to run agents, review results, and optionally apply",
    )
    .option("--spec <path>", "Path to an existing spec file")
    .option(
      "--description <text>",
      "Generate a spec from a plain-language description",
    )
    .addOption(
      new Option(
        "--run-agent <agent-id>",
        "Override run-stage agents (repeatable)",
      )
        .default([], "")
        .argParser(collectRunAgentOption),
    )
    .addOption(
      new Option(
        "--review-agent <agent-id>",
        "Override review-stage agents (repeatable)",
      )
        .default([], "")
        .argParser(collectReviewAgentOption),
    )
    .option("--profile <name>", 'Orchestration profile (default: "default")')
    .option(
      "--max-parallel <count>",
      "Maximum number of agents to run concurrently",
      parseMaxParallelOption,
    )
    .option("--branch", "Checkout or create a branch named after the spec")
    .option(
      "--apply",
      "Apply the recommended agent's output after review",
      () => true,
    )
    .option("--commit", "Commit after applying (requires --apply)", () => true)
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
