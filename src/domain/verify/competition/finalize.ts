import { loadVerificationSelectionPolicyOutput } from "../../../policy/index.js";
import type {
  VerificationMethodResultRef,
  VerificationStatus,
} from "../model/types.js";
import { rewriteVerificationRecord } from "../persistence/adapter.js";
import type { ResolvedVerificationTarget } from "./target.js";

/**
 * Derive the session-level verification status from per-method outcomes.
 *
 * Session status is "succeeded" when at least one terminal method succeeds.
 * Session status is "aborted" only when all terminal methods are aborted.
 * Otherwise, the session is treated as "failed". When no terminal method
 * snapshots exist yet, preserve the historical default of reporting
 * "succeeded" rather than manufacturing a failure.
 */
export function deriveVerificationStatusFromMethods(
  methods: readonly VerificationMethodResultRef[],
): VerificationStatus {
  const terminalMethods = methods.filter(
    (method) =>
      method.status === "succeeded" ||
      method.status === "failed" ||
      method.status === "aborted",
  );
  const hasSucceeded = terminalMethods.some(
    (method) => method.status === "succeeded",
  );
  if (hasSucceeded) {
    return "succeeded";
  }

  const hasTerminalMethods = terminalMethods.length > 0;
  const allTerminalAborted =
    hasTerminalMethods &&
    terminalMethods.every((method) => method.status === "aborted");
  if (allTerminalAborted) {
    return "aborted";
  }

  if (terminalMethods.some((method) => method.status === "failed")) {
    return "failed";
  }

  return "succeeded";
}

export async function maybePersistSelectedSpecPath(options: {
  root: string;
  verificationsFilePath: string;
  verificationId: string;
  resolvedTarget: ResolvedVerificationTarget;
  aliasMap?: Record<string, string>;
  methods: readonly VerificationMethodResultRef[];
}): Promise<void> {
  const {
    root,
    verificationsFilePath,
    verificationId,
    resolvedTarget,
    aliasMap,
    methods,
  } = options;
  if (!("specRecord" in resolvedTarget)) {
    return;
  }

  const record = await loadVerificationSelectionPolicyOutput({
    root,
    record: {
      sessionId: verificationId,
      createdAt: new Date(0).toISOString(),
      status: "succeeded",
      target: resolvedTarget.target,
      methods: [...methods],
      ...(resolvedTarget.specRecord.extraContext
        ? { extraContext: resolvedTarget.specRecord.extraContext }
        : {}),
      ...(resolvedTarget.specRecord.extraContextMetadata
        ? {
            extraContextMetadata:
              resolvedTarget.specRecord.extraContextMetadata,
          }
        : {}),
      ...(aliasMap ? { blinded: { enabled: true as const, aliasMap } } : {}),
    },
    canonicalCandidateIds: resolvedTarget.specRecord.agents.map(
      (agent) => agent.agentId,
    ),
  });

  const decision = record.decision;
  if (decision.state !== "resolvable") {
    return;
  }

  const selected = resolvedTarget.specRecord.agents.find(
    (agent) =>
      agent.status === "succeeded" &&
      agent.agentId === decision.selectedCanonicalAgentId &&
      agent.outputPath,
  );

  if (!selected?.outputPath) {
    return;
  }

  await rewriteVerificationRecord({
    root,
    verificationsFilePath,
    sessionId: verificationId,
    mutate: (existing) => {
      if (existing.target.kind !== "spec") {
        return existing;
      }
      return {
        ...existing,
        target: {
          ...existing.target,
          specPath: selected.outputPath,
        },
      };
    },
    forceFlush: true,
  });
}
