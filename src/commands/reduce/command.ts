import { executeCompetitionWithAdapter } from "../../competition/command-adapter.js";
import type { ResolvedExtraContextFile } from "../../competition/shared/extra-context.js";
import { createTeardownController } from "../../competition/shared/teardown.js";
import { AgentNotFoundError } from "../../configs/agents/errors.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import {
  createReduceCompetitionAdapter,
  type ReductionCompetitionExecution,
} from "../../domain/reduce/competition/adapter.js";
import type {
  ReductionRecord,
  ReductionTarget,
} from "../../domain/reduce/model/types.js";
import {
  appendReductionRecord,
  flushReductionRecordBuffer,
  readReductionRecords,
} from "../../domain/reduce/persistence/adapter.js";
import { buildPersistedExtraContextFields } from "../../extra-context/contract.js";
import { loadOperatorEnvironment } from "../../preflight/environment.js";
import { prepareConfiguredOperatorReadiness } from "../../preflight/operator.js";
import type { ReduceProgressRenderer } from "../../render/transcripts/reduce.js";
import { toErrorMessage } from "../../utils/errors.js";
import {
  normalizePathForDisplay,
  relativeToRoot,
  resolvePath,
} from "../../utils/path.js";
import {
  REDUCTION_DATA_FILENAME,
  REDUCTION_FILENAME,
} from "../../workspace/constants.js";
import { resolveEffectiveMaxParallel } from "../shared/max-parallel.js";
import { resolveReductionCompetitors } from "../shared/resolve-reduction-competitors.js";
import { generateSessionId } from "../shared/session-id.js";
import {
  ReduceAgentNotFoundError,
  ReduceGenerationFailedError,
  ReducePreflightError,
} from "./errors.js";
import { finalizeActiveReduce, registerActiveReduce } from "./lifecycle.js";
import { assertReductionTargetEligible } from "./targets.js";

export interface ReduceCommandInput {
  root: string;
  specsFilePath: string;
  runsFilePath: string;
  reductionsFilePath: string;
  messagesFilePath: string;
  verificationsFilePath: string;
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
    reductionsFilePath,
    messagesFilePath,
    verificationsFilePath,
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
    reductionsFilePath,
    messagesFilePath,
    verificationsFilePath,
    target,
  });

  const reducerPlan = resolveReduceAgentPlan({
    root,
    agentIds,
    agentOverrideFlag,
    profileName,
  });

  const preflight = await prepareConfiguredOperatorReadiness({
    root,
    resolvedAgentIds: reducerPlan.agentIds,
    includeEnvironment: false,
  });
  if (preflight.issues.length > 0) {
    throw new ReducePreflightError(
      preflight.issues,
      preflight.preProviderIssueCount,
    );
  }
  const reducers = preflight.agents;
  const environment = loadOperatorEnvironment({ root });
  const reductionId = generateSessionId();
  const createdAt = new Date().toISOString();
  const effectiveMaxParallel = resolveEffectiveMaxParallel({
    competitorCount: reducers.length,
    requestedMaxParallel,
  });
  const teardown = createTeardownController(`reduce \`${reductionId}\``);
  const initialRecord: ReductionRecord = {
    sessionId: reductionId,
    target,
    createdAt,
    status: "queued",
    reducers: reducers.map((reducer) => ({
      agentId: reducer.id,
      status: "queued",
      outputPath: buildReductionOutputPath({
        root,
        reductionId,
        reducerAgentId: reducer.id,
      }),
      dataPath: buildReductionDataPath({
        root,
        reductionId,
        reducerAgentId: reducer.id,
      }),
    })),
    ...buildPersistedExtraContextFields(extraContextFiles),
  };

  registerActiveReduce({
    root,
    reductionsFilePath,
    reductionId,
    initialRecord,
    teardown,
  });

  try {
    await appendReductionRecord({
      root,
      reductionsFilePath,
      record: initialRecord,
    });
    renderer?.begin({
      reductionId,
      createdAt,
      workspacePath: `.voratiq/reduce/sessions/${reductionId}`,
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
          messagesFilePath,
          verificationsFilePath,
          target,
          environment,
          extraContextFiles,
          renderer,
          teardown,
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

    renderer?.complete(persistedRecord.status, {
      startedAt: persistedRecord.startedAt,
      completedAt: persistedRecord.completedAt,
    });

    return {
      reductionId,
      target,
      reducerAgentIds: reducers.map((reducer) => reducer.id),
      reductions: reductionResults,
    };
  } finally {
    await finalizeActiveReduce(reductionId);
  }
}

function resolveReduceAgentPlan(options: {
  agentIds?: readonly string[];
  root: string;
  agentOverrideFlag?: string;
  profileName?: string;
}): {
  readonly agentIds: readonly string[];
  readonly competitors: readonly AgentDefinition[];
} {
  const { agentIds, root, agentOverrideFlag, profileName } = options;
  try {
    return resolveReductionCompetitors({
      root,
      cliAgentIds: agentIds,
      cliOverrideFlag: agentOverrideFlag,
      profileName,
      includeDefinitions: false,
    });
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      throw new ReduceAgentNotFoundError(error.agentId);
    }
    throw error;
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

function buildReductionOutputPath(options: {
  root: string;
  reductionId: string;
  reducerAgentId: string;
}): string {
  const { root, reductionId, reducerAgentId } = options;
  return normalizePathForDisplay(
    relativeToRoot(
      root,
      resolvePath(
        root,
        `.voratiq/reduce/sessions/${reductionId}/${reducerAgentId}/artifacts/${REDUCTION_FILENAME}`,
      ),
    ),
  );
}

function buildReductionDataPath(options: {
  root: string;
  reductionId: string;
  reducerAgentId: string;
}): string {
  const { root, reductionId, reducerAgentId } = options;
  return normalizePathForDisplay(
    relativeToRoot(
      root,
      resolvePath(
        root,
        `.voratiq/reduce/sessions/${reductionId}/${reducerAgentId}/artifacts/${REDUCTION_DATA_FILENAME}`,
      ),
    ),
  );
}
