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
  flushVerificationRecordBuffer,
  readVerificationRecords,
  rewriteVerificationRecord,
} from "../../domain/verify/persistence/adapter.js";
import type { VerificationStatus } from "../../status/index.js";
import { toErrorMessage } from "../../utils/errors.js";
import {
  getVerificationProgrammaticResultPath,
  getVerificationRubricResultPath,
} from "../../workspace/structure.js";

export const VERIFY_ABORT_DETAIL = "Verification aborted before completion.";

interface ActiveVerificationContext {
  root: string;
  verificationsFilePath: string;
  verificationId: string;
  teardown?: TeardownController;
}

let activeVerification: ActiveVerificationContext | undefined;
let terminationInFlight = false;

export function registerActiveVerification(
  context: ActiveVerificationContext,
): void {
  activeVerification = context;
}

export function clearActiveVerification(verificationId: string): void {
  if (activeVerification?.verificationId !== verificationId) {
    return;
  }

  if (!terminationInFlight) {
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
    const existingRecord = await readVerificationRecords({
      root: context.root,
      verificationsFilePath: context.verificationsFilePath,
      limit: 1,
      predicate: (record) => record.sessionId === context.verificationId,
    }).then((records) => records[0]);

    if (!existingRecord) {
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
      terminationInFlight = false;
      activeVerification = undefined;
    }
  }

  if (persistenceError) {
    throw persistenceError;
  }
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
