import { executeCompetitionWithAdapter } from "../../competition/command-adapter.js";
import type { ResolvedExtraContextFile } from "../../competition/shared/extra-context.js";
import { AgentNotFoundError } from "../../configs/agents/errors.js";
import { loadEnvironmentConfig } from "../../configs/environment/loader.js";
import {
  buildLifecycleStartFields,
  buildOperationLifecycleCompleteFields,
} from "../../domains/shared/lifecycle.js";
import {
  createSpecCompetitionAdapter,
  type SpecCompetitionExecution,
} from "../../domains/specs/competition/adapter.js";
import {
  deriveSpecStatusFromAgents,
  type SpecAgentEntry,
  type SpecRecord,
} from "../../domains/specs/model/types.js";
import {
  appendSpecRecord,
  finalizeSpecRecord,
  flushSpecRecordBuffer,
  rewriteSpecRecord,
} from "../../domains/specs/persistence/adapter.js";
import { buildPersistedExtraContextFields } from "../../extra-context/contract.js";
import type { SpecProgressRenderer } from "../../render/transcripts/spec.js";
import { toErrorMessage } from "../../utils/errors.js";
import { resolveEffectiveMaxParallel } from "../shared/max-parallel.js";
import { resolveStageCompetitors } from "../shared/resolve-stage-competitors.js";
import { generateSessionId } from "../shared/session-id.js";
import { SpecAgentNotFoundError, SpecGenerationFailedError } from "./errors.js";

export interface ExecuteSpecCommandInput {
  root: string;
  specsFilePath: string;
  description: string;
  agentIds?: readonly string[];
  profileName?: string;
  maxParallel?: number;
  title?: string;
  extraContextFiles?: readonly ResolvedExtraContextFile[];
  onStatus?: (message: string) => void;
  renderer?: SpecProgressRenderer;
}

export interface ExecuteSpecCommandResult {
  sessionId: string;
  status: string;
  record: SpecRecord;
  agents: readonly SpecAgentEntry[];
}

