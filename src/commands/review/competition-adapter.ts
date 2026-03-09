import {
  copyFile,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { detectAgentProcessFailureDetail } from "../../agents/runtime/failures.js";
import { runSandboxedAgent } from "../../agents/runtime/harness.js";
import type {
  CompetitionCommandAdapter,
  CompetitionPreparationResult,
} from "../../competition/command-adapter.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../configs/environment/types.js";
import type { ReviewProgressRenderer } from "../../render/transcripts/review.js";
import { emitStageProgressEvent } from "../../render/transcripts/stage-progress.js";
import { generateBlindedCandidateAlias } from "../../reviews/candidates.js";
import {
  appendReviewRecord,
  flushReviewRecordBuffer,
  readReviewRecords,
  rewriteReviewRecord,
} from "../../reviews/records/persistence.js";
import type { ReviewRecord } from "../../reviews/records/types.js";
import type { RunRecordEnhanced } from "../../runs/records/enhanced.js";
import { toErrorMessage } from "../../utils/errors.js";
import { createDetachedWorktree, removeWorktree } from "../../utils/git.js";
import {
  isRepoRelativePath,
  normalizePathForDisplay,
  relativeToRoot,
  resolvePath,
} from "../../utils/path.js";
import {
  type AgentWorkspacePaths,
  scaffoldAgentSessionWorkspace,
} from "../../workspace/layout.js";
import { promoteWorkspaceFile } from "../../workspace/promotion.js";
import {
  resolveWorkspacePath,
  REVIEW_ARTIFACT_INFO_FILENAME,
  REVIEW_FILENAME,
  REVIEW_RECOMMENDATION_FILENAME,
  VORATIQ_HISTORY_LOCK_FILENAME,
  VORATIQ_REVIEWS_DIR,
  VORATIQ_REVIEWS_FILE,
  VORATIQ_REVIEWS_SESSIONS_DIR,
} from "../../workspace/structure.js";
import {
  type ResolvedExtraContextFile,
  stageExtraContextFiles,
} from "../shared/extra-context.js";
import { pruneWorkspace } from "../shared/prune.js";
import { resolveBlindedRecommendation } from "./blinded.js";
import { resolveEligibleReviewCandidateAgents } from "./eligibility.js";
import {
  ReviewGenerationFailedError,
  ReviewNoEligibleCandidatesError,
} from "./errors.js";
import { buildBlindedReviewManifest } from "./manifest.js";
import { validateReviewOutputContract } from "./output-validation.js";
import { buildReviewPrompt } from "./prompt.js";
import {
  assertRecommendationMatchesRanking,
  parseReviewRecommendation,
} from "./recommendation.js";
import { composeReviewSandboxPolicy } from "./sandbox-policy.js";

export type ReviewCompetitionCandidate = AgentDefinition;

interface BlindedReviewSessionInputs {
  readonly aliasMap: Record<string, string>;
  readonly sharedRootAbsolute: string;
  readonly sharedInputsAbsolute: string;
  readonly stagedSpecAbsolute: string;
  readonly baseSnapshotAbsolute: string;
  readonly stagedCandidates: ReadonlyArray<{
    readonly candidateId: string;
    readonly agentId: string;
    readonly diffAbsolutePath: string;
    readonly diffRecorded: boolean;
  }>;
  readonly worktreesToRemove: readonly string[];
}

export interface BlindedReviewPreparation {
  readonly enabled: true;
  readonly aliasMap: Record<string, string>;
  readonly stagedSpecPath: string;
  readonly baseSnapshotPath: string;
  readonly stagedCandidates: ReadonlyArray<{
    readonly candidateId: string;
    readonly agentId: string;
    readonly diffPath: string;
    readonly diffRecorded: boolean;
  }>;
  readonly extraWriteProtectedPaths: readonly string[];
  readonly extraReadProtectedPaths: readonly string[];
}

export interface PreparedReviewCompetitionCandidate {
  readonly candidate: ReviewCompetitionCandidate;
  readonly workspacePaths: AgentWorkspacePaths;
  readonly outputPath: string;
  readonly prompt: string;
  readonly missingArtifacts: readonly string[];
  readonly blinded: BlindedReviewPreparation;
}

export interface ReviewCompetitionExecution {
  readonly agentId: string;
  readonly outputPath: string;
  readonly status: "succeeded" | "failed";
  readonly missingArtifacts: readonly string[];
  readonly error?: string;
}

export interface CreateReviewCompetitionAdapterInput {
  readonly root: string;
  readonly reviewId: string;
  readonly createdAt: string;
  readonly reviewsFilePath: string;
  readonly run: RunRecordEnhanced;
  readonly environment: EnvironmentConfig;
  readonly extraContextFiles?: readonly ResolvedExtraContextFile[];
  readonly renderer?: ReviewProgressRenderer;
}

export function createReviewCompetitionAdapter(
  input: CreateReviewCompetitionAdapterInput,
): CompetitionCommandAdapter<
  ReviewCompetitionCandidate,
  PreparedReviewCompetitionCandidate,
  ReviewCompetitionExecution
> {
  const {
    root,
    reviewId,
    createdAt,
    reviewsFilePath,
    run,
    environment,
    extraContextFiles = [],
    renderer,
  } = input;

  let failure: unknown;
  const workspacesToPrune = new Set<string>();
  const worktreesToRemove = new Set<string>();
  let sharedInputs: BlindedReviewSessionInputs | undefined;

  return {
    queueCandidate: (candidate) => {
      emitStageProgressEvent(renderer, {
        type: "stage.candidate",
        stage: "review",
        candidate: {
          reviewerAgentId: candidate.id,
          status: "queued",
        },
      });
    },
    prepareCandidates: async (
      candidates,
    ): Promise<
      CompetitionPreparationResult<
        PreparedReviewCompetitionCandidate,
        ReviewCompetitionExecution
      >
    > => {
      try {
        sharedInputs = await prepareSharedBlindedReviewInputs({
          root,
          reviewId,
          run,
        });
        for (const worktreePath of sharedInputs.worktreesToRemove) {
          worktreesToRemove.add(worktreePath);
        }

        const record: ReviewRecord = {
          sessionId: reviewId,
          runId: run.runId,
          createdAt,
          status: "running",
          extraContext:
            extraContextFiles.length > 0
              ? extraContextFiles.map((file) => file.displayPath)
              : undefined,
          reviewers: candidates.map((candidate) => ({
            agentId: candidate.id,
            status: "running",
            outputPath: buildReviewOutputPath({
              root,
              reviewId,
              reviewerAgentId: candidate.id,
            }),
          })),
          blinded: {
            enabled: true,
            aliasMap: sharedInputs.aliasMap,
          },
        };
        await appendReviewRecord({
          root,
          reviewsFilePath,
          record,
        });

        const prepared: PreparedReviewCompetitionCandidate[] = [];
        const reviewerAgentIds = candidates.map((candidate) => candidate.id);
        for (const candidate of candidates) {
          const workspacePaths = await scaffoldAgentSessionWorkspace({
            root,
            domain: VORATIQ_REVIEWS_DIR,
            sessionId: reviewId,
            agentId: candidate.id,
          });
          workspacesToPrune.add(workspacePaths.workspacePath);

          const outputPath = normalizePathForDisplay(
            relativeToRoot(root, workspacePaths.reviewPath),
          );

          await attachSharedInputsToReviewerWorkspace({
            workspacePath: workspacePaths.workspacePath,
            sharedInputsAbsolute: sharedInputs.sharedInputsAbsolute,
          });
          await stageExtraContextFiles({
            contextPath: workspacePaths.contextPath,
            files: extraContextFiles,
          });

          const blinded = buildReviewerBlindedPreparation({
            root,
            reviewId,
            reviewerAgentId: candidate.id,
            reviewerAgentIds,
            workspacePaths,
            sharedInputs,
          });

          const buildManifestResult = await buildBlindedReviewManifest({
            root,
            run,
            specPath: blinded.stagedSpecPath,
            baseSnapshotPath: blinded.baseSnapshotPath,
            candidates: blinded.stagedCandidates.map((entry) => ({
              candidateId: entry.candidateId,
              agentId: entry.agentId,
              stagedDiffPath: entry.diffPath,
              diffRecorded: entry.diffRecorded,
            })),
          });
          const manifest = buildManifestResult.manifest;
          const missingArtifacts = buildManifestResult.missingArtifacts;

          const artifactInfoWorkspacePath = join(
            workspacePaths.workspacePath,
            REVIEW_ARTIFACT_INFO_FILENAME,
          );
          await writeFile(
            artifactInfoWorkspacePath,
            `${JSON.stringify(manifest, null, 2)}\n`,
            {
              encoding: "utf8",
            },
          );

          const promptBuild = buildReviewPrompt({
            runId: run.runId,
            runStatus: run.status,
            specPath: blinded.stagedSpecPath,
            baseRevisionSha: run.baseRevisionSha,
            createdAt: run.createdAt,
            completedAt: manifest.run.completedAt,
            artifactInfoPath: REVIEW_ARTIFACT_INFO_FILENAME,
            outputPath: REVIEW_FILENAME,
            baseSnapshotPath: blinded.baseSnapshotPath,
            candidates: blinded.stagedCandidates.map((entry) => ({
              candidateId: entry.candidateId,
              diffPath: entry.diffPath,
            })),
            repoRootPath: workspacePaths.workspacePath,
            workspacePath: workspacePaths.workspacePath,
            extraContextFiles,
          });

          assertNoCandidateIdentityLeak({
            prompt: promptBuild.leakageCheckPrompt,
            manifest,
            forbidden: buildForbiddenCandidateIdentityTokens({
              run,
              allowed: [candidate.id, candidate.model],
            }),
          });

          prepared.push({
            candidate,
            workspacePaths,
            outputPath,
            prompt: promptBuild.prompt,
            missingArtifacts: [...missingArtifacts],
            blinded,
          });
        }

        return {
          ready: prepared,
          failures: [],
        };
      } catch (error) {
        failure = failure ?? error;
        throw error;
      }
    },
    onCandidateRunning: async (prepared) => {
      const startedAt = new Date().toISOString();
      await rewriteReviewRecordIfPresent({
        root,
        reviewsFilePath,
        sessionId: reviewId,
        mutate: (record) => {
          assertReviewAliasMapConsistency({
            record,
            reviewId,
            expectedAliasMap: prepared.blinded.aliasMap,
          });

          return {
            ...record,
            reviewers: record.reviewers.map((reviewer) => {
              if (reviewer.agentId !== prepared.candidate.id) {
                return reviewer;
              }
              return {
                ...reviewer,
                status: "running",
                startedAt: reviewer.startedAt ?? startedAt,
              };
            }),
          };
        },
      });

      emitStageProgressEvent(renderer, {
        type: "stage.candidate",
        stage: "review",
        candidate: {
          reviewerAgentId: prepared.candidate.id,
          status: "running",
          startedAt,
        },
      });
    },
    executeCandidate: async (prepared): Promise<ReviewCompetitionExecution> => {
      const { candidate, workspacePaths, prompt, blinded, outputPath } =
        prepared;
      const agent = candidate;
      const sandboxPolicy = composeReviewSandboxPolicy({
        stageWriteProtectedPaths: blinded.extraWriteProtectedPaths,
        stageReadProtectedPaths: blinded.extraReadProtectedPaths,
      });
      const result = await runSandboxedAgent({
        root,
        sessionId: reviewId,
        sandboxStageId: "review",
        agent,
        prompt,
        environment,
        teardownAuthOnExit: false,
        paths: {
          agentRoot: workspacePaths.agentRoot,
          workspacePath: workspacePaths.workspacePath,
          sandboxHomePath: workspacePaths.sandboxHomePath,
          runtimeManifestPath: workspacePaths.runtimeManifestPath,
          sandboxSettingsPath: workspacePaths.sandboxSettingsPath,
          runtimePath: workspacePaths.runtimePath,
          artifactsPath: workspacePaths.artifactsPath,
          stdoutPath: workspacePaths.stdoutPath,
          stderrPath: workspacePaths.stderrPath,
        },
        captureChat: true,
        extraWriteProtectedPaths: sandboxPolicy.extraWriteProtectedPaths,
        extraReadProtectedPaths: sandboxPolicy.extraReadProtectedPaths,
      });

      if (result.exitCode !== 0 || result.errorMessage) {
        const detectedDetail =
          result.watchdog?.trigger && result.errorMessage
            ? result.errorMessage
            : await detectAgentProcessFailureDetail({
                provider: agent.provider,
                stdoutPath: workspacePaths.stdoutPath,
                stderrPath: workspacePaths.stderrPath,
              });
        const detail =
          detectedDetail ??
          result.errorMessage ??
          `Agent exited with code ${result.exitCode ?? "unknown"}`;
        throw new ReviewGenerationFailedError(
          [detail],
          [
            `See stderr: ${normalizePathForDisplay(
              relativeToRoot(root, workspacePaths.stderrPath),
            )}`,
          ],
        );
      }

      await assertReviewOutputExists(root, workspacePaths, {
        eligibleCandidateIds: blinded.stagedCandidates.map(
          (entry) => entry.candidateId,
        ),
      });

      await postProcessBlindedReviewOutputs({
        root,
        reviewsFilePath,
        reviewId,
        workspacePaths,
        aliasMap: blinded.aliasMap,
      });

      await promoteWorkspaceFile({
        workspacePath: workspacePaths.workspacePath,
        artifactsPath: workspacePaths.artifactsPath,
        stagedRelativePath: REVIEW_FILENAME,
        artifactRelativePath: REVIEW_FILENAME,
        deleteStaged: true,
      });
      await promoteWorkspaceFile({
        workspacePath: workspacePaths.workspacePath,
        artifactsPath: workspacePaths.artifactsPath,
        stagedRelativePath: REVIEW_RECOMMENDATION_FILENAME,
        artifactRelativePath: REVIEW_RECOMMENDATION_FILENAME,
        deleteStaged: true,
      });

      return {
        agentId: agent.id,
        outputPath,
        status: "succeeded",
        missingArtifacts: [...prepared.missingArtifacts],
      };
    },
    onCandidateCompleted: async (prepared) => {
      const completedAt = new Date().toISOString();
      await rewriteReviewRecordIfPresent({
        root,
        reviewsFilePath,
        sessionId: reviewId,
        mutate: (record) => {
          assertReviewAliasMapConsistency({
            record,
            reviewId,
            expectedAliasMap: prepared.blinded.aliasMap,
          });
          return mutateReviewerRecord(record, {
            reviewerAgentId: prepared.candidate.id,
            status: "succeeded",
            completedAt,
            error: null,
          });
        },
      });

      emitStageProgressEvent(renderer, {
        type: "stage.candidate",
        stage: "review",
        candidate: {
          reviewerAgentId: prepared.candidate.id,
          status: "succeeded",
          completedAt,
        },
      });
    },
    captureExecutionFailure: async ({ prepared, error }) => {
      failure = failure ?? error;
      const detail = toReviewFailureDetail(error);
      const completedAt = new Date().toISOString();
      try {
        await rewriteReviewRecordIfPresent({
          root,
          reviewsFilePath,
          sessionId: reviewId,
          mutate: (record) => {
            assertReviewAliasMapConsistency({
              record,
              reviewId,
              expectedAliasMap: prepared.blinded.aliasMap,
            });
            return mutateReviewerRecord(record, {
              reviewerAgentId: prepared.candidate.id,
              status: "failed",
              completedAt,
              error: detail,
            });
          },
        });
      } catch {
        // Preserve the primary execution error.
      }
      emitStageProgressEvent(renderer, {
        type: "stage.candidate",
        stage: "review",
        candidate: {
          reviewerAgentId: prepared.candidate.id,
          status: "failed",
          completedAt,
        },
      });
      return {
        agentId: prepared.candidate.id,
        outputPath: prepared.outputPath,
        status: "failed",
        missingArtifacts: [...prepared.missingArtifacts],
        error: detail,
      };
    },
    finalizeCompetition: async () => {
      const failed = failure !== undefined;
      const failureDetail = toReviewFailureDetail(failure);
      let finalizedRecord: ReviewRecord | undefined;

      try {
        finalizedRecord = await rewriteReviewRecord({
          root,
          reviewsFilePath,
          sessionId: reviewId,
          mutate: (record) => {
            const completedAt = record.completedAt ?? new Date().toISOString();
            const runningReviewerStatus = resolveRunningReviewerStatus({
              recordStatus: record.status,
              failed,
            });

            const reviewers = record.reviewers.map(
              (reviewer): ReviewRecord["reviewers"][number] => {
                if (reviewer.status !== "running") {
                  return reviewer;
                }
                if (runningReviewerStatus === "succeeded") {
                  return {
                    ...reviewer,
                    status: runningReviewerStatus,
                    completedAt,
                    error: null,
                  };
                }
                return {
                  ...reviewer,
                  status: runningReviewerStatus,
                  completedAt,
                  error: reviewer.error ?? record.error ?? failureDetail,
                };
              },
            );

            const status =
              record.status === "running"
                ? failed
                  ? "failed"
                  : "succeeded"
                : record.status;
            const error =
              status === "succeeded"
                ? null
                : (record.error ?? (failed ? failureDetail : null));

            return {
              ...record,
              status,
              completedAt,
              error,
              reviewers,
            };
          },
        });
      } catch {
        // Preserve cleanup behavior even when record rewrite fails.
      }

      if (finalizedRecord) {
        for (const reviewer of finalizedRecord.reviewers) {
          emitStageProgressEvent(renderer, {
            type: "stage.candidate",
            stage: "review",
            candidate: {
              reviewerAgentId: reviewer.agentId,
              status: reviewer.status,
              startedAt: reviewer.startedAt,
              completedAt: reviewer.completedAt,
            },
          });
        }

        emitStageProgressEvent(renderer, {
          type: "stage.status",
          stage: "review",
          status: finalizedRecord.status,
        });
      } else {
        emitStageProgressEvent(renderer, {
          type: "stage.status",
          stage: "review",
          status: failed ? "failed" : "succeeded",
        });
      }

      await flushReviewRecordBuffer({
        reviewsFilePath,
        sessionId: reviewId,
      }).catch(() => {});

      for (const worktreePath of worktreesToRemove) {
        await removeWorktree({ root, worktreePath }).catch(() => {});
      }

      for (const workspacePath of workspacesToPrune) {
        await pruneWorkspace(workspacePath);
      }
    },
  };
}

function mutateReviewerRecord(
  record: ReviewRecord,
  options: {
    reviewerAgentId: string;
    status: "succeeded" | "failed" | "aborted";
    completedAt: string;
    error: string | null;
  },
): ReviewRecord {
  const { reviewerAgentId, status, completedAt, error } = options;
  let found = false;
  const reviewers = record.reviewers.map((reviewer) => {
    if (reviewer.agentId !== reviewerAgentId) {
      return reviewer;
    }
    found = true;
    return {
      ...reviewer,
      status,
      completedAt,
      error,
    };
  });
  if (!found) {
    throw new Error(
      `Review record ${record.sessionId} is missing reviewer ${reviewerAgentId}.`,
    );
  }
  return {
    ...record,
    reviewers,
  };
}

function resolveRunningReviewerStatus(options: {
  recordStatus: ReviewRecord["status"];
  failed: boolean;
}): "succeeded" | "failed" | "aborted" {
  const { recordStatus, failed } = options;
  if (recordStatus === "aborted") {
    return "aborted";
  }
  if (recordStatus === "failed") {
    return "failed";
  }
  return failed ? "failed" : "succeeded";
}

async function rewriteReviewRecordIfPresent(
  options: Parameters<typeof rewriteReviewRecord>[0],
): Promise<void> {
  try {
    await rewriteReviewRecord(options);
  } catch (error) {
    if (
      error instanceof Error &&
      /Session\s+.+\s+not found\./u.test(error.message)
    ) {
      return;
    }
    throw error;
  }
}

function toReviewFailureDetail(error: unknown): string {
  if (error instanceof ReviewGenerationFailedError) {
    const detail = [...error.detailLines];
    const informativeHints = error.hintLines.filter(
      (line) =>
        !line.startsWith("Review session:") && !line.startsWith("See stderr:"),
    );
    if (informativeHints.length > 0) {
      detail.push(...informativeHints);
    }
    if (detail.length > 0) {
      return detail.join("\n");
    }
  }

  if (error === undefined) {
    return "Review generation failed.";
  }

  return toErrorMessage(error);
}

function formatReviewValidationFailure(reason: string): string {
  const normalizedReason = reason.replace(/\s+/gu, " ").trim();
  const firstSentence =
    normalizedReason.match(/^(.+?\.)\s/u)?.[1] ?? normalizedReason;
  const condensedReason = firstSentence.replace(/:\s.+$/u, "");
  const withoutTrailingPeriod = condensedReason.replace(/\.+$/u, "");
  const reasonSentence = withoutTrailingPeriod.length
    ? withoutTrailingPeriod
    : "Unknown validation error";
  return `Invalid \`${REVIEW_FILENAME}\`. ${reasonSentence}.`;
}

async function assertReviewOutputExists(
  root: string,
  workspacePaths: AgentWorkspacePaths,
  options: {
    eligibleCandidateIds: readonly string[];
  },
): Promise<void> {
  const { eligibleCandidateIds } = options;
  const stderrDisplay = normalizePathForDisplay(
    relativeToRoot(root, workspacePaths.stderrPath),
  );
  const reviewHint = `Inspect \`${stderrDisplay}\` to diagnose the reviewer failure.`;
  const reviewStagedPath = join(workspacePaths.workspacePath, REVIEW_FILENAME);
  let reviewContent: string;
  try {
    reviewContent = await readFile(reviewStagedPath, "utf8");
    if (reviewContent.trim().length === 0) {
      throw new ReviewGenerationFailedError(
        [`Required reviewer artifact is empty: \`${REVIEW_FILENAME}\`.`],
        [reviewHint],
      );
    }
  } catch (error) {
    if (error instanceof ReviewGenerationFailedError) {
      throw error;
    }
    const detail = toErrorMessage(error).trim();
    const detailLine =
      detail.length > 0
        ? `Read failure for \`${REVIEW_FILENAME}\`: ${detail}.`
        : undefined;
    throw new ReviewGenerationFailedError(
      [
        `Required reviewer artifact is missing: \`${REVIEW_FILENAME}\`.`,
        ...(detailLine ? [detailLine] : []),
      ],
      [reviewHint],
    );
  }

  const recommendationStagedPath = join(
    workspacePaths.workspacePath,
    REVIEW_RECOMMENDATION_FILENAME,
  );

  let recommendationContent: string;
  try {
    recommendationContent = await readFile(recommendationStagedPath, "utf8");
  } catch (error) {
    const detail = toErrorMessage(error).trim();
    const detailLine =
      detail.length > 0
        ? `Read failure for \`${REVIEW_RECOMMENDATION_FILENAME}\`: ${detail}.`
        : undefined;
    throw new ReviewGenerationFailedError(
      [
        `Required reviewer artifact is missing: \`${REVIEW_RECOMMENDATION_FILENAME}\`.`,
        ...(detailLine ? [detailLine] : []),
      ],
      [reviewHint],
    );
  }

  if (recommendationContent.trim().length === 0) {
    throw new ReviewGenerationFailedError(
      [
        `Required reviewer artifact is empty: \`${REVIEW_RECOMMENDATION_FILENAME}\`.`,
      ],
      [reviewHint],
    );
  }

  if (eligibleCandidateIds.length === 0) {
    throw new ReviewGenerationFailedError(
      [`Review output validation failed for \`${REVIEW_FILENAME}\`.`],
      ["Re-run `voratiq review` after a successful run."],
    );
  }

  let parsedRecommendation: ReturnType<typeof parseReviewRecommendation>;
  try {
    parsedRecommendation = parseReviewRecommendation(recommendationContent);
  } catch (error) {
    const detail = toErrorMessage(error);
    throw new ReviewGenerationFailedError(
      [`Invalid \`${REVIEW_RECOMMENDATION_FILENAME}\`.`, detail],
      [reviewHint],
    );
  }

  try {
    const validatedOutput = validateReviewOutputContract({
      reviewMarkdown: reviewContent,
      eligibleCandidateIds,
    });
    assertRecommendationMatchesRanking({
      recommendation: parsedRecommendation,
      ranking: validatedOutput.ranking,
    });
  } catch (error) {
    throw new ReviewGenerationFailedError(
      [formatReviewValidationFailure(toErrorMessage(error))],
      [reviewHint],
    );
  }
}

async function prepareSharedBlindedReviewInputs(options: {
  root: string;
  reviewId: string;
  run: RunRecordEnhanced;
}): Promise<BlindedReviewSessionInputs> {
  const { root, reviewId, run } = options;

  const eligibleAgents = await resolveEligibleReviewCandidateAgents({
    root,
    run,
  });

  if (eligibleAgents.length === 0) {
    throw new ReviewNoEligibleCandidatesError();
  }

  const sharedRootAbsolute = resolveWorkspacePath(
    root,
    VORATIQ_REVIEWS_SESSIONS_DIR,
    reviewId,
    ".shared",
  );
  const sharedInputsAbsolute = join(sharedRootAbsolute, "inputs");
  await mkdir(sharedInputsAbsolute, { recursive: true });

  const stagedSpecAbsolute = join(sharedInputsAbsolute, "spec.md");
  const specAbsolute = resolvePath(root, run.spec.path);
  await mkdir(dirname(stagedSpecAbsolute), { recursive: true });
  await copyFile(specAbsolute, stagedSpecAbsolute);

  const baseSnapshotAbsolute = join(sharedInputsAbsolute, "base");
  await createDetachedWorktree({
    root,
    worktreePath: baseSnapshotAbsolute,
    baseRevision: run.baseRevisionSha,
  });

  const stagedCandidatesDir = join(sharedInputsAbsolute, "candidates");
  await mkdir(stagedCandidatesDir, { recursive: true });

  const seenAliases = new Set<string>();
  const aliasMap: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;

  const stagedCandidates: Array<{
    candidateId: string;
    agentId: string;
    diffAbsolutePath: string;
    diffRecorded: boolean;
  }> = [];

  for (const eligible of eligibleAgents) {
    const agent = eligible.agent;
    const alias = generateBlindedCandidateAlias({ seen: seenAliases });
    seenAliases.add(alias);
    aliasMap[alias] = agent.agentId;

    const stagedDiffAbsolute = join(stagedCandidatesDir, alias, "diff.patch");
    await mkdir(dirname(stagedDiffAbsolute), { recursive: true });
    await copyFile(eligible.diffSourceAbsolute, stagedDiffAbsolute);

    stagedCandidates.push({
      candidateId: alias,
      agentId: agent.agentId,
      diffAbsolutePath: stagedDiffAbsolute,
      diffRecorded: true,
    });
  }

  return {
    aliasMap,
    sharedRootAbsolute,
    sharedInputsAbsolute,
    stagedSpecAbsolute,
    baseSnapshotAbsolute,
    stagedCandidates,
    worktreesToRemove: [baseSnapshotAbsolute],
  };
}

function buildReviewerBlindedPreparation(options: {
  root: string;
  reviewId: string;
  reviewerAgentId: string;
  reviewerAgentIds: readonly string[];
  workspacePaths: AgentWorkspacePaths;
  sharedInputs: BlindedReviewSessionInputs;
}): BlindedReviewPreparation {
  const {
    root,
    reviewId,
    reviewerAgentId,
    reviewerAgentIds,
    workspacePaths,
    sharedInputs,
  } = options;

  const stagedSpecPath = toRepoRelativeOrThrow(
    root,
    join(workspacePaths.workspacePath, "inputs", "spec.md"),
  );
  const baseSnapshotPath = toRepoRelativeOrThrow(
    root,
    join(workspacePaths.workspacePath, "inputs", "base"),
  );
  const stagedCandidates = sharedInputs.stagedCandidates.map((entry) => ({
    candidateId: entry.candidateId,
    agentId: entry.agentId,
    diffPath: toRepoRelativeOrThrow(
      root,
      join(
        workspacePaths.workspacePath,
        "inputs",
        "candidates",
        entry.candidateId,
        "diff.patch",
      ),
    ),
    diffRecorded: entry.diffRecorded,
  }));

  const protections = buildReviewSandboxProtectedPaths({
    root,
    reviewId,
    reviewerAgentId,
    reviewerAgentIds,
    sharedRootPath: sharedInputs.sharedRootAbsolute,
  });
  const denyWrite = [...protections.denyWrite, sharedInputs.sharedRootAbsolute];

  return {
    enabled: true,
    aliasMap: sharedInputs.aliasMap,
    stagedSpecPath,
    baseSnapshotPath,
    stagedCandidates,
    extraWriteProtectedPaths: denyWrite,
    extraReadProtectedPaths: protections.denyRead,
  };
}

async function attachSharedInputsToReviewerWorkspace(options: {
  workspacePath: string;
  sharedInputsAbsolute: string;
}): Promise<void> {
  const { workspacePath, sharedInputsAbsolute } = options;
  const reviewerInputsPath = join(workspacePath, "inputs");
  await rm(reviewerInputsPath, { recursive: true, force: true }).catch(
    () => {},
  );
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(sharedInputsAbsolute, reviewerInputsPath, linkType);
}

function buildReviewSandboxProtectedPaths(options: {
  root: string;
  reviewId: string;
  reviewerAgentId: string;
  reviewerAgentIds: readonly string[];
  sharedRootPath: string;
}): {
  denyRead: string[];
  denyWrite: string[];
} {
  const { root, reviewId, reviewerAgentId, reviewerAgentIds, sharedRootPath } =
    options;
  const denyRead: string[] = [];
  const denyWrite: string[] = [];
  denyRead.push(resolveWorkspacePath(root, VORATIQ_REVIEWS_FILE));
  denyRead.push(
    resolveWorkspacePath(
      root,
      VORATIQ_REVIEWS_DIR,
      VORATIQ_HISTORY_LOCK_FILENAME,
    ),
  );
  denyRead.push(
    resolveWorkspacePath(
      root,
      VORATIQ_REVIEWS_SESSIONS_DIR,
      reviewId,
      "record.json",
    ),
  );

  const reviewerRoot = resolveWorkspacePath(
    root,
    VORATIQ_REVIEWS_SESSIONS_DIR,
    reviewId,
    reviewerAgentId,
  );
  const sortedReviewerAgentIds = [...reviewerAgentIds].sort((left, right) =>
    left.localeCompare(right),
  );
  for (const peerReviewerAgentId of sortedReviewerAgentIds) {
    const sibling = resolveWorkspacePath(
      root,
      VORATIQ_REVIEWS_SESSIONS_DIR,
      reviewId,
      peerReviewerAgentId,
    );
    if (sibling === reviewerRoot || sibling === sharedRootPath) {
      continue;
    }
    denyRead.push(sibling);
  }

  return {
    denyRead,
    denyWrite,
  };
}

function buildForbiddenCandidateIdentityTokens(options: {
  run: RunRecordEnhanced;
  allowed?: readonly string[];
}): string[] {
  const { run, allowed = [] } = options;
  const allowedTokens = new Set(
    allowed.map((token) => token.toLowerCase().trim()).filter(Boolean),
  );
  const tokens = new Set<string>();
  for (const agent of run.agents) {
    const agentId = agent.agentId.toLowerCase();
    if (!allowedTokens.has(agentId)) {
      tokens.add(agentId);
    }

    const model = agent.model.toLowerCase();
    if (!allowedTokens.has(model)) {
      tokens.add(model);
    }
  }

  return Array.from(tokens).filter((token) => token.length > 0);
}

function assertNoCandidateIdentityLeak(options: {
  prompt: string;
  manifest: unknown;
  forbidden: readonly string[];
}): void {
  const { prompt, manifest, forbidden } = options;
  const promptLower = prompt.toLowerCase();
  const manifestJson = JSON.stringify(manifest);
  const manifestLower = manifestJson.toLowerCase();

  const leaks: string[] = [];
  for (const token of forbidden) {
    if (!token) {
      continue;
    }
    if (
      containsBoundedToken(promptLower, token) ||
      containsBoundedToken(manifestLower, token)
    ) {
      leaks.push(token);
    }
  }

  if (leaks.length > 0) {
    const leakPreview = leaks
      .slice(0, 5)
      .map((token) => `\`${token}\``)
      .join(", ");
    throw new ReviewGenerationFailedError([
      "Blinded review leakage validation failed.",
      `Forbidden candidate identity tokens detected: ${leakPreview}${
        leaks.length > 5 ? ", ..." : ""
      }.`,
    ]);
  }
}

function containsBoundedToken(text: string, token: string): boolean {
  if (!token) {
    return false;
  }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![a-z0-9_-])${escaped}(?![a-z0-9_-])`, "iu");
  return pattern.test(text);
}

function toRepoRelativeOrThrow(root: string, absolutePath: string): string {
  const relative = normalizePathForDisplay(relativeToRoot(root, absolutePath));
  if (!isRepoRelativePath(relative)) {
    throw new Error(`Expected a repo-relative path, got \`${relative}\`.`);
  }
  return relative;
}

