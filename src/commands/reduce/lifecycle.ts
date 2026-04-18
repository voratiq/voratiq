import type { TeardownController } from "../../competition/shared/teardown.js";
import { runTeardown } from "../../competition/shared/teardown.js";
import type { ReductionRecord } from "../../domain/reduce/model/types.js";
import {
  appendReductionRecord,
  flushReductionRecordBuffer,
  readReductionRecords,
  rewriteReductionRecord,
} from "../../domain/reduce/persistence/adapter.js";
import {
  buildOperationLifecycleCompleteFields,
  buildRecordLifecycleCompleteFields,
} from "../../domain/shared/lifecycle.js";
import { SessionRecordMutationError } from "../../persistence/errors.js";
import { toErrorMessage } from "../../utils/errors.js";
import { registerActiveSessionTeardown } from "../shared/teardown-registry.js";

export const REDUCE_ABORT_DETAIL = "Reduction aborted before completion.";
export const REDUCE_FAILURE_DETAIL = "Reduction failed.";

interface ActiveReduceContext {
  root: string;
  reductionsFilePath: string;
  reductionId: string;
  initialRecord?: ReductionRecord;
  teardown?: TeardownController;
}

let activeReduce: ActiveReduceContext | undefined;
let terminationInFlight = false;
let clearRegisteredReduceTeardown: (() => void) | undefined;

export function registerActiveReduce(context: ActiveReduceContext): void {
  activeReduce = context;
  clearRegisteredReduceTeardown?.();
  clearRegisteredReduceTeardown = registerActiveSessionTeardown({
    key: `reduce:${context.reductionId}`,
    label: "reduce",
    terminate: async (status) => {
      await terminateActiveReduce(status);
    },
  });
}

export function clearActiveReduce(reductionId: string): void {
  if (activeReduce?.reductionId !== reductionId) {
    return;
  }

  if (!terminationInFlight) {
    clearRegisteredReduceTeardown?.();
    clearRegisteredReduceTeardown = undefined;
    activeReduce = undefined;
  }
}

export async function terminateActiveReduce(
  status: "failed" | "aborted",
): Promise<void> {
  if (!activeReduce || terminationInFlight) {
    return;
  }

  terminationInFlight = true;
  const context = activeReduce;
  let persistenceError: Error | undefined;

  try {
    const existingRecord = await readReductionRecords({
      root: context.root,
      reductionsFilePath: context.reductionsFilePath,
      limit: 1,
      predicate: (record) => record.sessionId === context.reductionId,
    }).then((records) => records[0]);

    if (!existingRecord) {
      if (!context.initialRecord) {
        return;
      }

      const completedAt = new Date().toISOString();
      const detail =
        status === "aborted" ? REDUCE_ABORT_DETAIL : REDUCE_FAILURE_DETAIL;
      await persistMissingTerminatedReductionRecord({
        context,
        status,
        completedAt,
        detail,
      });

      await flushReductionRecordBuffer({
        reductionsFilePath: context.reductionsFilePath,
        sessionId: context.reductionId,
      });
      return;
    }

    const completedAt = new Date().toISOString();
    const detail =
      status === "aborted" ? REDUCE_ABORT_DETAIL : REDUCE_FAILURE_DETAIL;

    await rewriteReductionAsTerminated({
      context,
      status,
      completedAt,
      detail,
    });

    await flushReductionRecordBuffer({
      reductionsFilePath: context.reductionsFilePath,
      sessionId: context.reductionId,
    });
  } catch (error) {
    persistenceError =
      error instanceof Error ? error : new Error(toErrorMessage(error));
    console.error(
      `[voratiq] Failed to finalize reduction ${context.reductionId}: ${toErrorMessage(error)}`,
    );
  } finally {
    try {
      await finalizeRegisteredReduceTeardown(context);
    } finally {
      clearRegisteredReduceTeardown?.();
      clearRegisteredReduceTeardown = undefined;
      terminationInFlight = false;
      activeReduce = undefined;
    }
  }

  if (persistenceError) {
    throw persistenceError;
  }
}

export async function finalizeActiveReduce(reductionId: string): Promise<void> {
  if (!activeReduce || activeReduce.reductionId !== reductionId) {
    clearActiveReduce(reductionId);
    return;
  }

  if (terminationInFlight) {
    return;
  }

  const context = activeReduce;
  try {
    await finalizeRegisteredReduceTeardown(context);
  } finally {
    clearActiveReduce(reductionId);
  }
}

function finalizeReducerEntry(options: {
  reducer: ReductionRecord["reducers"][number];
  status: "failed" | "aborted";
  completedAt: string;
  detail: string;
}): ReductionRecord["reducers"][number] {
  const { reducer, status, completedAt, detail } = options;

  if (reducer.status !== "queued" && reducer.status !== "running") {
    return reducer;
  }

  return {
    ...reducer,
    status,
    ...buildOperationLifecycleCompleteFields({
      existing: reducer,
      startedAt: reducer.startedAt ?? completedAt,
      completedAt,
    }),
    error: reducer.error ?? detail,
  };
}

function buildTerminatedReductionRecord(options: {
  record: ReductionRecord;
  status: "failed" | "aborted";
  completedAt: string;
  detail: string;
}): ReductionRecord {
  const { record, status, completedAt, detail } = options;
  return {
    ...record,
    status,
    ...buildRecordLifecycleCompleteFields({
      existing: record,
      startedAt: record.startedAt ?? completedAt,
      completedAt,
    }),
    reducers: record.reducers.map((reducer) =>
      finalizeReducerEntry({
        reducer,
        status,
        completedAt,
        detail,
      }),
    ),
    error: record.error ?? detail,
  };
}

async function rewriteReductionAsTerminated(options: {
  context: ActiveReduceContext;
  status: "failed" | "aborted";
  completedAt: string;
  detail: string;
}): Promise<void> {
  const { context, status, completedAt, detail } = options;
  await rewriteReductionRecord({
    root: context.root,
    reductionsFilePath: context.reductionsFilePath,
    sessionId: context.reductionId,
    mutate: (record) => {
      const reducers = record.reducers.map((reducer) =>
        finalizeReducerEntry({
          reducer,
          status,
          completedAt,
          detail,
        }),
      );

      const inProgress =
        record.status === "queued" || record.status === "running";
      if (!inProgress) {
        if (
          reducers.every((reducer, index) => reducer === record.reducers[index])
        ) {
          return record;
        }

        return {
          ...record,
          reducers,
        };
      }

      return {
        ...record,
        status,
        reducers,
        ...buildRecordLifecycleCompleteFields({
          existing: record,
          startedAt: record.startedAt ?? completedAt,
          completedAt,
        }),
        error: record.error ?? detail,
      };
    },
    forceFlush: true,
  });
}

async function persistMissingTerminatedReductionRecord(options: {
  context: ActiveReduceContext;
  status: "failed" | "aborted";
  completedAt: string;
  detail: string;
}): Promise<void> {
  const { context, status, completedAt, detail } = options;

  try {
    await appendReductionRecord({
      root: context.root,
      reductionsFilePath: context.reductionsFilePath,
      record: buildTerminatedReductionRecord({
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

    await rewriteReductionAsTerminated({
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

async function finalizeRegisteredReduceTeardown(
  context: ActiveReduceContext,
): Promise<void> {
  await runTeardown(context.teardown);
}
