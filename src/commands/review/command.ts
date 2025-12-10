import type { RunRecordEnhanced } from "../../records/enhanced.js";
import { buildRunRecordView } from "../../records/enhanced.js";
import { RunRecordNotFoundError } from "../../records/errors.js";
import { fetchRunsSafely } from "../../records/persistence.js";
import { RunNotFoundCliError } from "../errors.js";

export interface ReviewCommandInput {
  root: string;
  runsFilePath: string;
  runId: string;
}

export interface ReviewCommandResult {
  runRecord: RunRecordEnhanced;
}

export async function executeReviewCommand(
  input: ReviewCommandInput,
): Promise<ReviewCommandResult> {
  const { root, runsFilePath, runId } = input;

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

  const enhanced = await buildRunRecordView(runRecord, {
    workspaceRoot: root,
  });

  return { runRecord: enhanced };
}
