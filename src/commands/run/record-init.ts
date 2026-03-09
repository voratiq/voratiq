import type { RunRecord } from "../../domains/runs/model/types.js";
import { appendRunRecord } from "../../domains/runs/persistence/adapter.js";
import { normalizePathForDisplay } from "../../utils/path.js";
import { cleanupRunWorkspace } from "../../workspace/cleanup.js";
import type { RunRecordInitResult } from "./phases.js";

export interface RecordInitInput {
  readonly root: string;
  readonly runsFilePath: string;
  readonly runId: string;
  readonly specDisplayPath: string;
  readonly baseRevisionSha: string;
  readonly repoDisplayPath: string;
  readonly createdAt: string;
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
    baseRevisionSha,
    repoDisplayPath,
    createdAt,
    runRoot,
    extraContext,
    extraContextMetadata,
  } = input;

  const initialRecord: RunRecord = {
    runId,
    spec: {
      path: normalizePathForDisplay(specDisplayPath),
    },
    extraContext,
    extraContextMetadata,
    createdAt,
    baseRevisionSha,
    rootPath: repoDisplayPath,
    agents: [],
    status: "running",
    deletedAt: null,
  };

  try {
    await appendRunRecord({ root, runsFilePath, record: initialRecord });
    return { initialRecord, recordPersisted: true };
  } catch (error) {
    await cleanupRunWorkspace(runRoot);
    throw error;
  }
}
