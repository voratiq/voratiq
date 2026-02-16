import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { detectAgentProcessFailureDetail } from "../../agents/runtime/failures.js";
import { runSandboxedAgent } from "../../agents/runtime/harness.js";
import type {
  CompetitionCommandAdapter,
  CompetitionPreparationResult,
} from "../../competition/command-adapter.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../configs/environment/types.js";
import {
  appendReviewRecord,
  finalizeReviewRecord,
  flushReviewRecordBuffer,
} from "../../reviews/records/persistence.js";
import type { ReviewRecord } from "../../reviews/records/types.js";
import type { RunRecordEnhanced } from "../../runs/records/enhanced.js";
import { toErrorMessage } from "../../utils/errors.js";
import { normalizePathForDisplay, relativeToRoot } from "../../utils/path.js";
import {
  type AgentWorkspacePaths,
  scaffoldAgentSessionWorkspace,
} from "../../workspace/layout.js";
import { promoteWorkspaceFile } from "../../workspace/promotion.js";
import {
  REVIEW_ARTIFACT_INFO_FILENAME,
  REVIEW_FILENAME,
  REVIEW_RECOMMENDATION_FILENAME,
  VORATIQ_REVIEWS_DIR,
} from "../../workspace/structure.js";
import { pruneWorkspace } from "../shared/prune.js";
import { ReviewGenerationFailedError } from "./errors.js";
import { buildReviewManifest } from "./manifest.js";
import { buildReviewPrompt } from "./prompt.js";
import { parseReviewRecommendation } from "./recommendation.js";

export type ReviewCompetitionCandidate = AgentDefinition;

