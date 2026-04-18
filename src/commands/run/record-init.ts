import type { RunRecordInitResult } from "../../domain/run/competition/phases.js";
import type { RunRecord, RunSpecTarget } from "../../domain/run/model/types.js";
import { appendRunRecord } from "../../domain/run/persistence/adapter.js";
import { normalizePathForDisplay } from "../../utils/path.js";
import { emitSwarmSessionAcknowledgement } from "../../utils/swarm-session-ack.js";
import { cleanupRunWorkspace } from "../../workspace/cleanup.js";

export interface RecordInitInput {
  readonly root: string;
  readonly runsFilePath: string;
  readonly runId: string;
  readonly specDisplayPath: string;
  readonly specTarget?: RunSpecTarget;
  readonly baseRevisionSha: string;
  readonly repoDisplayPath: string;
  readonly createdAt: string;
  readonly startedAt: string;
  readonly runRoot: string;
  readonly extraContext?: string[];
  readonly extraContextMetadata?: import("../../extra-context/contract.js").PersistedExtraContextMetadataEntry[];
}

/**
 * Initialize and persist the initial run record.
 */
export async function initializeRunRecord(
  input: RecordInitInput,
): Promise<RunRecordInitResult> {
  const {
    root,
    runsFilePath,
    runId,
    specDisplayPath,
    specTarget,
    baseRevisionSha,
    repoDisplayPath,
    createdAt,
    startedAt,
    runRoot,
    extraContext,
    extraContextMetadata,
  } = input;

  const initialRecord: RunRecord = {
    runId,
    spec: {
      path: normalizePathForDisplay(specDisplayPath),
      target: specTarget,
    },
    extraContext,
    extraContextMetadata,
    createdAt,
    startedAt,
    baseRevisionSha,
    rootPath: repoDisplayPath,
    agents: [],
    status: "running",
  };

  try {
    await appendRunRecord({ root, runsFilePath, record: initialRecord });
    await emitSwarmSessionAcknowledgement({
      operator: "run",
      sessionId: runId,
      status: "running",
    });
    return { initialRecord, recordPersisted: true };
  } catch (error) {
    await cleanupRunWorkspace(runRoot);
    throw error;
  }
}
