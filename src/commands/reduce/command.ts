import { verifyAgentProviders } from "../../agents/runtime/auth.js";
import { executeCompetitionWithAdapter } from "../../competition/command-adapter.js";
import { AgentNotFoundError } from "../../configs/agents/errors.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import { loadEnvironmentConfig } from "../../configs/environment/loader.js";
import {
  createReduceCompetitionAdapter,
  type ReductionCompetitionExecution,
} from "../../domains/reductions/competition/adapter.js";
import type {
  ReductionRecord,
  ReductionTarget,
} from "../../domains/reductions/model/types.js";
import {
  flushReductionRecordBuffer,
  readReductionRecords,
} from "../../domains/reductions/persistence/adapter.js";
import type { ReduceProgressRenderer } from "../../render/transcripts/reduce.js";
import { toErrorMessage } from "../../utils/errors.js";
import type { ResolvedExtraContextFile } from "../../competition/shared/extra-context.js";
import { resolveEffectiveMaxParallel } from "../shared/max-parallel.js";
import { resolveReductionCompetitors } from "../shared/resolve-reduction-competitors.js";
import { generateSessionId } from "../shared/session-id.js";
import {
  ReduceAgentNotFoundError,
  ReduceGenerationFailedError,
  ReducePreflightError,
} from "./errors.js";
import { assertReductionTargetEligible } from "./targets.js";

export interface ReduceCommandInput {
  root: string;
  specsFilePath: string;
  runsFilePath: string;
  reviewsFilePath: string;
  reductionsFilePath: string;
  target: ReductionTarget;
  agentIds?: readonly string[];
  agentOverrideFlag?: string;
  profileName?: string;
  maxParallel?: number;
  extraContextFiles?: readonly ResolvedExtraContextFile[];
  renderer?: ReduceProgressRenderer;
}

export interface ReduceCommandResult {
  reductionId: string;
  target: ReductionTarget;
  reducerAgentIds: readonly string[];
  reductions: readonly ReductionCompetitionExecution[];
}

export async function executeReduceCommand(
  input: ReduceCommandInput,
): Promise<ReduceCommandResult> {
  const {
    root,
    specsFilePath,
    runsFilePath,
    reviewsFilePath,
    reductionsFilePath,
    target,
    agentIds,
    agentOverrideFlag,
    profileName,
    maxParallel: requestedMaxParallel,
    extraContextFiles = [],
    renderer,
  } = input;

  await assertReductionTargetEligible({
    root,
    specsFilePath,
    runsFilePath,
    reviewsFilePath,
    reductionsFilePath,
    target,
  });

  const reducers = resolveReduceAgents({
    root,
    agentIds,
    agentOverrideFlag,
    profileName,
  });

  await assertReducePreflight(reducers);

  const environment = loadEnvironmentConfig({ root });
  const reductionId = generateSessionId();
  const createdAt = new Date().toISOString();
  const effectiveMaxParallel = resolveEffectiveMaxParallel({
    competitorCount: reducers.length,
    requestedMaxParallel,
  });

  renderer?.begin({
    reductionId,
    createdAt,
    sourceLabel: mapReduceSourceLabel(target.type),
    sourcePath: mapReduceSourcePath(target),
    workspacePath: `.voratiq/reductions/sessions/${reductionId}`,
    status: "running",
  });

  let executionError: unknown;
  let reductionResults: ReductionCompetitionExecution[] | undefined;

  try {
    reductionResults = await executeCompetitionWithAdapter({
      candidates: reducers,
      maxParallel: effectiveMaxParallel,
      adapter: createReduceCompetitionAdapter({
        root,
        reductionId,
        createdAt,
        reductionsFilePath,
        specsFilePath,
        runsFilePath,
        reviewsFilePath,
        target,
        environment,
        extraContextFiles,
        renderer,
      }),
    });
  } catch (error) {
    executionError = error;
  } finally {
    await flushReductionRecordBuffer({
      reductionsFilePath,
      sessionId: reductionId,
    }).catch(() => {});
  }

  if (executionError) {
    renderer?.complete("failed");
    throw new ReduceGenerationFailedError([
      `Reduction session \`${reductionId}\` failed: ${toErrorMessage(executionError)}`,
    ]);
  }

  if (!reductionResults || reductionResults.length === 0) {
    renderer?.complete("failed");
    throw new ReduceGenerationFailedError([
      `Reduction session \`${reductionId}\` did not produce any result.`,
    ]);
  }

  const persistedRecord = await readReductionSessionRecord({
    root,
    reductionsFilePath,
    reductionId,
  });

  if (!persistedRecord) {
    renderer?.complete("failed");
    throw new ReduceGenerationFailedError([
      `Reduction session \`${reductionId}\` record not found after execution.`,
    ]);
  }

  renderer?.complete(persistedRecord.status);

  return {
    reductionId,
    target,
    reducerAgentIds: reducers.map((reducer) => reducer.id),
    reductions: reductionResults,
  };
}

function mapReduceSourceLabel(
  targetType: ReductionTarget["type"],
): "Spec" | "Run" | "Review" | "Reduce" {
  switch (targetType) {
    case "spec":
      return "Spec";
    case "run":
      return "Run";
    case "review":
      return "Review";
    case "reduction":
      return "Reduce";
  }
}

function mapReduceSourcePath(target: ReductionTarget): string {
  switch (target.type) {
    case "spec":
      return `.voratiq/specs/sessions/${target.id}`;
    case "run":
      return `.voratiq/runs/sessions/${target.id}`;
    case "review":
      return `.voratiq/reviews/sessions/${target.id}`;
    case "reduction":
      return `.voratiq/reductions/sessions/${target.id}`;
  }
}

function resolveReduceAgents(options: {
  agentIds?: readonly string[];
  root: string;
  agentOverrideFlag?: string;
  profileName?: string;
}): AgentDefinition[] {
  const { agentIds, root, agentOverrideFlag, profileName } = options;
  try {
    const resolution = resolveReductionCompetitors({
      root,
      cliAgentIds: agentIds,
      cliOverrideFlag: agentOverrideFlag,
      profileName,
    });
    return [...resolution.competitors];
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      throw new ReduceAgentNotFoundError(error.agentId);
    }
    throw error;
  }
}

async function assertReducePreflight(
  agents: readonly AgentDefinition[],
): Promise<void> {
  const providerIssues = await verifyAgentProviders(
    agents.map((agent) => ({
      id: agent.id,
      provider: agent.provider,
    })),
  );

  if (providerIssues.length > 0) {
    throw new ReducePreflightError(providerIssues);
  }
}

async function readReductionSessionRecord(options: {
  root: string;
  reductionsFilePath: string;
  reductionId: string;
}): Promise<ReductionRecord | undefined> {
  const { root, reductionsFilePath, reductionId } = options;
  const records = await readReductionRecords({
    root,
    reductionsFilePath,
    limit: 1,
    predicate: (record) => record.sessionId === reductionId,
  });
  return records[0];
}
