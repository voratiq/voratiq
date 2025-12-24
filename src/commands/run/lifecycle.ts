import { teardownSessionAuth } from "../../agents/runtime/registry.js";
import {
  disposeRunRecordBuffer,
  getRunRecordSnapshot,
  rewriteRunRecord,
} from "../../records/persistence.js";
import type { AgentInvocationRecord } from "../../records/types.js";
import type { RunStatus } from "../../status/index.js";
import { toErrorMessage } from "../../utils/errors.js";
import { preserveProviderChatTranscripts } from "../../workspace/chat/artifacts.js";
import type { ChatArtifactFormat } from "../../workspace/chat/types.js";

export const RUN_ABORT_WARNING = "Run aborted before agent completed.";

interface ActiveRunContext {
  root: string;
  runsFilePath: string;
  runId: string;
  agents?: readonly ActiveRunAgentContext[];
}

interface ActiveRunAgentContext {
  agentId: string;
  providerId?: string;
  agentRoot: string;
}

let activeRun: ActiveRunContext | undefined;
let terminationInFlight = false;
let activeTerminationStatus: RunStatus | undefined;

const TERMINABLE_STATUSES = ["failed", "aborted"] as const;

export function registerActiveRun(context: ActiveRunContext): void {
  activeRun = context;
}

export function clearActiveRun(runId: string): void {
  if (activeRun?.runId !== runId) {
    return;
  }

  if (!terminationInFlight) {
    activeRun = undefined;
  }
}

export function getActiveTerminationStatus(
  runId: string,
): RunStatus | undefined {
  if (!terminationInFlight) {
    return undefined;
  }

  if (!activeRun || activeRun.runId !== runId) {
    return undefined;
  }

  return activeTerminationStatus;
}

export async function terminateActiveRun(
  status: Extract<RunStatus, (typeof TERMINABLE_STATUSES)[number]>,
): Promise<void> {
  if (!TERMINABLE_STATUSES.includes(status)) {
    return;
  }

  if (!activeRun || terminationInFlight) {
    return;
  }

  terminationInFlight = true;
  activeTerminationStatus = status;
  const context = activeRun;
  let finalized = false;
  const chatArtifactsByAgent: Map<string, ChatArtifactFormat> = new Map();
  let persistenceError: Error | undefined;

  if (status === "aborted") {
    await captureChatArtifactsBeforeAbort(context, chatArtifactsByAgent);
  }

  try {
    await rewriteRunRecord({
      ...context,
      mutate: (existing) => {
        const runInProgress =
          existing.status === "running" || existing.status === "queued";
        const runStatusNeedsUpdate =
          runInProgress && existing.status !== status;

        let agentsChanged = false;
        let agents = existing.agents;

        if (status === "aborted") {
          const abortedAt = new Date().toISOString();
          const abortWarning = RUN_ABORT_WARNING;
          agents = existing.agents.map((agent): AgentInvocationRecord => {
            if (agent.status !== "running" && agent.status !== "queued") {
              return agent;
            }

            agentsChanged = true;

            const warnings = agent.warnings ?? [];
            const nextWarnings = warnings.includes(abortWarning)
              ? warnings
              : [...warnings, abortWarning];

            const chatFormat = chatArtifactsByAgent.get(agent.agentId);
            const nextArtifacts =
              chatFormat !== undefined
                ? {
                    ...(agent.artifacts ?? {}),
                    chatCaptured: true,
                    chatFormat,
                  }
                : agent.artifacts;

            return {
              ...agent,
              status: "aborted",
              startedAt: agent.startedAt ?? abortedAt,
              completedAt: abortedAt,
              warnings: nextWarnings,
              artifacts: nextArtifacts,
            };
          });
        }

        if (!runStatusNeedsUpdate && !agentsChanged) {
          return existing;
        }

        return {
          ...existing,
          status: runStatusNeedsUpdate ? status : existing.status,
          deletedAt: runStatusNeedsUpdate ? null : existing.deletedAt,
          agents,
        };
      },
    });
    finalized = true;
  } catch (error) {
    persistenceError =
      error instanceof Error ? error : new Error(String(error));
    console.error(
      `[voratiq] Failed to finalize run ${context.runId}: ${toErrorMessage(error)}`,
    );
  }

  if (finalized) {
    try {
      await disposeRunRecordBuffer({
        runsFilePath: context.runsFilePath,
        runId: context.runId,
      });
    } catch (error) {
      if (!persistenceError) {
        persistenceError =
          error instanceof Error ? error : new Error(String(error));
      }
      console.error(
        `[voratiq] Failed to dispose run ${context.runId} record buffer: ${toErrorMessage(error)}`,
      );
    }
  }

  try {
    await teardownSessionAuth(context.runId);
  } finally {
    terminationInFlight = false;
    activeTerminationStatus = undefined;
    activeRun = undefined;
  }

  if (persistenceError) {
    throw persistenceError;
  }
}

async function captureChatArtifactsBeforeAbort(
  context: ActiveRunContext,
  output: Map<string, ChatArtifactFormat>,
): Promise<void> {
  const agentContexts = context.agents ?? [];
  if (agentContexts.length === 0) {
    return;
  }

  let snapshotAgents: readonly AgentInvocationRecord[] | undefined;
  try {
    const snapshot = await getRunRecordSnapshot({
      runsFilePath: context.runsFilePath,
      runId: context.runId,
    });
    snapshotAgents = snapshot?.agents;
  } catch (error) {
    console.warn(
      `[voratiq] Failed to load run ${context.runId} before abort: ${toErrorMessage(error)}`,
    );
  }

  const pendingAgentIds = new Set<string>();
  if (snapshotAgents && snapshotAgents.length > 0) {
    for (const agent of snapshotAgents) {
      if (agent.status === "running" || agent.status === "queued") {
        pendingAgentIds.add(agent.agentId);
      }
    }
    if (pendingAgentIds.size === 0) {
      return;
    }
  } else {
    for (const agent of agentContexts) {
      pendingAgentIds.add(agent.agentId);
    }
  }

  for (const agent of agentContexts) {
    if (!pendingAgentIds.has(agent.agentId)) {
      continue;
    }
    if (!agent.providerId) {
      continue;
    }

    try {
      const result = await preserveProviderChatTranscripts({
        providerId: agent.providerId,
        agentRoot: agent.agentRoot,
      });

      if (
        (result.status === "captured" || result.status === "already-exists") &&
        result.format
      ) {
        output.set(agent.agentId, result.format);
        continue;
      }

      if (result.status === "error") {
        console.warn(
          `[voratiq] (${agent.agentId}) Failed to preserve ${agent.providerId} transcripts: ${toErrorMessage(result.error)}`,
        );
      }
    } catch (error) {
      console.warn(
        `[voratiq] (${agent.agentId}) Failed to preserve ${agent.providerId ?? "unknown"} transcripts: ${toErrorMessage(error)}`,
      );
    }
  }
}