export async function executeSpecCommand(
  input: ExecuteSpecCommandInput,
): Promise<ExecuteSpecCommandResult> {
  const {
    root,
    specsFilePath,
    description,
    agentIds: cliAgentIds,
    profileName,
    maxParallel: requestedMaxParallel,
    title: providedTitle,
    extraContextFiles = [],
    onStatus,
    renderer,
  } = input;

  let competitors;
  try {
    const normalizedCliIds =
      cliAgentIds && cliAgentIds.length > 0 ? [...cliAgentIds] : undefined;
    const resolution = resolveStageCompetitors({
      root,
      stageId: "spec",
      cliAgentIds: normalizedCliIds,
      profileName,
    });
    competitors = resolution.competitors;
    if (competitors.length === 0) {
      throw new SpecGenerationFailedError(["Spec agent resolution failed."]);
    }
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      throw new SpecAgentNotFoundError(error.agentId);
    }
    throw error;
  }

  const environment = loadEnvironmentConfig({ root });
  const effectiveMaxParallel = resolveEffectiveMaxParallel({
    competitorCount: competitors.length,
    requestedMaxParallel,
  });

  const specTitle =
    providedTitle && providedTitle.trim().length > 0
      ? providedTitle.trim()
      : undefined;

  const sessionId = generateSessionId();
  const startedAt = new Date().toISOString();
  const createdAt = startedAt;

  const initialAgents: SpecAgentEntry[] = competitors.map((agent) => ({
    agentId: agent.id,
    status: "queued" as const,
  }));

  const record: SpecRecord = {
    sessionId,
    createdAt,
    startedAt,
    status: "running",
    description,
    agents: initialAgents,
    ...buildPersistedExtraContextFields(extraContextFiles),
  };

  await appendSpecRecord({
    root,
    specsFilePath,
    record,
  });
  let currentAgents: SpecAgentEntry[] = [...initialAgents];

  onStatus?.("Generating specification…");
  renderer?.begin({
    sessionId,
    createdAt,
    startedAt,
    workspacePath: `.voratiq/specs/sessions/${sessionId}`,
    status: "running",
  });

  let executionResults: SpecCompetitionExecution[];

  try {
    const baseAdapter = createSpecCompetitionAdapter({
      root,
      sessionId,
      description,
      specTitle,
      environment,
      extraContextFiles,
    });
    executionResults = await executeCompetitionWithAdapter({
      candidates: [...competitors],
      maxParallel: effectiveMaxParallel,
      adapter: {
        ...baseAdapter,
        onPreparationFailure: async (result) => {
          currentAgents = await persistSpecAgentFailure({
            root,
            specsFilePath,
            sessionId,
            agentId: result.agentId,
            tokenUsage: result.tokenUsage,
            error: result.error ?? null,
          });
          const failedAgent = currentAgents.find(
            (agent) => agent.agentId === result.agentId,
          );
          renderer?.update({
            agentId: result.agentId,
            status: "failed",
            startedAt: failedAgent?.startedAt,
            completedAt: failedAgent?.completedAt,
            tokenUsage: result.tokenUsage,
            tokenUsageResult: result.tokenUsageResult,
          });
        },
        onCandidateRunning: async (prepared, index) => {
          await baseAdapter.onCandidateRunning?.(prepared, index);
          currentAgents = await persistSpecAgentRunning({
            root,
            specsFilePath,
            sessionId,
            agentId: prepared.candidate.id,
          });
          const runningAgent = currentAgents.find(
            (agent) => agent.agentId === prepared.candidate.id,
          );
          renderer?.update({
            agentId: prepared.candidate.id,
            status: "running",
            startedAt: runningAgent?.startedAt,
          });
        },
        onCandidateCompleted: async (_prepared, result) => {
          currentAgents = await persistSpecAgentCompletion({
            root,
            specsFilePath,
            sessionId,
            result,
          });
          const completedAgent = currentAgents.find(
            (agent) => agent.agentId === result.agentId,
          );
          renderer?.update({
            agentId: result.agentId,
            status: completedAgent?.status ?? result.status,
            startedAt: completedAgent?.startedAt,
            completedAt: completedAgent?.completedAt,
            tokenUsage: result.tokenUsage,
            tokenUsageResult: result.tokenUsageResult,
          });
        },
      },
    });
  } catch (error) {
    const detail = toErrorMessage(error);
    await finalizeSpecRecord({
      root,
      specsFilePath,
      sessionId,
      status: "failed",
      error: detail,
    });
    renderer?.complete("failed");
    await flushSpecRecordBuffer({ specsFilePath, sessionId });
    throw new SpecGenerationFailedError([detail]);
  }

  const agentEntries = currentAgents.some(
    (agent) => agent.status === "succeeded" || agent.status === "failed",
  )
    ? currentAgents
    : mapExecutionResultsToSpecAgents(executionResults, startedAt);

  // Derive session status from agent outcomes.
  const sessionStatus = deriveSpecStatusFromAgents(
    agentEntries.map((a) => a.status),
  );

  const latestRecord = await finalizeSpecRecord({
    root,
    specsFilePath,
    sessionId,
    status: sessionStatus,
    agents: agentEntries,
    error:
      sessionStatus === "failed" ? collectAgentErrors(agentEntries) : undefined,
  });

  await flushSpecRecordBuffer({ specsFilePath, sessionId });
  renderer?.complete(latestRecord.status, {
    startedAt: latestRecord.startedAt,
    completedAt: latestRecord.completedAt,
  });

  if (sessionStatus === "failed") {
    const errorDetails = agentEntries
      .filter((a) => a.error)
      .map((a) => `${a.agentId}: ${a.error}`);
    throw new SpecGenerationFailedError(
      errorDetails.length > 0
        ? errorDetails
        : ["All agents failed to generate a specification."],
    );
  }

  return {
    sessionId,
    status: latestRecord.status,
    record: latestRecord,
    agents: latestRecord.agents,
  };
}

function collectAgentErrors(agents: readonly SpecAgentEntry[]): string | null {
  const errors = agents
    .filter((a) => a.error)
    .map((a) => `${a.agentId}: ${a.error}`);
  return errors.length > 0 ? errors.join("; ") : null;
}