async function postProcessBlindedReviewOutputs(options: {
  root: string;
  reviewsFilePath: string;
  reviewId: string;
  workspacePaths: AgentWorkspacePaths;
  aliasMap: Record<string, string>;
}): Promise<void> {
  const { root, reviewsFilePath, reviewId, workspacePaths, aliasMap } = options;
  const stagedRecommendationPath = join(
    workspacePaths.workspacePath,
    REVIEW_RECOMMENDATION_FILENAME,
  );
  const recommendation = parseReviewRecommendation(
    await readFile(stagedRecommendationPath, "utf8"),
  );
  const resolved = resolveBlindedRecommendation({
    recommendation,
    aliasMap,
  });

  await writeFile(
    stagedRecommendationPath,
    `${JSON.stringify(resolved.recommendation, null, 2)}\n`,
    "utf8",
  );

  await assertSessionAliasMapConsistency({
    root,
    reviewsFilePath,
    reviewId,
    expectedAliasMap: aliasMap,
  });
}

function buildReviewOutputPath(options: {
  root: string;
  reviewId: string;
  reviewerAgentId: string;
}): string {
  const { root, reviewId, reviewerAgentId } = options;
  const reviewAbsolutePath = resolveWorkspacePath(
    root,
    VORATIQ_REVIEWS_SESSIONS_DIR,
    reviewId,
    reviewerAgentId,
    "artifacts",
    REVIEW_FILENAME,
  );
  return toRepoRelativeOrThrow(root, reviewAbsolutePath);
}

