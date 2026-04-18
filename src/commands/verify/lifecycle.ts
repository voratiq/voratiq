import type { TeardownController } from "../../competition/shared/teardown.js";
import { runTeardown } from "../../competition/shared/teardown.js";
import {
  buildOperationLifecycleCompleteFields,
  buildRecordLifecycleCompleteFields,
} from "../../domain/shared/lifecycle.js";
import { writeVerificationArtifact } from "../../domain/verify/competition/artifacts.js";
import type {
  VerificationMethodResultRef,
  VerificationRecord,
} from "../../domain/verify/model/types.js";
import {
  appendVerificationRecord,
  flushVerificationRecordBuffer,
  readVerificationRecords,
  rewriteVerificationRecord,
} from "../../domain/verify/persistence/adapter.js";
import {
  SessionRecordMutationError,
  SessionRecordNotFoundError,
} from "../../persistence/errors.js";
import type { VerificationStatus } from "../../status/index.js";
import { toErrorMessage } from "../../utils/errors.js";
import {
  getVerificationProgrammaticResultPath,
  getVerificationRubricResultPath,
} from "../../workspace/artifact-paths.js";
import { registerActiveSessionTeardown } from "../shared/teardown-registry.js";

export const VERIFY_ABORT_DETAIL = "Verification aborted before completion.";

interface ActiveVerificationContext {
  root: string;
  verificationsFilePath: string;
  verificationId: string;
  initialRecord?: VerificationRecord;
  teardown?: TeardownController;
}

let activeVerification: ActiveVerificationContext | undefined;
let terminationInFlight = false;
let clearRegisteredVerificationTeardown: (() => void) | undefined;

export function registerActiveVerification(
  context: ActiveVerificationContext,
): void {
  activeVerification = context;
  clearRegisteredVerificationTeardown?.();
  clearRegisteredVerificationTeardown = registerActiveSessionTeardown({
    key: `verify:${context.verificationId}`,
    label: "verify",
    terminate: async (status) => {
      await terminateActiveVerification(status);
    },
  });
}

export function clearActiveVerification(verificationId: string): void {
  if (activeVerification?.verificationId !== verificationId) {
    return;
  }

  if (!terminationInFlight) {
    clearRegisteredVerificationTeardown?.();
    clearRegisteredVerificationTeardown = undefined;
    activeVerification = undefined;
  }
}

export async function terminateActiveVerification(
  status: Extract<VerificationStatus, "failed" | "aborted">,
): Promise<void> {
  if (!activeVerification || terminationInFlight) {
    return;
  }

  terminationInFlight = true;
  const context = activeVerification;
  let persistenceError: Error | undefined;

  try {
    const existingRecord = await readActiveVerificationRecord(context);

    if (!existingRecord) {
      if (!context.initialRecord) {
        return;
      }

      const completedAt = new Date().toISOString();
      const detail =
        status === "aborted" ? VERIFY_ABORT_DETAIL : "Verification failed.";
      await persistMissingTerminatedVerificationRecord({
        context,
        status,
        completedAt,
        detail,
      });

      await flushVerificationRecordBuffer({
        verificationsFilePath: context.verificationsFilePath,
        sessionId: context.verificationId,
      });
      return;
    }

    const completedAt = new Date().toISOString();
    const detail =
      status === "aborted" ? VERIFY_ABORT_DETAIL : "Verification failed.";

    await materializeTerminalVerificationArtifacts({
      root: context.root,
      verificationId: context.verificationId,
      record: existingRecord,
      status,
      completedAt,
      detail,
    });

    try {
      await rewriteVerificationAsTerminated({
        context,
        status,
        completedAt,
        detail,
      });
    } catch (error) {
      if (
        !(error instanceof SessionRecordNotFoundError) ||
        !context.initialRecord
      ) {
        throw error;
      }

      await persistMissingTerminatedVerificationRecord({
        context,
        status,
        completedAt,
        detail,
      });
    }

    await flushVerificationRecordBuffer({
      verificationsFilePath: context.verificationsFilePath,
      sessionId: context.verificationId,
    });
  } catch (error) {
    persistenceError =
      error instanceof Error ? error : new Error(toErrorMessage(error));
    console.error(
      `[voratiq] Failed to finalize verification ${context.verificationId}: ${toErrorMessage(error)}`,
    );
  } finally {
    try {
      await finalizeRegisteredVerificationTeardown(context);
    } finally {
      clearRegisteredVerificationTeardown?.();
      clearRegisteredVerificationTeardown = undefined;
      terminationInFlight = false;
      activeVerification = undefined;
    }
  }

  if (persistenceError) {
    throw persistenceError;
  }
}

async function readActiveVerificationRecord(
  context: ActiveVerificationContext,
): Promise<VerificationRecord | undefined> {
  return await readVerificationRecords({
    root: context.root,
    verificationsFilePath: context.verificationsFilePath,
    limit: 1,
    predicate: (record) => record.sessionId === context.verificationId,
  }).then((records) => records[0]);
}

function buildTerminatedVerificationRecord(options: {
  record: VerificationRecord;
  status: Extract<VerificationStatus, "failed" | "aborted">;
  completedAt: string;
  detail: string;
}): VerificationRecord {
  const { record, status, completedAt, detail } = options;
  return {
    ...record,
    status,
    ...buildRecordLifecycleCompleteFields({
      existing: record,
      startedAt: record.startedAt ?? completedAt,
      completedAt,
    }),
    methods: record.methods.map((method) =>
      finalizeVerificationMethodRef({
        verificationId: record.sessionId,
        method,
        target: record.target,
        status,
        completedAt,
        detail,
      }),
    ),
    error: record.error ?? detail,
  };
}

