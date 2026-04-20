import { terminateSessionProcesses } from "../../agents/runtime/registry.js";
import type { TeardownController } from "../../competition/shared/teardown.js";
import { runTeardown } from "../../competition/shared/teardown.js";
import {
  getActiveTerminationStatus,
  RUN_ABORT_WARNING,
  setActiveTerminationStatus,
} from "../../domain/run/competition/termination-state.js";
import type { AgentInvocationRecord } from "../../domain/run/model/types.js";
import {
  disposeRunRecordBuffer,
  getRunRecordSnapshot,
  rewriteRunRecord,
} from "../../domain/run/persistence/adapter.js";
import {
  buildOperationLifecycleCompleteFields,
  buildRecordLifecycleCompleteFields,
} from "../../domain/shared/lifecycle.js";
import type { RunStatus } from "../../status/index.js";
import { TERMINABLE_RUN_STATUSES } from "../../status/index.js";
import { toErrorMessage } from "../../utils/errors.js";
import { preserveProviderChatTranscripts } from "../../workspace/chat/artifacts.js";
import type { ChatArtifactFormat } from "../../workspace/chat/types.js";
import { registerActiveSessionTeardown } from "../shared/teardown-registry.js";

interface ActiveRunContext {
  root: string;
  runsFilePath: string;
  runId: string;
  recordPersisted?: boolean;
  recordInitPromise?: Promise<boolean>;
  teardown?: TeardownController;
  agents?: readonly ActiveRunAgentContext[];
}

interface ActiveRunAgentContext {
  agentId: string;
  providerId?: string;
  agentRoot: string;
}

const RUN_RECORD_INIT_TERMINATION_WAIT_MS = 250;

let activeRun: ActiveRunContext | undefined;
let terminationInFlight = false;
let clearRegisteredRunTeardown: (() => void) | undefined;

export function registerActiveRun(context: ActiveRunContext): void {
  activeRun = context;
  clearRegisteredRunTeardown?.();
  clearRegisteredRunTeardown = registerActiveSessionTeardown({
    key: `run:${context.runId}`,
    label: "run",
    terminate: async (status, reason) => {
      await terminateActiveRun(status, reason);
    },
  });
}

export function markActiveRunRecordPersisted(runId: string): void {
  if (!activeRun || activeRun.runId !== runId) {
    return;
  }

  activeRun.recordPersisted = true;
}

export function clearActiveRun(runId: string): void {
  if (activeRun?.runId !== runId) {
    return;
  }

  if (!terminationInFlight) {
    clearRegisteredRunTeardown?.();
    clearRegisteredRunTeardown = undefined;
    activeRun = undefined;
  }
}

export { getActiveTerminationStatus, RUN_ABORT_WARNING };

export async function terminateActiveRun(
  status: Extract<RunStatus, (typeof TERMINABLE_RUN_STATUSES)[number]>,
  detail?: string,
): Promise<void> {
  if (!TERMINABLE_RUN_STATUSES.includes(status)) {
    return;
  }

  if (!activeRun || terminationInFlight) {
    return;
  }

  terminationInFlight = true;
  const context = activeRun;
  setActiveTerminationStatus(context.runId, status);
  let finalized = false;
  const chatArtifactsByAgent: Map<string, ChatArtifactFormat> = new Map();
  const pendingAgentIdsAtTermination =
    await loadPendingAgentIdsForTermination(context);
  let persistenceError: Error | undefined;

  try {
    await terminateSessionProcesses(context.runId);
  } catch (error) {
    const processTerminationError =
      error instanceof Error ? error : new Error(String(error));
    console.error(
      `[voratiq] Failed to terminate run ${context.runId} agent processes: ${toErrorMessage(error)}`,
    );
    clearRegisteredRunTeardown?.();
    clearRegisteredRunTeardown = undefined;
    terminationInFlight = false;
    setActiveTerminationStatus(context.runId, undefined);
    activeRun = undefined;
    throw processTerminationError;
  }

  if (status === "aborted" || status === "failed") {
    await captureChatArtifactsBeforeTermination(
      context,
      chatArtifactsByAgent,
      pendingAgentIdsAtTermination,
    );
  }

  const recordPersisted = await resolveRunRecordPersistence(context);

  try {
    if (recordPersisted) {
      await rewriteRunRecord({
        ...context,
        mutate: (existing) => {
          const completedAt = new Date().toISOString();
          const finalAgentStatus: "failed" | "aborted" =
            status === "aborted" ? "aborted" : "failed";
          const runInProgress =
            existing.status === "running" || existing.status === "queued";
          const runStatusNeedsUpdate =
            runInProgress && existing.status !== status;

          let agentsChanged = false;
          const agents = existing.agents.map((agent): AgentInvocationRecord => {
            const finalizedAgent = finalizeRunAgent({
              agent,
              status: finalAgentStatus,
              completedAt,
              detail,
              chatArtifactsByAgent,
              pendingAgentIdsAtTermination,
            });
            if (finalizedAgent !== agent) {
              agentsChanged = true;
            }
            return finalizedAgent;
          });

          if (!runStatusNeedsUpdate && !agentsChanged) {
            return existing;
          }

          if (runStatusNeedsUpdate) {
            return {
              ...existing,
              status,
              ...buildRecordLifecycleCompleteFields({
                existing,
                startedAt: existing.startedAt ?? completedAt,
                completedAt,
              }),
              agents,
            };
          }

          return {
            ...existing,
            agents,
          };
        },
      });
      finalized = true;
    }
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
    await finalizeRegisteredRunTeardown(context);
  } finally {
    clearRegisteredRunTeardown?.();
    clearRegisteredRunTeardown = undefined;
    terminationInFlight = false;
    setActiveTerminationStatus(context.runId, undefined);
    activeRun = undefined;
  }

  if (persistenceError) {
    throw persistenceError;
  }
}