async function persistSpecAgentRunning(options: {
  root: string;
  specsFilePath: string;
  sessionId: string;
  agentId: string;
}): Promise<SpecAgentEntry[]> {
  const { root, specsFilePath, sessionId, agentId } = options;
  const timestamp = new Date().toISOString();
  const updated = await rewriteSpecRecord({
    root,
    specsFilePath,
    sessionId,
    mutate: (record) => ({
      ...record,
      agents: record.agents.map((agent) =>
        agent.agentId === agentId
          ? {
              ...agent,
              status: "running",
              ...buildLifecycleStartFields({
                existingStartedAt: agent.startedAt,
                timestamp,
              }),
              completedAt: undefined,
              error: null,
            }
          : agent,
      ),
    }),
  });
  return [...updated.agents];
}

async function persistSpecAgentCompletion(options: {
  root: string;
  specsFilePath: string;
  sessionId: string;
  result: SpecCompetitionExecution;
}): Promise<SpecAgentEntry[]> {
  const { root, specsFilePath, sessionId, result } = options;
  const completedAt = new Date().toISOString();
  const updated = await rewriteSpecRecord({
    root,
    specsFilePath,
    sessionId,
    mutate: (record) => ({
      ...record,
      agents: record.agents.map((agent) => {
        if (agent.agentId !== result.agentId) {
          return agent;
        }
        const startedAt = buildLifecycleStartFields({
          existingStartedAt: agent.startedAt,
          timestamp: completedAt,
        }).startedAt;
        const completeFields = buildOperationLifecycleCompleteFields({
          existing: {
            startedAt,
            completedAt: agent.completedAt,
          },
          completedAt,
        });
        if (result.status === "succeeded") {
          return {
            ...agent,
            status: "succeeded",
            ...completeFields,
            outputPath: result.outputPath,
            dataPath: result.dataPath,
            tokenUsage: result.tokenUsage,
            error: null,
          };
        }
        return {
          ...agent,
          status: "failed",
          ...completeFields,
          tokenUsage: result.tokenUsage,
          error: result.error ?? null,
        };
      }),
    }),
  });
  return [...updated.agents];
}

async function persistSpecAgentFailure(options: {
  root: string;
  specsFilePath: string;
  sessionId: string;
  agentId: string;
  tokenUsage?: SpecCompetitionExecution["tokenUsage"];
  error?: string | null;
}): Promise<SpecAgentEntry[]> {
  const { root, specsFilePath, sessionId, agentId, tokenUsage, error } =
    options;
  const completedAt = new Date().toISOString();
  const updated = await rewriteSpecRecord({
    root,
    specsFilePath,
    sessionId,
    mutate: (record) => ({
      ...record,
      agents: record.agents.map((agent) => {
        if (agent.agentId !== agentId) {
          return agent;
        }
        const startedAt = buildLifecycleStartFields({
          existingStartedAt: agent.startedAt,
          timestamp: completedAt,
        }).startedAt;
        const completeFields = buildOperationLifecycleCompleteFields({
          existing: {
            startedAt,
            completedAt: agent.completedAt,
          },
          completedAt,
        });
        return {
          ...agent,
          status: "failed",
          ...completeFields,
          ...(tokenUsage ? { tokenUsage } : {}),
          error: error ?? null,
        };
      }),
    }),
  });
  return [...updated.agents];
}

function mapExecutionResultsToSpecAgents(
  executionResults: readonly SpecCompetitionExecution[],
  startedAt: string,
): SpecAgentEntry[] {
  return executionResults.map((result): SpecAgentEntry => {
    const completedAt = new Date().toISOString();
    const base: Pick<SpecAgentEntry, "agentId" | "startedAt" | "completedAt"> =
      {
        agentId: result.agentId,
        startedAt,
        completedAt,
      };
    if (result.status === "succeeded") {
      return {
        ...base,
        status: "succeeded",
        outputPath: result.outputPath,
        dataPath: result.dataPath,
        tokenUsage: result.tokenUsage,
      };
    }
    return {
      ...base,
      status: "failed",
      tokenUsage: result.tokenUsage,
      error: result.error ?? null,
    };
  });
}
