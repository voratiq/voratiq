import type {
  AutoApplyStatus,
  AutoTerminalStatus,
} from "../../domains/runs/model/types.js";
import { mapRunStatusToExitCode, type RunStatus } from "../../status/index.js";
import { HintedError, toErrorMessage } from "../../utils/errors.js";

export interface ExecuteAutoCommandInput {
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

export interface AutoSpecStageInput {
  description: string;
  profile?: string;
  maxParallel?: number;
  suppressHint: boolean;
}

export interface AutoSpecStageResult {
  body: string;
  generatedSpecPaths?: readonly string[];
  specPath?: string;
}

export interface AutoRunAgentResult {
  agentId: string;
}

export interface AutoRunStageReport {
  runId: string;
  status: RunStatus;
  createdAt: string;
  baseRevisionSha: string;
  spec?: {
    path?: string;
  };
  agents: readonly AutoRunAgentResult[];
}

export interface AutoRunStageInput {
  specPath: string;
  agentIds?: readonly string[];
  agentOverrideFlag: string;
  profile?: string;
  maxParallel?: number;
  branch?: boolean;
}

export interface AutoRunStageResult {
  report: AutoRunStageReport;
  body: string;
  exitCode?: number;
}

export interface AutoReviewStageReview {
  agentId: string;
  status: "succeeded" | "failed";
  outputPath: string;
}

export interface AutoReviewStageInput {
  runId: string;
  agentIds?: readonly string[];
  agentOverrideFlag: string;
  profile?: string;
  maxParallel?: number;
  suppressHint: boolean;
}

export interface AutoReviewStageResult {
  body: string;
  stderr?: string;
  exitCode?: number;
  outputPath: string;
  reviews?: readonly AutoReviewStageReview[];
}

export interface AutoApplyStageInput {
  runId: string;
  agentId: string;
  commit: boolean;
}

export interface AutoApplyStageResult {
  body: string;
  exitCode?: number;
}

export interface AutoRecommendationLoadResult {
  recommendationPath: string;
  preferredAgent?: string;
}

export interface ReviewerRecommendation extends AutoRecommendationLoadResult {
  reviewerAgentId: string;
}

export type AutoCommandEvent =
  | {
      kind: "body";
      body: string;
      stderr?: string;
      exitCode?: number;
    }
  | {
      kind: "error";
      error: unknown;
    }
  | {
      kind: "action_required";
      detail: string;
      warningMessage: string;
      separateWithDivider: boolean;
    };

export interface AutoPhaseSummary {
  status: "succeeded" | "failed" | "skipped";
  durationMs?: number;
  detail?: string;
}

export interface AutoExecutionSummary {
  status: AutoTerminalStatus;
  totalDurationMs: number;
  spec: AutoPhaseSummary & { specPath?: string };
  run: AutoPhaseSummary & {
    runId?: string;
    runStatus?: RunStatus;
    createdAt?: string;
    specPath?: string;
    baseRevisionSha?: string;
  };
  review: AutoPhaseSummary & { outputPath?: string };
  apply: AutoPhaseSummary & { agentId?: string };
}

export interface ExecuteAutoCommandResult {
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
  summary: AutoExecutionSummary;
  events: readonly AutoCommandEvent[];
}

export interface AutoCommandDependencies {
  now?: () => number;
  onEvent?: (event: AutoCommandEvent) => void;
  runSpecStage: (input: AutoSpecStageInput) => Promise<AutoSpecStageResult>;
  runRunStage: (input: AutoRunStageInput) => Promise<AutoRunStageResult>;
  runReviewStage: (
    input: AutoReviewStageInput,
  ) => Promise<AutoReviewStageResult>;
  runApplyStage: (input: AutoApplyStageInput) => Promise<AutoApplyStageResult>;
  loadRecommendation: (input: {
    reviewOutputPath: string;
  }) => Promise<AutoRecommendationLoadResult>;
  loadReviewerRecommendations: (input: {
    reviews: readonly AutoReviewStageReview[];
  }) => Promise<ReviewerRecommendation[]>;
}

export async function executeAutoCommand(
  options: ExecuteAutoCommandInput,
  dependencies: AutoCommandDependencies,
): Promise<ExecuteAutoCommandResult> {
  assertAutoOptionCompatibility(options);

  const hasDescription =
    typeof options.description === "string" &&
    options.description.trim().length > 0;
  const description =
    typeof options.description === "string" ? options.description : undefined;
  const now = dependencies.now ?? Date.now.bind(Date);
  const overallStart = now();
  const events: AutoCommandEvent[] = [];
  const recordEvent = (event: AutoCommandEvent): void => {
    events.push(event);
    dependencies.onEvent?.(event);
  };

  let hardFailure = false;
  let actionRequired = false;
  let actionRequiredDetail: string | undefined;

  let specStartedAt: number | undefined;
  let specStatus: "succeeded" | "failed" | "skipped" = "skipped";
  let specPath: string | undefined;
  let specDetail: string | undefined;

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
  let reviewResults: readonly AutoReviewStageReview[] | undefined;
  let reviewTranscriptEmitted = false;

  let applyStartedAt: number | undefined;
  let applyStatus: AutoApplyStatus = "skipped";
  let applyAgentId: string | undefined;
  let applyDetail: string | undefined;

  const markActionRequired = (detail: string, warningMessage: string): void => {
    actionRequired = true;
    actionRequiredDetail = detail;
    applyStatus = "skipped";
    applyDetail = detail;
    recordEvent({
      kind: "action_required",
      detail,
      warningMessage,
      separateWithDivider: reviewTranscriptEmitted,
    });
  };

  let resolvedSpecPath = options.specPath;

  if (hasDescription && description) {
    specStartedAt = now();
    try {
      const specResult = await dependencies.runSpecStage({
        description,
        profile: options.profile,
        maxParallel: options.maxParallel,
        suppressHint: true,
      });
      specStatus = "succeeded";
      specPath = resolveSpecPathForAuto(specResult);
      resolvedSpecPath = specPath;
      recordEvent({ kind: "body", body: specResult.body });
    } catch (error) {
      specStatus = "failed";
      specDetail = toHeadline(error);
      hardFailure = true;
      recordEvent({ kind: "error", error });
    }
  }

  if (!hardFailure && resolvedSpecPath) {
    runStartedAt = now();

    try {
      const runResult = await dependencies.runRunStage({
        specPath: resolvedSpecPath,
        agentIds: options.runAgentIds ? [...options.runAgentIds] : undefined,
        agentOverrideFlag: "--run-agent",
        profile: options.profile,
        maxParallel: options.maxParallel,
        branch: options.branch,
      });

      const expectedRunExitCode = mapRunStatusToExitCode(
        runResult.report.status,
      );
      const resolvedRunExitCode =
        typeof runResult.exitCode === "number"
          ? runResult.exitCode
          : expectedRunExitCode;

      if (
        typeof runResult.exitCode === "number" &&
        runResult.exitCode !== expectedRunExitCode
      ) {
        throw new HintedError("Run status/exit code mismatch.", {
          detailLines: [
            `Status: \`${runResult.report.status}\`.`,
            `Exit code: ${runResult.exitCode}.`,
          ],
          hintLines: ["Re-run the command."],
        });
      }

      runStatus = resolvedRunExitCode === 0 ? "succeeded" : "failed";
      runId = runResult.report.runId;
      runRecordStatus = runResult.report.status;
      runCreatedAt = runResult.report.createdAt;
      runSpecPath = runResult.report.spec?.path;
      runBaseRevisionSha = runResult.report.baseRevisionSha;
      runAgentIds = runResult.report.agents.map((agent) => agent.agentId);

      if (runStatus === "failed") {
        const statusDetail = runRecordStatus
          ? `status \`${runRecordStatus}\``
          : "a non-success status";
        runDetail =
          runDetail ??
          `Run completed with ${statusDetail} (exit code ${resolvedRunExitCode}).`;
        hardFailure = true;
      }

      recordEvent({
        kind: "body",
        body: runResult.body,
        exitCode: runResult.exitCode,
      });
    } catch (error) {
      runStatus = "failed";
      runDetail = toHeadline(error);
      hardFailure = true;
      recordEvent({ kind: "error", error });
    }
  }

  const shouldAttemptReview = hasDescription
    ? runStatus === "succeeded" && typeof runId === "string"
    : !hardFailure || runId !== undefined;

  if (shouldAttemptReview) {
    if (!runId) {
      reviewStatus = "skipped";
    } else {
      reviewStartedAt = now();

      try {
        const reviewResult = await dependencies.runReviewStage({
          runId,
          agentIds: options.reviewerAgentIds
            ? [...options.reviewerAgentIds]
            : undefined,
          agentOverrideFlag: "--review-agent",
          profile: options.profile,
          maxParallel: options.maxParallel,
          suppressHint: options.apply === true,
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

        recordEvent({
          kind: "body",
          body: reviewResult.body,
          stderr: reviewResult.stderr,
          exitCode: reviewResult.exitCode,
        });
        reviewTranscriptEmitted = true;
      } catch (error) {
        reviewStatus = "failed";
        reviewDetail = toHeadline(error);
        hardFailure = true;
        recordEvent({ kind: "error", error });
      }
    }
  }

  if (
    options.apply &&
    runId &&
    reviewStatus === "succeeded" &&
    reviewOutputPath &&
    (!hasDescription || runStatus === "succeeded")
  ) {
    applyStartedAt = now();
    try {
      let recommendationPath: string | undefined;
      let preferredAgent: string | undefined;

      if (reviewResultCount <= 1) {
        const recommendationResult = await dependencies.loadRecommendation({
          reviewOutputPath,
        });
        recommendationPath = recommendationResult.recommendationPath;
        preferredAgent = recommendationResult.preferredAgent;
        if (!preferredAgent) {
          markActionRequired(
            "No resolvable recommendation was produced; manual review required.",
            "No resolvable recommendation was produced. Review results and apply manually.",
          );
        }
      } else if (reviewResults && reviewResults.length > 0) {
        const reviewerRecommendations =
          await dependencies.loadReviewerRecommendations({
            reviews: reviewResults,
          });
        if (reviewerRecommendations.length === 0) {
          markActionRequired(
            "No shared reviewer recommendation could be resolved; manual review required.",
            "No shared recommendation was resolved. Review results and apply manually.",
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
              "No shared reviewer recommendation could be resolved; manual review required.",
              "No shared recommendation was resolved. Review results and apply manually.",
            );
          } else {
            const distinctPreferredAgents = new Set(resolvedPreferredAgents);

            if (distinctPreferredAgents.size === 1) {
              const unanimousPreferredAgent =
                [...distinctPreferredAgents][0] ?? "";
              const firstRecommendation = reviewerRecommendations[0];
              if (!firstRecommendation) {
                throw new HintedError(
                  "Failed to resolve reviewer recommendation.",
                  {
                    hintLines: [
                      "Re-run `voratiq review` to regenerate review artifacts.",
                    ],
                  },
                );
              }
              recommendationPath = firstRecommendation.recommendationPath;
              preferredAgent = unanimousPreferredAgent;
            } else {
              markActionRequired(
                "Reviewers disagreed on preferred candidate; manual review required.",
                "Reviewers disagreed. Review results and apply manually.",
              );
            }
          }
        }
      } else {
        throw new HintedError("Failed to resolve reviewer recommendations.", {
          hintLines: [
            "Re-run `voratiq review` to regenerate review artifacts.",
          ],
        });
      }

      if (preferredAgent && recommendationPath) {
        const recommendedAgentId = resolveRecommendedAgent({
          recommendationPath,
          preferredAgent,
          availableAgents: runAgentIds,
        });

        const applyResult = await dependencies.runApplyStage({
          runId,
          agentId: recommendedAgentId,
          commit: options.commit ?? false,
        });

        applyStatus = "succeeded";
        applyAgentId = recommendedAgentId;

        recordEvent({
          kind: "body",
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
      applyDetail = toHeadline(error);
      hardFailure = true;
      recordEvent({ kind: "error", error });
    }
  }

  const overallDurationMs = now() - overallStart;
  const specDurationMs =
    specStartedAt !== undefined ? now() - specStartedAt : undefined;
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
  const exitCode = mapAutoTerminalStatusToExitCode(autoStatus);

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
    summary: {
      status: autoStatus,
      totalDurationMs: overallDurationMs,
      spec: {
        status: specStatus,
        ...(typeof specDurationMs === "number"
          ? { durationMs: specDurationMs }
          : {}),
        ...(specPath ? { specPath } : {}),
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
      apply: {
        status: applyStatus,
        ...(typeof applyDurationMs === "number"
          ? { durationMs: applyDurationMs }
          : {}),
        ...(applyAgentId ? { agentId: applyAgentId } : {}),
        ...(normalizedApplyDetail ? { detail: normalizedApplyDetail } : {}),
      },
    },
    events,
  };
}

function assertAutoOptionCompatibility(options: ExecuteAutoCommandInput): void {
  const hasSpecPath =
    typeof options.specPath === "string" && options.specPath.trim().length > 0;
  const hasDescription =
    typeof options.description === "string" &&
    options.description.trim().length > 0;

  if (hasSpecPath === hasDescription) {
    throw new HintedError(
      "Exactly one of `--spec` or `--description` is required.",
      {
        hintLines: ["Pass exactly one."],
      },
    );
  }

  if (options.commit && !options.apply) {
    throw new HintedError("Option `--commit` requires `--apply`.", {
      hintLines: ["Add `--apply` when using `--commit`."],
    });
  }
}

function resolveSpecPathForAuto(result: AutoSpecStageResult): string {
  const specPathCandidate =
    typeof result.specPath === "string" && result.specPath.trim().length > 0
      ? result.specPath.trim()
      : undefined;
  if (specPathCandidate) {
    return specPathCandidate;
  }

  if ((result.generatedSpecPaths?.length ?? 0) > 1) {
    throw new HintedError(
      "Spec stage generated multiple drafts and did not select one.",
      {
        hintLines: [
          "Review the generated spec artifacts manually before continuing.",
        ],
      },
    );
  }

  throw new HintedError("Spec stage did not return a spec path.", {
    hintLines: [
      "Re-run the spec stage and check for generated artifacts in the output.",
    ],
  });
}

function resolveRecommendedAgent(options: {
  recommendationPath: string;
  preferredAgent: string;
  availableAgents: readonly string[];
}): string {
  const { recommendationPath, preferredAgent, availableAgents } = options;

  const normalizedPreferredAgent = preferredAgent.trim();
  if (normalizedPreferredAgent.length === 0) {
    throw new HintedError(`No preferred agent in \`${recommendationPath}\`.`, {
      hintLines: ["Re-run `voratiq review` to regenerate the recommendation."],
    });
  }

  const availableSet = new Set(availableAgents);
  if (!availableSet.has(normalizedPreferredAgent)) {
    const availableDisplay = availableAgents
      .map((agentId) => `\`${agentId}\``)
      .join(", ");
    throw new HintedError("Recommendation did not match any run agent.", {
      detailLines: [
        `Preferred agent: \`${normalizedPreferredAgent}\`.`,
        ...(availableDisplay.length > 0
          ? [`Available agents: ${availableDisplay}.`]
          : []),
      ],
      hintLines: [
        "Use an agent id present in the run report or review output.",
      ],
    });
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

function toHeadline(error: unknown): string {
  return error instanceof HintedError ? error.headline : toErrorMessage(error);
}