async function resolveRunRecordPersistence(
  context: ActiveRunContext,
): Promise<boolean> {
  if (context.recordPersisted) {
    return true;
  }

  if (!context.recordInitPromise) {
    return true;
  }

  try {
    const timeoutResult = Symbol("record-init-timeout");
    const persisted = await Promise.race<boolean | typeof timeoutResult>([
      context.recordInitPromise,
      new Promise<typeof timeoutResult>((resolve) => {
        setTimeout(
          () => resolve(timeoutResult),
          RUN_RECORD_INIT_TERMINATION_WAIT_MS,
        );
      }),
    ]);

    if (persisted === timeoutResult) {
      console.warn(
        `[voratiq] Timed out waiting for run ${context.runId} initial record persistence during termination; skipping record rewrite.`,
      );
      return false;
    }

    context.recordPersisted = persisted;
    return persisted;
  } catch {
    return false;
  }
}

export async function finalizeActiveRun(runId: string): Promise<void> {
  if (!activeRun || activeRun.runId !== runId) {
    clearActiveRun(runId);
    return;
  }

  if (terminationInFlight) {
    return;
  }

  const context = activeRun;
  try {
    await finalizeRegisteredRunTeardown(context);
  } finally {
    clearActiveRun(runId);
  }
}

async function captureChatArtifactsBeforeTermination(
  context: ActiveRunContext,
  output: Map<string, ChatArtifactFormat>,
  pendingAgentIds: ReadonlySet<string>,
): Promise<void> {
  const agentContexts = context.agents ?? [];
  if (agentContexts.length === 0) {
    return;
  }
  if (pendingAgentIds.size === 0) {
    return;
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

async function loadPendingAgentIdsForTermination(
  context: ActiveRunContext,
): Promise<Set<string>> {
  const pendingAgentIds = new Set<string>();
  const agentContexts = context.agents ?? [];

  try {
    const snapshot = await getRunRecordSnapshot({
      runsFilePath: context.runsFilePath,
      runId: context.runId,
    });
    const snapshotAgents = snapshot?.agents;
    if (snapshotAgents && snapshotAgents.length > 0) {
      for (const agent of snapshotAgents) {
        if (agent.status === "running" || agent.status === "queued") {
          pendingAgentIds.add(agent.agentId);
        }
      }
      return pendingAgentIds;
    }
  } catch (error) {
    console.warn(
      `[voratiq] Failed to load run ${context.runId} before abort: ${toErrorMessage(error)}`,
    );
  }

  for (const agent of agentContexts) {
    pendingAgentIds.add(agent.agentId);
  }

  return pendingAgentIds;
}

async function finalizeRegisteredRunTeardown(
  context: ActiveRunContext,
): Promise<void> {
  await runTeardown(context.teardown);
}

function finalizeRunAgent(options: {
  agent: AgentInvocationRecord;
  status: "failed" | "aborted";
  completedAt: string;
  detail?: string;
  chatArtifactsByAgent: ReadonlyMap<string, ChatArtifactFormat>;
  pendingAgentIdsAtTermination: ReadonlySet<string>;
}): AgentInvocationRecord {
  const {
    agent,
    status,
    completedAt,
    detail,
    chatArtifactsByAgent,
    pendingAgentIdsAtTermination,
  } = options;

  const shouldForceAbort =
    status === "aborted" &&
    pendingAgentIdsAtTermination.has(agent.agentId) &&
    agent.status !== "succeeded";

  if (
    !shouldForceAbort &&
    agent.status !== "queued" &&
    agent.status !== "running"
  ) {
    return agent;
  }

  const chatFormat = chatArtifactsByAgent.get(agent.agentId);
  const nextArtifacts =
    chatFormat !== undefined
      ? {
          ...(agent.artifacts ?? {}),
          chatCaptured: true,
          chatFormat,
        }
      : agent.artifacts;

  if (status === "aborted") {
    const warnings = agent.warnings ?? [];
    const nextWarnings = warnings.includes(RUN_ABORT_WARNING)
      ? warnings
      : [...warnings, RUN_ABORT_WARNING];

    return {
      ...agent,
      status: "aborted",
      ...buildOperationLifecycleCompleteFields({
        existing: agent,
        startedAt: agent.startedAt ?? completedAt,
        completedAt,
      }),
      warnings: nextWarnings,
      artifacts: nextArtifacts,
      error: undefined,
    };
  }

  return {
    ...agent,
    status: "failed",
    ...buildOperationLifecycleCompleteFields({
      existing: agent,
      startedAt: agent.startedAt ?? completedAt,
      completedAt,
    }),
    error: agent.error ?? detail ?? "Run failed before agent completed.",
    artifacts: nextArtifacts,
  };
}
