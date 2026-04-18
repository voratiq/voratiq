import type { TeardownController } from "../../competition/shared/teardown.js";
import { runTeardown } from "../../competition/shared/teardown.js";
import { buildOperationLifecycleCompleteFields } from "../../domain/shared/lifecycle.js";
import type {
  SpecAgentEntry,
  SpecRecord,
} from "../../domain/spec/model/types.js";
import {
  appendSpecRecord,
  flushSpecRecordBuffer,
  rewriteSpecRecord,
} from "../../domain/spec/persistence/adapter.js";
import {
  SessionRecordMutationError,
  SessionRecordNotFoundError,
} from "../../persistence/errors.js";
import { toErrorMessage } from "../../utils/errors.js";
import { registerActiveSessionTeardown } from "../shared/teardown-registry.js";

export const SPEC_ABORT_DETAIL =
  "Specification generation aborted before completion.";
export const SPEC_FAILURE_DETAIL = "Specification generation failed.";

interface ActiveSpecContext {
  root: string;
  specsFilePath: string;
  specId: string;
  initialRecord?: SpecRecord;
  teardown?: TeardownController;
}

let activeSpec: ActiveSpecContext | undefined;
let terminationInFlight = false;
let clearRegisteredSpecTeardown: (() => void) | undefined;

export function registerActiveSpec(context: ActiveSpecContext): void {
  activeSpec = context;
  clearRegisteredSpecTeardown?.();
  clearRegisteredSpecTeardown = registerActiveSessionTeardown({
    key: `spec:${context.specId}`,
    label: "spec",
    terminate: async (status) => {
      await terminateActiveSpec(status);
    },
  });
}

export function clearActiveSpec(specId: string): void {
  if (activeSpec?.specId !== specId) {
    return;
  }

  if (!terminationInFlight) {
    clearRegisteredSpecTeardown?.();
    clearRegisteredSpecTeardown = undefined;
    activeSpec = undefined;
  }
}

export async function terminateActiveSpec(
  status: "failed" | "aborted",
): Promise<void> {
  if (!activeSpec || terminationInFlight) {
    return;
  }

  terminationInFlight = true;
  const context = activeSpec;
  let persistenceError: Error | undefined;

  try {
    const completedAt = new Date().toISOString();
    const detail =
      status === "aborted" ? SPEC_ABORT_DETAIL : SPEC_FAILURE_DETAIL;
    try {
      await rewriteSpecAsTerminated({
        context,
        status,
        completedAt,
        detail,
      });

      await flushSpecRecordBuffer({
        specsFilePath: context.specsFilePath,
        sessionId: context.specId,
      });
    } catch (error) {
      if (
        !(error instanceof SessionRecordNotFoundError) ||
        !context.initialRecord
      ) {
        throw error;
      }

      await persistMissingTerminatedSpecRecord({
        context,
        status,
        completedAt,
        detail,
      });

      await flushSpecRecordBuffer({
        specsFilePath: context.specsFilePath,
        sessionId: context.specId,
      });
    }
  } catch (error) {
    persistenceError =
      error instanceof Error ? error : new Error(toErrorMessage(error));
    console.error(
      `[voratiq] Failed to finalize spec ${context.specId}: ${toErrorMessage(error)}`,
    );
  } finally {
    try {
      await finalizeRegisteredSpecTeardown(context);
    } finally {
      clearRegisteredSpecTeardown?.();
      clearRegisteredSpecTeardown = undefined;
      terminationInFlight = false;
      activeSpec = undefined;
    }
  }

  if (persistenceError) {
    throw persistenceError;
  }
}

export async function finalizeActiveSpec(specId: string): Promise<void> {
  if (!activeSpec || activeSpec.specId !== specId) {
    clearActiveSpec(specId);
    return;
  }

  if (terminationInFlight) {
    return;
  }

  const context = activeSpec;
  try {
    await finalizeRegisteredSpecTeardown(context);
  } finally {
    clearActiveSpec(specId);
  }
}

function finalizeSpecAgent(options: {
  agent: SpecAgentEntry;
  completedAt: string;
  detail: string;
}): SpecAgentEntry {
  const { agent, completedAt, detail } = options;

  if (agent.status !== "queued" && agent.status !== "running") {
    return agent;
  }

  return {
    ...agent,
    // Spec agent status does not admit `aborted`, so interrupted agents finalize
    // as `failed` while the session itself records `aborted`.
    status: "failed",
    ...buildOperationLifecycleCompleteFields({
      existing: agent,
      startedAt: agent.startedAt ?? completedAt,
      completedAt,
    }),
    error: agent.error ?? detail,
  };
}

function buildTerminatedSpecRecord(options: {
  record: SpecRecord;
  status: "failed" | "aborted";
  completedAt: string;
  detail: string;
}): SpecRecord {
  const { record, status, completedAt, detail } = options;
  return {
    ...record,
    status,
    completedAt,
    agents: record.agents.map((agent) =>
      finalizeSpecAgent({
        agent,
        completedAt,
        detail,
      }),
    ),
    error: record.error ?? detail,
  };
}

async function rewriteSpecAsTerminated(options: {
  context: ActiveSpecContext;
  status: "failed" | "aborted";
  completedAt: string;
  detail: string;
}): Promise<void> {
  const { context, status, completedAt, detail } = options;
  await rewriteSpecRecord({
    root: context.root,
    specsFilePath: context.specsFilePath,
    sessionId: context.specId,
    mutate: (existingRecord) => {
      const agents = existingRecord.agents.map((agent) =>
        finalizeSpecAgent({
          agent,
          completedAt,
          detail,
        }),
      );
      const agentsChanged = agents.some(
        (agent, index) => agent !== existingRecord.agents[index],
      );

      if (existingRecord.status === "running") {
        return {
          ...existingRecord,
          status,
          completedAt,
          agents,
          error: existingRecord.error ?? detail,
        };
      }

      if (!agentsChanged) {
        return existingRecord;
      }

      return {
        ...existingRecord,
        agents,
      };
    },
    forceFlush: true,
  });
}

async function persistMissingTerminatedSpecRecord(options: {
  context: ActiveSpecContext;
  status: "failed" | "aborted";
  completedAt: string;
  detail: string;
}): Promise<void> {
  const { context, status, completedAt, detail } = options;

  try {
    await appendSpecRecord({
      root: context.root,
      specsFilePath: context.specsFilePath,
      record: buildTerminatedSpecRecord({
        record: context.initialRecord!,
        status,
        completedAt,
        detail,
      }),
    });
  } catch (error) {
    if (!isAlreadyExistsMutationError(error)) {
      throw error;
    }

    await rewriteSpecAsTerminated({
      context,
      status,
      completedAt,
      detail,
    });
  }
}

function isAlreadyExistsMutationError(error: unknown): boolean {
  return (
    error instanceof SessionRecordMutationError &&
    error.detail.includes("already exists")
  );
}

async function finalizeRegisteredSpecTeardown(
  context: ActiveSpecContext,
): Promise<void> {
  await runTeardown(context.teardown);
}
