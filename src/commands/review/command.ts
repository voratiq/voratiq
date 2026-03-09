import { verifyAgentProviders } from "../../agents/runtime/auth.js";
import { teardownSessionAuth } from "../../agents/runtime/registry.js";
import { executeCompetitionWithAdapter } from "../../competition/command-adapter.js";
import { AgentNotFoundError } from "../../configs/agents/errors.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import { loadEnvironmentConfig } from "../../configs/environment/loader.js";
import {
  createReviewCompetitionAdapter,
  type ReviewCompetitionExecution,
} from "../../domains/reviews/competition/adapter.js";
import type { RunRecordEnhanced } from "../../domains/runs/model/enhanced.js";
import { buildRunRecordView } from "../../domains/runs/model/enhanced.js";
import { RunRecordNotFoundError } from "../../domains/runs/model/errors.js";
import { fetchRunsSafely } from "../../domains/runs/persistence/adapter.js";
import type { ReviewProgressRenderer } from "../../render/transcripts/review.js";
import { toErrorMessage } from "../../utils/errors.js";
import { normalizePathForDisplay, relativeToRoot } from "../../utils/path.js";
import {
  resolveWorkspacePath,
  VORATIQ_REVIEWS_SESSIONS_DIR,
} from "../../workspace/structure.js";
import { RunNotFoundCliError } from "../errors.js";
import type { ResolvedExtraContextFile } from "../shared/extra-context.js";
import { resolveEffectiveMaxParallel } from "../shared/max-parallel.js";
import { resolveStageCompetitors } from "../shared/resolve-stage-competitors.js";
import { generateSessionId } from "../shared/session-id.js";
import {
  ReviewAgentNotFoundError,
  ReviewError,
  ReviewGenerationFailedError,
  ReviewPreflightError,
} from "./errors.js";
import { clearActiveReview, registerActiveReview } from "./lifecycle.js";

export interface ReviewCommandInput {
  root: string;
  runsFilePath: string;
  reviewsFilePath: string;
  runId: string;
  agentIds?: readonly string[];
  agentOverrideFlag?: string;
  profileName?: string;
  maxParallel?: number;
  extraContextFiles?: readonly ResolvedExtraContextFile[];
  renderer?: ReviewProgressRenderer;
}

export interface ReviewCommandResult {
  reviewId: string;
  runRecord: RunRecordEnhanced;
  reviews: readonly ReviewCompetitionExecution[];
  agentId: string;
  outputPath: string;
  missingArtifacts: string[];
}

export async function executeReviewCommand(
  input: ReviewCommandInput,
): Promise<ReviewCommandResult> {
  const {
    root,
    runsFilePath,
    reviewsFilePath,
    runId,
    agentIds,
    agentOverrideFlag,
    profileName,
    maxParallel: requestedMaxParallel,
    extraContextFiles = [],
    renderer,
  } = input;

  const { records } = await fetchRunsSafely({
    root,
    runsFilePath,
    runId,
    filters: { includeDeleted: true },
  }).catch((error) => {
    if (error instanceof RunRecordNotFoundError) {
      throw new RunNotFoundCliError(runId);
    }
    throw error;
  });

  const runRecord = records[0];
  if (!runRecord) {
    throw new RunNotFoundCliError(runId);
  }

  const enhanced = await buildRunRecordView(runRecord, {
    workspaceRoot: root,
  });

  const agents = resolveReviewAgents({
    agentIds,
    root,
    agentOverrideFlag,
    profileName,
  });
  await assertReviewPreflight(agents);

  const environment = loadEnvironmentConfig({ root });
  const reviewId = generateSessionId();
  const createdAt = new Date().toISOString();

  const effectiveMaxParallel = resolveEffectiveMaxParallel({
    competitorCount: agents.length,
    requestedMaxParallel,
  });

  renderer?.begin({
    runId: enhanced.runId,
    reviewId,
    createdAt,
    workspacePath: normalizePathForDisplay(
      relativeToRoot(
        root,
        resolveWorkspacePath(root, VORATIQ_REVIEWS_SESSIONS_DIR, reviewId),
      ),
    ),
    status: "running",
  });

  registerActiveReview({
    root,
    reviewsFilePath,
    reviewId,
    reviewerAgentIds: agents.map((agent) => agent.id),
  });

  let executionError: unknown;
  let cleanupError: unknown;
  let reviewResults: ReviewCompetitionExecution[] | undefined;

  try {
    reviewResults = await executeCompetitionWithAdapter({
      candidates: agents,
      maxParallel: effectiveMaxParallel,
      adapter: createReviewCompetitionAdapter({
        root,
        reviewId,
        createdAt,
        reviewsFilePath,
        run: enhanced,
        environment,
        extraContextFiles,
        renderer,
      }),
    });
  } catch (error) {
    executionError = error;
  } finally {
    try {
      await teardownSessionAuth(reviewId);
    } catch (error) {
      cleanupError = error;
    } finally {
      clearActiveReview(reviewId);
    }
  }

  if (cleanupError) {
    renderer?.complete("failed");
    if (executionError) {
      throw new ReviewGenerationFailedError([
        `Review session \`${reviewId}\` failed and cleanup also failed.`,
        `Execution error: ${toErrorMessage(executionError)}`,
        `Cleanup error: ${toErrorMessage(cleanupError)}`,
      ]);
    }
    throw new ReviewGenerationFailedError([
      `Review session \`${reviewId}\` cleanup failed.`,
      `Cleanup error: ${toErrorMessage(cleanupError)}`,
    ]);
  }

  if (executionError) {
    renderer?.complete("failed");
    if (executionError instanceof ReviewError) {
      throw executionError;
    }
    const detail = toErrorMessage(executionError);
    throw new ReviewGenerationFailedError([detail]);
  }

  if (!reviewResults) {
    renderer?.complete("failed");
    throw new ReviewGenerationFailedError([
      `Review session \`${reviewId}\` did not produce any result.`,
    ]);
  }

  const selectedResult = reviewResults[0];
  if (!selectedResult) {
    renderer?.complete("failed");
    throw new ReviewGenerationFailedError([
      `Review session \`${reviewId}\` did not produce any result.`,
    ]);
  }

  const finalStatus = reviewResults.some((result) => result.status === "failed")
    ? "failed"
    : "succeeded";
  renderer?.complete(finalStatus);

  return {
    reviewId,
    runRecord: enhanced,
    reviews: reviewResults,
    agentId: selectedResult.agentId,
    outputPath: selectedResult.outputPath,
    missingArtifacts: [...selectedResult.missingArtifacts],
  };
}

function resolveReviewAgents(options: {
  agentIds?: readonly string[];
  root: string;
  agentOverrideFlag?: string;
  profileName?: string;
}): AgentDefinition[] {
  const { agentIds, root, agentOverrideFlag, profileName } = options;
  try {
    const resolution = resolveStageCompetitors({
      root,
      stageId: "review",
      cliAgentIds: agentIds,
      cliOverrideFlag: agentOverrideFlag,
      profileName,
    });
    return [...resolution.competitors];
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      throw new ReviewAgentNotFoundError(error.agentId);
    }
    throw error;
  }
}

async function assertReviewPreflight(
  agents: readonly AgentDefinition[],
): Promise<void> {
  const providerIssues = await verifyAgentProviders(
    agents.map((agent) => ({
      id: agent.id,
      provider: agent.provider,
    })),
  );

  if (providerIssues.length > 0) {
    throw new ReviewPreflightError(providerIssues);
  }
}
