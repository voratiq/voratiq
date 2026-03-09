import { RunNotFoundCliError } from "../cli/errors.js";
import { RunRecordNotFoundError } from "../domains/runs/model/errors.js";
import type { RunRecord } from "../domains/runs/model/types.js";
import { fetchRunsSafely } from "../domains/runs/persistence/adapter.js";

export interface FetchRunsCLIOptions {
  root: string;
  runsFilePath: string;
  runId: string;
  onDeleted: (runRecord: RunRecord) => Error;
}

export async function fetchRunSafely(
  options: FetchRunsCLIOptions,
): Promise<RunRecord> {
  const { root, runsFilePath, runId, onDeleted } = options;

  const { records } = await fetchRunsSafely({
    root,
    runsFilePath,
    runId,
    filters: { includeDeleted: true },
  }).catch((error) => {
    if (error instanceof RunRecordNotFoundError) {
      throw new RunNotFoundCliError(runId);
    }
    throw error;
  });

  const runRecord = records[0];
  if (!runRecord) {
    throw new RunNotFoundCliError(runId);
  }

  if (runRecord.deletedAt) {
    throw onDeleted(runRecord);
  }

  return runRecord;
}
