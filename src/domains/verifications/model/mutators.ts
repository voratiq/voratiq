import {
  buildLifecycleStartFields,
  buildRecordLifecycleCompleteFields,
} from "../../shared/lifecycle.js";
import { rewriteVerificationRecord } from "../persistence/adapter.js";
import type {
  VerificationMethodResultRef,
  VerificationRecord,
  VerificationStatus,
} from "./types.js";

export interface VerificationRecordMutators {
  recordVerificationRunning: (timestamp?: string) => Promise<void>;
  recordMethodSnapshot: (method: VerificationMethodResultRef) => Promise<void>;
  completeVerification: (options: {
    status: VerificationStatus;
    error?: string | null;
  }) => Promise<VerificationRecord>;
  readRecord: () => Promise<VerificationRecord | undefined>;
}

export interface CreateVerificationRecordMutatorsInput {
  readonly root: string;
  readonly verificationsFilePath: string;
  readonly verificationId: string;
}

export function createVerificationRecordMutators(
  input: CreateVerificationRecordMutatorsInput,
): VerificationRecordMutators {
  const { root, verificationsFilePath, verificationId } = input;

  return {
    recordVerificationRunning: async (timestamp = new Date().toISOString()) => {
      await rewriteVerificationRecord({
        root,
        verificationsFilePath,
        sessionId: verificationId,
        mutate: (existing) => {
          if (existing.status !== "queued" && existing.status !== "running") {
            return existing;
          }

          return {
            ...existing,
            status: "running",
            ...buildLifecycleStartFields({
              existingStartedAt: existing.startedAt,
              timestamp,
            }),
          };
        },
      });
    },
    recordMethodSnapshot: async (method) => {
      await rewriteVerificationRecord({
        root,
        verificationsFilePath,
        sessionId: verificationId,
        mutate: (existing) => {
          if (existing.status !== "queued" && existing.status !== "running") {
            return existing;
          }

          const methods = [...existing.methods];
          const index = methods.findIndex(
            (entry) => methodRefKey(entry) === methodRefKey(method),
          );
          const current = index >= 0 ? methods[index] : undefined;
          const merged = mergeMethodRefs(current, method);

          if (index >= 0) {
            methods[index] = merged;
          } else {
            methods.push(merged);
          }

          const startedAt = merged.startedAt;

          return {
            ...existing,
            status:
              existing.status === "queued" && merged.status === "running"
                ? "running"
                : existing.status,
            ...(startedAt
              ? buildLifecycleStartFields({
                  existingStartedAt: existing.startedAt,
                  timestamp: startedAt,
                })
              : {}),
            methods,
          };
        },
      });
    },
    completeVerification: async ({ status, error }) =>
      await rewriteVerificationRecord({
        root,
        verificationsFilePath,
        sessionId: verificationId,
        mutate: (existing) => {
          if (existing.status !== "queued" && existing.status !== "running") {
            return existing;
          }

          const completedAt = new Date().toISOString();
          return {
            ...existing,
            status,
            ...buildRecordLifecycleCompleteFields({
              existing,
              startedAt: existing.startedAt ?? completedAt,
              completedAt,
            }),
            ...(error ? { error } : {}),
          };
        },
        forceFlush: true,
      }),
    readRecord: async () =>
      await rewriteVerificationRecord({
        root,
        verificationsFilePath,
        sessionId: verificationId,
        mutate: (record) => record,
      }),
  };
}

function methodRefKey(method: VerificationMethodResultRef): string {
  return method.method === "programmatic"
    ? `${method.method}:${method.scope.kind}`
    : `${method.method}:${method.template}:${method.verifierId}:${method.scope.kind}:${method.scope.kind === "candidate" ? method.scope.candidateId : "_"}`;
}

function mergeMethodRefs(
  existing: VerificationMethodResultRef | undefined,
  incoming: VerificationMethodResultRef,
): VerificationMethodResultRef {
  if (
    existing &&
    isTerminalVerificationStatus(existing.status) &&
    !isTerminalVerificationStatus(incoming.status)
  ) {
    return existing;
  }

  const merged = {
    ...(existing ?? {}),
    ...incoming,
  } as VerificationMethodResultRef;

  if (incoming.artifactPath === undefined && existing?.artifactPath) {
    merged.artifactPath = existing.artifactPath;
  }

  if (incoming.startedAt === undefined && existing?.startedAt) {
    merged.startedAt = existing.startedAt;
  }

  if (incoming.completedAt === undefined && existing?.completedAt) {
    merged.completedAt = existing.completedAt;
  }

  if (incoming.tokenUsage === undefined && existing?.tokenUsage) {
    merged.tokenUsage = existing.tokenUsage;
  }

  if (incoming.error === undefined && existing?.error !== undefined) {
    merged.error = existing.error;
  }

  return merged;
}

function isTerminalVerificationStatus(status: VerificationStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "aborted";
}
