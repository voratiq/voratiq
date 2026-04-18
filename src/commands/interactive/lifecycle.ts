import type { ChildProcess } from "node:child_process";

import type { TeardownController } from "../../competition/shared/teardown.js";
import { runTeardown } from "../../competition/shared/teardown.js";
import type { InteractiveSessionRecord } from "../../domain/interactive/model/types.js";
import {
  disposeInteractiveSessionBuffer,
  getInteractiveSessionRecordSnapshot,
  rewriteInteractiveSessionRecord,
} from "../../domain/interactive/persistence/adapter.js";
import { buildRecordLifecycleCompleteFields } from "../../domain/shared/lifecycle.js";
import { toErrorMessage } from "../../utils/errors.js";
import { registerActiveSessionTeardown } from "../shared/teardown-registry.js";

const INTERACTIVE_TERMINATION_WAIT_MS = 1_000;

interface ActiveInteractiveContext {
  root: string;
  sessionId: string;
  process?: ChildProcess;
  completion?: Promise<InteractiveSessionRecord>;
  teardown?: TeardownController;
  terminationStatus?: "failed" | "aborted";
}

let activeInteractive: ActiveInteractiveContext | undefined;
let terminationInFlight = false;
let clearRegisteredInteractiveTeardown: (() => void) | undefined;

export function registerActiveInteractive(
  context: ActiveInteractiveContext,
): void {
  activeInteractive = context;
  clearRegisteredInteractiveTeardown?.();
  clearRegisteredInteractiveTeardown = registerActiveSessionTeardown({
    key: `interactive:${context.sessionId}`,
    label: "interactive",
    terminate: async (status, reason) => {
      await terminateActiveInteractive(status, reason);
    },
  });
}

export function clearActiveInteractive(sessionId: string): void {
  if (activeInteractive?.sessionId !== sessionId) {
    return;
  }

  if (!terminationInFlight) {
    clearRegisteredInteractiveTeardown?.();
    clearRegisteredInteractiveTeardown = undefined;
    activeInteractive = undefined;
  }
}

export function getActiveInteractiveTerminationStatus(
  sessionId: string,
): "failed" | "aborted" | undefined {
  if (activeInteractive?.sessionId !== sessionId) {
    return undefined;
  }
  return activeInteractive.terminationStatus;
}

export async function terminateActiveInteractive(
  status: "failed" | "aborted",
  reason?: string,
): Promise<void> {
  if (!activeInteractive || terminationInFlight) {
    return;
  }

  terminationInFlight = true;
  const context = activeInteractive;
  context.terminationStatus = status;
  let persistenceError: Error | undefined;

  try {
    terminateInteractiveProcess(context.process);
    await waitForInteractiveCompletion(context.completion);

    const existingRecord = await getInteractiveSessionRecordSnapshot({
      root: context.root,
      sessionId: context.sessionId,
    });

    if (!existingRecord) {
      return;
    }

    if (existingRecord.status === "running") {
      await rewriteInteractiveSessionRecord({
        root: context.root,
        sessionId: context.sessionId,
        mutate: (record) =>
          record.status === "running"
            ? buildTerminatedRecord(record, status, reason)
            : record,
        forceFlush: true,
      });
    }

    await disposeInteractiveSessionBuffer({
      root: context.root,
      sessionId: context.sessionId,
    });
  } catch (error) {
    persistenceError =
      error instanceof Error ? error : new Error(toErrorMessage(error));
    console.error(
      `[voratiq] Failed to finalize interactive session ${context.sessionId}: ${toErrorMessage(error)}`,
    );
  } finally {
    try {
      await runTeardown(context.teardown);
    } finally {
      context.terminationStatus = undefined;
      clearRegisteredInteractiveTeardown?.();
      clearRegisteredInteractiveTeardown = undefined;
      terminationInFlight = false;
      activeInteractive = undefined;
    }
  }

  if (persistenceError) {
    throw persistenceError;
  }
}

export async function finalizeActiveInteractive(
  sessionId: string,
): Promise<void> {
  if (!activeInteractive || activeInteractive.sessionId !== sessionId) {
    clearActiveInteractive(sessionId);
    return;
  }

  if (terminationInFlight) {
    return;
  }

  try {
    await disposeInteractiveSessionBuffer({
      root: activeInteractive.root,
      sessionId,
    });
  } finally {
    try {
      await runTeardown(activeInteractive.teardown);
    } finally {
      clearActiveInteractive(sessionId);
    }
  }
}

function terminateInteractiveProcess(process: ChildProcess | undefined): void {
  if (!process) {
    return;
  }

  if (process.exitCode !== null || process.signalCode !== null) {
    return;
  }

  try {
    process.kill("SIGTERM");
  } catch {
    // Ignore teardown kill failures; record finalization still proceeds.
  }
}

async function waitForInteractiveCompletion(
  completion: Promise<InteractiveSessionRecord> | undefined,
): Promise<void> {
  if (!completion) {
    return;
  }

  await Promise.race([
    completion.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      setTimeout(resolve, INTERACTIVE_TERMINATION_WAIT_MS);
    }),
  ]);
}

function buildTerminatedRecord(
  record: InteractiveSessionRecord,
  status: "failed" | "aborted",
  reason?: string,
): InteractiveSessionRecord {
  const lifecycle = buildRecordLifecycleCompleteFields({
    existing: record,
    startedAt: record.startedAt ?? record.createdAt,
    completedAt: new Date().toISOString(),
  });

  if (status === "aborted") {
    return {
      ...record,
      status: "succeeded",
      ...lifecycle,
    };
  }

  return {
    ...record,
    status: "failed",
    ...lifecycle,
    error: {
      code: "provider_launch_failed",
      message: buildTerminationMessage(status, reason),
    },
  };
}

function buildTerminationMessage(
  status: "failed" | "aborted",
  reason?: string,
): string {
  if (status === "aborted") {
    return reason
      ? `Interactive session aborted after ${reason}.`
      : "Interactive session aborted before completion.";
  }

  return reason
    ? `Interactive session failed after ${reason}.`
    : "Interactive session failed before completion.";
}
