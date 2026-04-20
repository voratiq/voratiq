import { RunNotFoundCliError } from "../cli/errors.js";
import { RunRecordNotFoundError } from "../domain/run/model/errors.js";
import type { RunRecord } from "../domain/run/model/types.js";
import { fetchRunsSafely } from "../domain/run/persistence/adapter.js";

export interface FetchRunsCLIOptions {
  root: string;
  runsFilePath: string;
  runId: string;
}

export async function fetchRunSafely(
  options: FetchRunsCLIOptions,
): Promise<RunRecord> {
  const { root, runsFilePath, runId } = options;

  const { records } = await fetchRunsSafely({
    root,
    runsFilePath,
    runId,
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

  return runRecord;
}
