import type { AgentDefinition } from "../../../configs/agents/types.js";
import type { RunProgressRenderer } from "../../../render/transcripts/run.js";
import { emitStageProgressEvent } from "../../../render/transcripts/stage-progress.js";
import { normalizeDiffStatistics } from "../../../utils/diff.js";
import {
  getActiveTerminationStatus,
  RUN_ABORT_WARNING,
} from "../competition/termination-state.js";
import { rewriteRunRecord } from "../persistence/adapter.js";
import {
  type AgentInvocationRecord,
  type ExtractedTokenUsage,
  extractedTokenUsageSchema,
} from "./types.js";
import {
  IN_PROGRESS_AGENT_STATUSES,
  TERMINAL_AGENT_STATUSES,
} from "./types.js";

export interface AgentRecordMutators {
  recordAgentQueued: (agent: AgentDefinition) => Promise<void>;
  recordAgentSnapshot: (record: AgentInvocationRecord) => Promise<void>;
}

export interface MutatorFactoryInput {
  readonly root: string;
  readonly runsFilePath: string;
  readonly runId: string;
  readonly renderer?: RunProgressRenderer;
}

/**
 * Create agent record mutation callbacks for a run.
 */
export function createAgentRecordMutators(
  input: MutatorFactoryInput,
): AgentRecordMutators {
  const { root, runsFilePath, runId, renderer } = input;

  const updateAgentRecord = async (
    agentId: string,
    builder: (
      existing: AgentInvocationRecord | undefined,
    ) => AgentInvocationRecord,
  ): Promise<void> => {
    await rewriteRunRecord({
      root,
      runsFilePath,
      runId,
      mutate: (existing) => {
        const agents = [...existing.agents];
        const index = agents.findIndex((agent) => agent.agentId === agentId);
        const current = index >= 0 ? agents[index] : undefined;
        const updated = builder(current);
        if (index >= 0) {
          agents[index] = updated;
        } else {
          agents.push(updated);
        }
        return { ...existing, agents };
      },
    });
  };

  const recordAgentQueued = async (agent: AgentDefinition): Promise<void> => {
    await updateAgentRecord(agent.id, (existing) => {
      if (existing && existing.status !== "queued") {
        return existing;
      }
      const queuedRecord: AgentInvocationRecord = {
        agentId: agent.id,
        model: agent.model,
        status: "queued",
      };

      return mergeAgentRecords(existing, queuedRecord);
    });

    emitStageProgressEvent(renderer, {
      type: "stage.candidate",
      stage: "run",
      candidate: {
        agentId: agent.id,
        model: agent.model,
        status: "queued",
      },
    });
  };

  const recordAgentSnapshot = async (
    record: AgentInvocationRecord,
  ): Promise<void> => {
    const snapshot = normalizeSnapshotForTermination(runId, record);
    await updateAgentRecord(record.agentId, (existing) =>
      mergeAgentRecords(existing, snapshot),
    );

    emitStageProgressEvent(renderer, {
      type: "stage.candidate",
      stage: "run",
      candidate: snapshot,
    });
  };

  return {
    recordAgentQueued,
    recordAgentSnapshot,
  };
}

function mergeArtifactState(
  existing: AgentInvocationRecord["artifacts"],
  incoming: AgentInvocationRecord["artifacts"],
): AgentInvocationRecord["artifacts"] {
  if (!existing && !incoming) {
    return undefined;
  }
  return {
    ...(existing ?? {}),
    ...(incoming ?? {}),
  };
}

function mergeAgentRecords(
  existing: AgentInvocationRecord | undefined,
  incoming: AgentInvocationRecord,
): AgentInvocationRecord {
  if (
    existing &&
    TERMINAL_AGENT_STATUSES.includes(existing.status) &&
    IN_PROGRESS_AGENT_STATUSES.includes(incoming.status)
  ) {
    return existing;
  }

  const merged = {
    ...(existing ?? {}),
    ...incoming,
  } as AgentInvocationRecord;

  const mergedArtifacts = mergeArtifactState(
    existing?.artifacts,
    incoming.artifacts,
  );
  if (mergedArtifacts && Object.keys(mergedArtifacts).length > 0) {
    merged.artifacts = mergedArtifacts;
  } else {
    delete merged.artifacts;
  }

  const normalizedIncomingDiff = normalizeDiffStatistics(
    incoming.diffStatistics,
  );
  const normalizedExistingDiff = normalizeDiffStatistics(
    existing?.diffStatistics,
  );
  const latestDiff = normalizedIncomingDiff ?? normalizedExistingDiff;
  if (latestDiff) {
    merged.diffStatistics = latestDiff;
  } else {
    delete merged.diffStatistics;
  }

  const mergedTokenUsage = mergeTokenUsage(
    existing?.tokenUsage,
    incoming.tokenUsage,
  );
  if (mergedTokenUsage) {
    merged.tokenUsage = mergedTokenUsage;
  } else {
    delete merged.tokenUsage;
  }

  return merged;
}

function mergeTokenUsage(
  existing: AgentInvocationRecord["tokenUsage"],
  incoming: AgentInvocationRecord["tokenUsage"],
): ExtractedTokenUsage | undefined {
  return normalizeTokenUsage(incoming) ?? normalizeTokenUsage(existing);
}

function normalizeTokenUsage(
  tokenUsage: AgentInvocationRecord["tokenUsage"],
): ExtractedTokenUsage | undefined {
  if (!tokenUsage) {
    return undefined;
  }
  const parsed = extractedTokenUsageSchema.safeParse(tokenUsage);
  return parsed.success ? parsed.data : undefined;
}

function normalizeSnapshotForTermination(
  runId: string,
  record: AgentInvocationRecord,
): AgentInvocationRecord {
  const terminationStatus = getActiveTerminationStatus(runId);
  if (terminationStatus !== "aborted") {
    return record;
  }

  if (!TERMINAL_AGENT_STATUSES.includes(record.status)) {
    return record;
  }

  if (record.status === "aborted") {
    return record;
  }

  if (!record.startedAt || !record.completedAt) {
    throw new Error(
      `Terminal agent snapshot for ${record.agentId} is missing canonical lifecycle timestamps.`,
    );
  }

  const warnings = record.warnings ?? [];
  const hasAbortWarning = warnings.includes(RUN_ABORT_WARNING);
  const abortWarnings = hasAbortWarning
    ? warnings
    : [...warnings, RUN_ABORT_WARNING];

  return {
    ...record,
    status: "aborted",
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    warnings: abortWarnings,
  };
}