export interface PreparedReviewCompetitionCandidate {
  readonly candidate: ReviewCompetitionCandidate;
  readonly workspacePaths: AgentWorkspacePaths;
  readonly prompt: string;
  readonly missingArtifacts: readonly string[];
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
  readonly runWorkspaceAbsolute: string;
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
    runWorkspaceAbsolute,
  } = input;

  let failure: unknown;
  const workspacesToPrune = new Set<string>();

  return {
    prepareCandidates: async (
      candidates,
    ): Promise<
      CompetitionPreparationResult<
        PreparedReviewCompetitionCandidate,
        ReviewCompetitionExecution
      >
    > => {
      try {
        const prepared: PreparedReviewCompetitionCandidate[] = [];

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
          const record: ReviewRecord = {
            sessionId: reviewId,
            runId: run.runId,
            createdAt,
            status: "running",
            agentId: candidate.id,
            outputPath,
          };
          await appendReviewRecord({
            root,
            reviewsFilePath,
            record,
          });

          const buildManifestResult = await buildReviewManifest({
            root,
            run,
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

          const prompt = buildReviewPrompt({
            runId: run.runId,
            runStatus: run.status,
            specPath: run.spec.path,
            baseRevisionSha: run.baseRevisionSha,
            createdAt: run.createdAt,
            completedAt: manifest.run.completedAt,
            artifactInfoPath: REVIEW_ARTIFACT_INFO_FILENAME,
            outputPath: REVIEW_FILENAME,
            repoRootPath: root,
            workspacePath: workspacePaths.workspacePath,
          });

          prepared.push({
            candidate,
            workspacePaths,
            prompt,
            missingArtifacts: [...missingArtifacts],
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
    executeCandidate: async (prepared): Promise<ReviewCompetitionExecution> => {
      const { candidate, workspacePaths, prompt } = prepared;
      const agent = candidate;
      const result = await runSandboxedAgent({
        root,
        sessionId: reviewId,
        agent,
        prompt,
        environment,
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
        extraWriteProtectedPaths: [runWorkspaceAbsolute],
        extraReadProtectedPaths: [],
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

      await assertReviewOutputExists(root, workspacePaths, reviewId);

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
        outputPath: normalizePathForDisplay(
          relativeToRoot(root, workspacePaths.reviewPath),
        ),
        status: "succeeded",
        missingArtifacts: [...prepared.missingArtifacts],
      };
    },
    captureExecutionFailure: ({ error }) => {
      failure = failure ?? error;
      return undefined;
    },
    finalizeCompetition: async () => {
      const failed = failure !== undefined;

      if (failed) {
        await finalizeReviewRecord({
          root,
          reviewsFilePath,
          sessionId: reviewId,
          status: "failed",
          error: toReviewFailureDetail(failure),
        }).catch(() => {});
        await flushReviewRecordBuffer({
          reviewsFilePath,
          sessionId: reviewId,
        }).catch(() => {});
      } else {
        await finalizeReviewRecord({
          root,
          reviewsFilePath,
          sessionId: reviewId,
          status: "succeeded",
        });
        await flushReviewRecordBuffer({
          reviewsFilePath,
          sessionId: reviewId,
        });
      }

      for (const workspacePath of workspacesToPrune) {
        await pruneWorkspace(workspacePath);
      }
    },
    sortResults: compareReviewExecutionsByAgentId,
  };
}

function compareReviewExecutionsByAgentId(
  left: ReviewCompetitionExecution,
  right: ReviewCompetitionExecution,
): number {
  return left.agentId.localeCompare(right.agentId);
}

function toReviewFailureDetail(error: unknown): string {
  if (
    error instanceof ReviewGenerationFailedError &&
    error.detailLines.length > 0
  ) {
    return error.detailLines.join("\n");
  }

  if (error === undefined) {
    return "Review generation failed.";
  }

  return toErrorMessage(error);
}

async function assertReviewOutputExists(
  root: string,
  workspacePaths: AgentWorkspacePaths,
  reviewId: string,
): Promise<void> {
  const reviewStagedPath = join(workspacePaths.workspacePath, REVIEW_FILENAME);
  try {
    const reviewContent = await readFile(reviewStagedPath, "utf8");
    if (reviewContent.trim().length === 0) {
      const stderrDisplay = normalizePathForDisplay(
        relativeToRoot(root, workspacePaths.stderrPath),
      );
      throw new ReviewGenerationFailedError(
        [`Missing output: ${REVIEW_FILENAME}`],
        [`Review session: ${reviewId}`, `See stderr: ${stderrDisplay}`],
      );
    }
  } catch (error) {
    if (error instanceof ReviewGenerationFailedError) {
      throw error;
    }
    const detail = toErrorMessage(error);
    const stderrDisplay = normalizePathForDisplay(
      relativeToRoot(root, workspacePaths.stderrPath),
    );
    throw new ReviewGenerationFailedError(
      [`Missing output: ${REVIEW_FILENAME}`],
      [`Review session: ${reviewId}`, detail, `See stderr: ${stderrDisplay}`],
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
    const detail = toErrorMessage(error);
    const stderrDisplay = normalizePathForDisplay(
      relativeToRoot(root, workspacePaths.stderrPath),
    );
    throw new ReviewGenerationFailedError(
      [`Missing output: ${REVIEW_RECOMMENDATION_FILENAME}`],
      [`Review session: ${reviewId}`, detail, `See stderr: ${stderrDisplay}`],
    );
  }

  if (recommendationContent.trim().length === 0) {
    const stderrDisplay = normalizePathForDisplay(
      relativeToRoot(root, workspacePaths.stderrPath),
    );
    throw new ReviewGenerationFailedError(
      [`Invalid output: ${REVIEW_RECOMMENDATION_FILENAME}`],
      [
        `Review session: ${reviewId}`,
        "Recommendation artifact is empty.",
        `See stderr: ${stderrDisplay}`,
      ],
    );
  }

  try {
    parseReviewRecommendation(recommendationContent);
  } catch (error) {
    const detail = toErrorMessage(error);
    const stderrDisplay = normalizePathForDisplay(
      relativeToRoot(root, workspacePaths.stderrPath),
    );
    throw new ReviewGenerationFailedError(
      [`Invalid output: ${REVIEW_RECOMMENDATION_FILENAME}`],
      [`Review session: ${reviewId}`, detail, `See stderr: ${stderrDisplay}`],
    );
  }
}
