import { verifyAgentProviders } from "../../agents/runtime/auth.js";
import { teardownSessionAuth } from "../../agents/runtime/registry.js";
import { executeCompetitionWithAdapter } from "../../competition/command-adapter.js";
import { AgentNotFoundError } from "../../configs/agents/errors.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import { loadEnvironmentConfig } from "../../configs/environment/loader.js";
import type { RunRecordEnhanced } from "../../runs/records/enhanced.js";
import { buildRunRecordView } from "../../runs/records/enhanced.js";
import { RunRecordNotFoundError } from "../../runs/records/errors.js";
import { fetchRunsSafely } from "../../runs/records/persistence.js";
import { toErrorMessage } from "../../utils/errors.js";
import { resolveRunWorkspacePaths } from "../../workspace/layout.js";
import { RunNotFoundCliError } from "../errors.js";
import { resolveEffectiveMaxParallel } from "../shared/max-parallel.js";
import { resolveStageCompetitors } from "../shared/resolve-stage-competitors.js";
import { generateSessionId } from "../shared/session-id.js";
import {
  createReviewCompetitionAdapter,
  type ReviewCompetitionExecution,
} from "./competition-adapter.js";
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

  const runWorkspaceAbsolute = resolveRunWorkspacePaths(root, runId).absolute;
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
        runWorkspaceAbsolute,
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
    if (executionError) {
      throw new ReviewGenerationFailedError([
        `Review session ${reviewId} failed and cleanup also failed.`,
        `Execution error: ${toErrorMessage(executionError)}`,
        `Cleanup error: ${toErrorMessage(cleanupError)}`,
      ]);
    }
    throw new ReviewGenerationFailedError([
      `Review session ${reviewId} cleanup failed.`,
      `Cleanup error: ${toErrorMessage(cleanupError)}`,
    ]);
  }

  if (executionError) {
    if (executionError instanceof ReviewError) {
      throw executionError;
    }
    const detail = toErrorMessage(executionError);
    throw new ReviewGenerationFailedError([detail]);
  }

  if (!reviewResults) {
    throw new ReviewGenerationFailedError([
      `Review session ${reviewId} did not produce any result.`,
    ]);
  }

  const selectedResult = reviewResults[0];
  if (!selectedResult) {
    throw new ReviewGenerationFailedError([
      `Review session ${reviewId} did not produce any result.`,
    ]);
  }

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