function assertReviewAliasMapConsistency(options: {
  record: ReviewRecord;
  reviewId: string;
  expectedAliasMap: Record<string, string>;
}): void {
  const { record, reviewId, expectedAliasMap } = options;
  const recordAliasMap = record.blinded?.aliasMap;
  if (!recordAliasMap) {
    throw new ReviewGenerationFailedError([
      `Review session \`${reviewId}\` is missing a blinded alias map.`,
    ]);
  }
  if (!areAliasMapsEqual(recordAliasMap, expectedAliasMap)) {
    throw new ReviewGenerationFailedError([
      "Blinded alias map divergence detected across reviewers in the same session.",
    ]);
  }
}

async function assertSessionAliasMapConsistency(options: {
  root: string;
  reviewsFilePath: string;
  reviewId: string;
  expectedAliasMap: Record<string, string>;
}): Promise<void> {
  const { root, reviewsFilePath, reviewId, expectedAliasMap } = options;
  const records = await readReviewRecords({
    root,
    reviewsFilePath,
    limit: 1,
    predicate: (record) => record.sessionId === reviewId,
  });
  const record = records[0];
  if (!record) {
    throw new ReviewGenerationFailedError([
      `Review session \`${reviewId}\` record not found while validating alias map.`,
    ]);
  }
  assertReviewAliasMapConsistency({
    record,
    reviewId,
    expectedAliasMap,
  });
}

function areAliasMapsEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const rightEntries = Object.entries(right).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (let index = 0; index < leftEntries.length; index += 1) {
    const leftEntry = leftEntries[index];
    const rightEntry = rightEntries[index];
    if (!leftEntry || !rightEntry) {
      return false;
    }
    if (leftEntry[0] !== rightEntry[0] || leftEntry[1] !== rightEntry[1]) {
      return false;
    }
  }
  return true;
}
