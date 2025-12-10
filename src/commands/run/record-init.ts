import { appendRunRecord } from "../../records/persistence.js";
import type { RunRecord } from "../../records/types.js";
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
  } = input;

  const initialRecord: RunRecord = {
    runId,
    spec: {
      path: normalizePathForDisplay(specDisplayPath),
    },
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
