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
import { resolveStageCompetitors } from "../shared/resolve-stage-competitors.js";
import { generateSessionId } from "../shared/session-id.js";
import { createReviewCompetitionAdapter } from "./competition-adapter.js";
import {
  ReviewAgentNotFoundError,
  ReviewGenerationFailedError,
} from "./errors.js";

export interface ReviewCommandInput {
  root: string;
  runsFilePath: string;
  reviewsFilePath: string;
  runId: string;
  agentId?: string;
}

export interface ReviewCommandResult {
  reviewId: string;
  runRecord: RunRecordEnhanced;
  agentId: string;
  outputPath: string;
  missingArtifacts: string[];
}

export async function executeReviewCommand(
  input: ReviewCommandInput,
): Promise<ReviewCommandResult> {
  const { root, runsFilePath, reviewsFilePath, runId, agentId } = input;

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

  const agent = resolveReviewAgent({ agentId, root });
  const environment = loadEnvironmentConfig({ root });
  const reviewId = generateSessionId();
  const createdAt = new Date().toISOString();

  const competitors = [agent];

  const runWorkspaceAbsolute = resolveRunWorkspacePaths(root, runId).absolute;

  const reviewResults = await executeCompetitionWithAdapter({
    candidates: competitors,
    maxParallel: 1,
    adapter: createReviewCompetitionAdapter({
      root,
      reviewId,
      createdAt,
      reviewsFilePath,
      run: enhanced,
      environment,
      runWorkspaceAbsolute,
    }),
  }).catch((error) => {
    if (error instanceof ReviewGenerationFailedError) {
      throw error;
    }

    const detail = toErrorMessage(error);
    throw new ReviewGenerationFailedError([detail]);
  });

  const selectedResult = reviewResults[0];
  if (!selectedResult) {
    throw new ReviewGenerationFailedError([
      `Review session ${reviewId} did not produce any result.`,
    ]);
  }

  return {
    reviewId,
    runRecord: enhanced,
    agentId: selectedResult.agentId,
    outputPath: selectedResult.outputPath,
    missingArtifacts: [...selectedResult.missingArtifacts],
  };
}

function resolveReviewAgent(options: {
  agentId?: string;
  root: string;
}): AgentDefinition {
  const { agentId, root } = options;
  try {
    const resolution = resolveStageCompetitors({
      root,
      stageId: "review",
      cliAgentIds: agentId ? [agentId] : undefined,
      enforceSingleCompetitor: true,
    });
    const resolvedAgent = resolution.competitors[0];
    if (!resolvedAgent) {
      throw new Error("Expected a single resolved review agent.");
    }
    return resolvedAgent;
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      throw new ReviewAgentNotFoundError(error.agentId);
    }
    throw error;
  }
}
