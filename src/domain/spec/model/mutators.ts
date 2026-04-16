import {
  buildLifecycleStartFields,
  buildOperationLifecycleCompleteFields,
  buildRecordLifecycleCompleteFields,
} from "../../shared/lifecycle.js";
import { rewriteSpecRecord } from "../persistence/adapter.js";
import type { SpecAgentEntry, SpecRecord, SpecRecordStatus } from "./types.js";

export interface SpecRecordMutators {
  recordAgentRunning: (options: {
    agentId: string;
    timestamp?: string;
  }) => Promise<SpecRecord>;
  recordAgentSnapshot: (agent: SpecAgentEntry) => Promise<SpecRecord>;
  completeSpec: (options: {
    status: SpecRecordStatus;
    agents?: readonly SpecAgentEntry[];
    error?: string | null;
  }) => Promise<SpecRecord>;
  readRecord: () => Promise<SpecRecord | undefined>;
}

export interface CreateSpecRecordMutatorsInput {
  readonly root: string;
  readonly specsFilePath: string;
  readonly sessionId: string;
}

export function createSpecRecordMutators(
  input: CreateSpecRecordMutatorsInput,
): SpecRecordMutators {
  const { root, specsFilePath, sessionId } = input;

  const updateAgent = async (
    agentId: string,
    builder: (existing: SpecAgentEntry | undefined) => SpecAgentEntry,
    forceFlush = false,
  ): Promise<SpecRecord> =>
    await rewriteSpecRecord({
      root,
      specsFilePath,
      sessionId,
      forceFlush,
      mutate: (record) => {
        const agents = [...record.agents];
        const index = agents.findIndex((agent) => agent.agentId === agentId);
        const current = index >= 0 ? agents[index] : undefined;
        const updated = builder(current);
        if (index >= 0) {
          agents[index] = updated;
        } else {
          agents.push(updated);
        }
        return {
          ...record,
          agents,
        };
      },
    });

  return {
    recordAgentRunning: async ({
      agentId,
      timestamp = new Date().toISOString(),
    }) =>
      await updateAgent(agentId, (existing) => {
        if (existing && isTerminalSpecAgentStatus(existing.status)) {
          return existing;
        }

        return {
          ...(existing ?? { agentId }),
          status: "running",
          ...buildLifecycleStartFields({
            existingStartedAt: existing?.startedAt,
            timestamp,
          }),
          completedAt: undefined,
          outputPath: existing?.outputPath,
          dataPath: existing?.dataPath,
          contentHash: existing?.contentHash,
          tokenUsage: existing?.tokenUsage,
          error: null,
        };
      }),
    recordAgentSnapshot: async (agent) =>
      await updateAgent(
        agent.agentId,
        (existing) =>
          existing
            ? mergeSpecAgentEntries(existing, agent)
            : normalizeSpecAgentEntry(agent),
        isTerminalSpecAgentStatus(agent.status),
      ),
    completeSpec: async ({ status, agents, error }) =>
      await rewriteSpecRecord({
        root,
        specsFilePath,
        sessionId,
        mutate: (existing) => ({
          ...existing,
          status,
          ...buildRecordLifecycleCompleteFields({ existing }),
          ...(agents ? { agents: [...agents] } : {}),
          ...(error !== undefined ? { error } : {}),
        }),
        forceFlush: true,
      }),
    readRecord: async () =>
      await rewriteSpecRecord({
        root,
        specsFilePath,
        sessionId,
        mutate: (record) => record,
      }),
  };
}

function mergeSpecAgentEntries(
  existing: SpecAgentEntry,
  incoming: SpecAgentEntry,
): SpecAgentEntry {
  if (
    isTerminalSpecAgentStatus(existing.status) &&
    !isTerminalSpecAgentStatus(incoming.status)
  ) {
    return existing;
  }

  if (incoming.status === "running") {
    return {
      ...existing,
      ...incoming,
      status: "running",
      ...buildLifecycleStartFields({
        existingStartedAt: existing.startedAt,
        timestamp: incoming.startedAt,
      }),
      completedAt: undefined,
      outputPath: incoming.outputPath ?? existing.outputPath,
      dataPath: incoming.dataPath ?? existing.dataPath,
      contentHash: incoming.contentHash ?? existing.contentHash,
      tokenUsage: incoming.tokenUsage ?? existing.tokenUsage,
      error:
        incoming.error !== undefined
          ? incoming.error
          : (existing.error ?? null),
    };
  }

  const completedAt = incoming.completedAt ?? new Date().toISOString();
  const startedAt = buildLifecycleStartFields({
    existingStartedAt: existing.startedAt,
    timestamp: incoming.startedAt ?? completedAt,
  }).startedAt;
  const lifecycle = buildOperationLifecycleCompleteFields({
    existing: {
      startedAt,
      completedAt: existing.completedAt,
    },
    completedAt,
  });

  return {
    ...existing,
    ...incoming,
    ...lifecycle,
    outputPath: incoming.outputPath ?? existing.outputPath,
    dataPath: incoming.dataPath ?? existing.dataPath,
    contentHash: incoming.contentHash ?? existing.contentHash,
    tokenUsage: incoming.tokenUsage ?? existing.tokenUsage,
    error:
      incoming.error !== undefined ? incoming.error : (existing.error ?? null),
  };
}

function normalizeSpecAgentEntry(agent: SpecAgentEntry): SpecAgentEntry {
  if (agent.status === "running") {
    return {
      ...agent,
      ...buildLifecycleStartFields({
        existingStartedAt: undefined,
        timestamp: agent.startedAt,
      }),
      completedAt: undefined,
      error: agent.error ?? null,
    };
  }

  const completedAt = agent.completedAt ?? new Date().toISOString();
  const startedAt = buildLifecycleStartFields({
    existingStartedAt: undefined,
    timestamp: agent.startedAt ?? completedAt,
  }).startedAt;

  return {
    ...agent,
    ...buildOperationLifecycleCompleteFields({
      existing: { startedAt, completedAt: undefined },
      completedAt,
    }),
    error: agent.error ?? null,
  };
}

function isTerminalSpecAgentStatus(status: SpecAgentEntry["status"]): boolean {
  return status === "succeeded" || status === "failed";
}
