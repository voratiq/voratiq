import { teardownSessionAuth } from "../../agents/runtime/registry.js";
import { loadEnvironmentConfig } from "../../configs/environment/loader.js";
import { loadVerificationConfig } from "../../configs/verification/loader.js";
import { buildBlindedAliasMap } from "../../domains/verifications/competition/blinding.js";
import {
  deriveVerificationStatusFromMethods,
  maybePersistSelectedSpecPath,
} from "../../domains/verifications/competition/finalize.js";
import { executeAndPersistProgrammaticMethod } from "../../domains/verifications/competition/programmatic.js";
import { executeAndPersistRubricMethods } from "../../domains/verifications/competition/rubric.js";
import { createVerificationRecordMutators } from "../../domains/verifications/model/mutators.js";
import type {
  VerificationRecord,
  VerificationStatus,
} from "../../domains/verifications/model/types.js";
import {
  appendVerificationRecord,
  flushVerificationRecordBuffer,
} from "../../domains/verifications/persistence/adapter.js";
import { buildPersistedExtraContextFields } from "../../extra-context/contract.js";
import type { VerifyProgressRenderer } from "../../render/transcripts/verify.js";
import { toErrorMessage } from "../../utils/errors.js";
import { normalizePathForDisplay, relativeToRoot } from "../../utils/path.js";
import {
  resolveWorkspacePath,
  VORATIQ_VERIFICATIONS_SESSIONS_DIR,
} from "../../workspace/structure.js";
import { generateSessionId } from "../shared/session-id.js";
import {
  assertVerifierPreflight,
  resolveVerificationAgents,
} from "./agents.js";
import {
  clearActiveVerification,
  registerActiveVerification,
} from "./lifecycle.js";
import { resolveVerifyRubricMaxParallel } from "./max-parallel.js";
import { resolveVerifyTarget, type VerifyTargetSelection } from "./targets.js";

export interface VerifyCommandInput {
  root: string;
  specsFilePath: string;
  runsFilePath: string;
  reductionsFilePath: string;
  verificationsFilePath: string;
  target: VerifyTargetSelection;
  agentIds?: readonly string[];
  agentOverrideFlag?: string;
  profileName?: string;
  maxParallel?: number;
  extraContextFiles?: readonly import("../../competition/shared/extra-context.js").ResolvedExtraContextFile[];
  renderer?: VerifyProgressRenderer;
}

export interface VerifyCommandResult {
  verificationId: string;
  record: VerificationRecord;
}

export async function executeVerifyCommand(
  input: VerifyCommandInput,
): Promise<VerifyCommandResult> {
  const {
    root,
    specsFilePath,
    runsFilePath,
    reductionsFilePath,
    verificationsFilePath,
    target,
    agentIds,
    agentOverrideFlag,
    profileName,
    maxParallel,
    extraContextFiles = [],
    renderer,
  } = input;

  const resolvedTarget = await resolveVerifyTarget({
    root,
    specsFilePath,
    runsFilePath,
    reductionsFilePath,
    verificationsFilePath,
    target,
  });
  const verificationConfig = loadVerificationConfig({ root });
  const verificationAgents = resolveVerificationAgents({
    agentIds,
    root,
    agentOverrideFlag,
    profileName,
  });
  await assertVerifierPreflight(verificationAgents);

  const environment = loadEnvironmentConfig({ root });
  const verificationId = generateSessionId();
  const createdAt = new Date().toISOString();
  const aliasMap = buildBlindedAliasMap(resolvedTarget);
  const rubricMaxParallel = resolveVerifyRubricMaxParallel({
    targetKind: resolvedTarget.target.kind,
    verificationConfig,
    verifierAgentCount: verificationAgents.length,
    requestedMaxParallel: maxParallel,
  });

  await appendVerificationRecord({
    root,
    verificationsFilePath,
    record: {
      sessionId: verificationId,
      createdAt,
      status: "queued",
      target: resolvedTarget.target,
      ...buildPersistedExtraContextFields(extraContextFiles),
      ...(aliasMap ? { blinded: { enabled: true as const, aliasMap } } : {}),
      methods: [],
    },
  });

  renderer?.begin({
    verificationId,
    createdAt,
    startedAt: createdAt,
    workspacePath: normalizePathForDisplay(
      relativeToRoot(
        root,
        resolveWorkspacePath(
          root,
          VORATIQ_VERIFICATIONS_SESSIONS_DIR,
          verificationId,
        ),
      ),
    ),
    targetKind: resolvedTarget.target.kind,
    targetSessionId: resolvedTarget.target.sessionId,
    status: "running",
  });

  registerActiveVerification({
    root,
    verificationsFilePath,
    verificationId,
  });
  const mutators = createVerificationRecordMutators({
    root,
    verificationsFilePath,
    verificationId,
  });
  await mutators.recordVerificationRunning(createdAt);

  try {
    const [programmaticResult, rubricResult] = await Promise.allSettled([
      executeAndPersistProgrammaticMethod({
        root,
        verificationId,
        resolvedTarget,
        verificationConfig,
        environment,
        mutators,
        renderer,
      }),
      executeAndPersistRubricMethods({
        root,
        verificationId,
        resolvedTarget,
        verificationConfig,
        verifierAgents: verificationAgents,
        aliasMap,
        environment,
        extraContextFiles,
        maxParallel: rubricMaxParallel,
        mutators,
        renderer,
      }),
    ]);

    if (programmaticResult.status === "rejected") {
      throw programmaticResult.reason;
    }

    if (rubricResult.status === "rejected") {
      throw rubricResult.reason;
    }

    const persistedRecord = await mutators.readRecord();
    if (!persistedRecord) {
      throw new Error(
        `Verification record \`${verificationId}\` not found after method execution.`,
      );
    }

    await maybePersistSelectedSpecPath({
      root,
      verificationsFilePath,
      verificationId,
      resolvedTarget,
      aliasMap,
      methods: persistedRecord.methods,
    });

    const record = await completeVerificationRecord({
      mutators,
      status: deriveVerificationStatusFromMethods(persistedRecord.methods),
    });

    renderer?.complete(record.status, {
      startedAt: record.startedAt,
      completedAt: record.completedAt,
    });

    return { verificationId, record };
  } catch (error) {
    const failedRecord = await completeVerificationRecord({
      mutators,
      status: "failed",
      error: toErrorMessage(error),
    }).catch(() => undefined);

    if (failedRecord) {
      renderer?.complete(failedRecord.status, {
        startedAt: failedRecord.startedAt,
        completedAt: failedRecord.completedAt,
      });
      await flushVerificationRecordBuffer({
        verificationsFilePath,
        sessionId: verificationId,
      }).catch(() => {});
    }

    throw error;
  } finally {
    clearActiveVerification(verificationId);
    await teardownSessionAuth(verificationId).catch(() => {});
  }
}

async function completeVerificationRecord(options: {
  mutators: ReturnType<typeof createVerificationRecordMutators>;
  status: VerificationStatus;
  error?: string;
}): Promise<VerificationRecord> {
  const { mutators, status, error } = options;
  return await mutators.completeVerification({ status, error });
}
