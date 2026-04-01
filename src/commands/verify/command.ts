import { teardownSessionAuth } from "../../agents/runtime/registry.js";
import { createTeardownController } from "../../competition/shared/teardown.js";
import { loadEnvironmentConfig } from "../../configs/environment/loader.js";
import { loadVerificationConfig } from "../../configs/verification/loader.js";
import { buildBlindedAliasMap } from "../../domain/verify/competition/blinding.js";
import {
  deriveVerificationStatusFromMethods,
  maybePersistSelectedSpecPath,
} from "../../domain/verify/competition/finalize.js";
import { executeAndPersistProgrammaticMethod } from "../../domain/verify/competition/programmatic.js";
import { executeAndPersistRubricMethods } from "../../domain/verify/competition/rubric.js";
import { createVerificationRecordMutators } from "../../domain/verify/model/mutators.js";
import type {
  VerificationRecord,
  VerificationStatus,
} from "../../domain/verify/model/types.js";
import {
  appendVerificationRecord,
  flushVerificationRecordBuffer,
} from "../../domain/verify/persistence/adapter.js";
import { buildPersistedExtraContextFields } from "../../extra-context/contract.js";
import type { VerifyProgressRenderer } from "../../render/transcripts/verify.js";
import { toErrorMessage } from "../../utils/errors.js";
import { normalizePathForDisplay, relativeToRoot } from "../../utils/path.js";
import {
  resolveWorkspacePath,
  VORATIQ_VERIFICATION_SESSIONS_DIR,
} from "../../workspace/structure.js";
import { generateSessionId } from "../shared/session-id.js";
import {
  assertVerifierPreflight,
  resolveVerificationAgents,
} from "./agents.js";
import {
  finalizeActiveVerification,
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
          VORATIQ_VERIFICATION_SESSIONS_DIR,
          verificationId,
        ),
      ),
    ),
    status: "running",
  });

  const teardown = createTeardownController(`verify \`${verificationId}\``);
  teardown.addAction({
    key: `verify-auth:${verificationId}`,
    label: "session auth",
    cleanup: async () => {
      await teardownSessionAuth(verificationId);
    },
  });

  registerActiveVerification({
    root,
    verificationsFilePath,
    verificationId,
    teardown,
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
        teardown,
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
    await finalizeActiveVerification(verificationId);
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