async function rewriteVerificationAsTerminated(options: {
  context: ActiveVerificationContext;
  status: Extract<VerificationStatus, "failed" | "aborted">;
  completedAt: string;
  detail: string;
}): Promise<void> {
  const { context, status, completedAt, detail } = options;
  await rewriteVerificationRecord({
    root: context.root,
    verificationsFilePath: context.verificationsFilePath,
    sessionId: context.verificationId,
    mutate: (existing) => {
      const methods = existing.methods.map((method) =>
        finalizeVerificationMethodRef({
          verificationId: context.verificationId,
          method,
          target: existing.target,
          status,
          completedAt,
          detail,
        }),
      );

      const inProgress =
        existing.status === "queued" || existing.status === "running";
      if (!inProgress) {
        if (
          methods.every((method, index) => method === existing.methods[index])
        ) {
          return existing;
        }
        return {
          ...existing,
          methods,
        };
      }

      return {
        ...existing,
        status,
        methods,
        ...buildRecordLifecycleCompleteFields({
          existing,
          startedAt: existing.startedAt ?? completedAt,
          completedAt,
        }),
        error: existing.error ?? detail,
      };
    },
    forceFlush: true,
  });
}

async function persistMissingTerminatedVerificationRecord(options: {
  context: ActiveVerificationContext;
  status: Extract<VerificationStatus, "failed" | "aborted">;
  completedAt: string;
  detail: string;
}): Promise<void> {
  const { context, status, completedAt, detail } = options;

  try {
    await appendVerificationRecord({
      root: context.root,
      verificationsFilePath: context.verificationsFilePath,
      record: buildTerminatedVerificationRecord({
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

    const existingRecord = await readActiveVerificationRecord(context);
    if (!existingRecord) {
      throw error;
    }

    await materializeTerminalVerificationArtifacts({
      root: context.root,
      verificationId: context.verificationId,
      record: existingRecord,
      status,
      completedAt,
      detail,
    });
    await rewriteVerificationAsTerminated({
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

export async function finalizeActiveVerification(
  verificationId: string,
): Promise<void> {
  if (
    !activeVerification ||
    activeVerification.verificationId !== verificationId
  ) {
    clearActiveVerification(verificationId);
    return;
  }

  if (terminationInFlight) {
    return;
  }

  const context = activeVerification;
  try {
    await finalizeRegisteredVerificationTeardown(context);
  } finally {
    clearActiveVerification(verificationId);
  }
}

function finalizeVerificationMethodRef(options: {
  verificationId: string;
  method: VerificationMethodResultRef;
  target: VerificationRecord["target"];
  status: Extract<VerificationStatus, "failed" | "aborted">;
  completedAt: string;
  detail: string;
}): VerificationMethodResultRef {
  const { verificationId, method, target, status, completedAt, detail } =
    options;

  if (method.status !== "queued" && method.status !== "running") {
    return method;
  }

  const artifactPath =
    method.artifactPath ??
    buildVerificationMethodArtifactPath({
      verificationId,
      method,
    });

  return {
    ...method,
    status,
    artifactPath,
    ...buildOperationLifecycleCompleteFields({
      existing: method,
      startedAt: method.startedAt ?? completedAt,
      completedAt,
    }),
    error: method.error ?? detail,
    ...(method.method === "programmatic" &&
    target.kind !== "run" &&
    method.scope.kind === "run"
      ? { scope: { kind: "target" as const } }
      : {}),
  };
}

async function materializeTerminalVerificationArtifacts(options: {
  root: string;
  verificationId: string;
  record: VerificationRecord;
  status: Extract<VerificationStatus, "failed" | "aborted">;
  completedAt: string;
  detail: string;
}): Promise<void> {
  const { root, verificationId, record, status, completedAt, detail } = options;

  for (const method of record.methods) {
    if (method.status !== "queued" && method.status !== "running") {
      continue;
    }

    const artifactPath = buildVerificationMethodArtifactPath({
      verificationId,
      method,
    });
    if (!artifactPath) {
      continue;
    }

    if (method.method === "rubric") {
      const { template, verifierId } = method;
      if (!template || !verifierId) {
        continue;
      }
      await writeVerificationArtifact({
        root,
        artifactPath,
        artifact: {
          method: "rubric",
          template,
          verifierId,
          generatedAt: completedAt,
          status,
          result: {},
          error: detail,
        },
      });
      continue;
    }

    if (record.target.kind === "run") {
      await writeVerificationArtifact({
        root,
        artifactPath,
        artifact: {
          method: "programmatic",
          generatedAt: completedAt,
          status,
          error: detail,
          target: record.target,
          scope: "run",
          candidates: [],
        },
      });
      continue;
    }

    await writeVerificationArtifact({
      root,
      artifactPath,
      artifact: {
        method: "programmatic",
        generatedAt: completedAt,
        status,
        error: detail,
        target: record.target,
        scope: "target",
        results: [],
      },
    });
  }
}

async function finalizeRegisteredVerificationTeardown(
  context: ActiveVerificationContext,
): Promise<void> {
  await runTeardown(context.teardown);
}

function buildVerificationMethodArtifactPath(options: {
  verificationId: string;
  method: VerificationMethodResultRef;
}): string | undefined {
  const { verificationId, method } = options;
  if (method.method === "programmatic") {
    return getVerificationProgrammaticResultPath(verificationId);
  }
  if (!method.verifierId || !method.template) {
    return undefined;
  }
  return getVerificationRubricResultPath({
    sessionId: verificationId,
    verifierId: method.verifierId,
    template: method.template,
  });
}
