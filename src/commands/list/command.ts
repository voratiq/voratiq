import {
  fetchRunsSafely,
  type RunQueryFilters,
  type RunRecordWarning,
} from "../../records/persistence.js";
import { renderListTranscript } from "../../render/transcripts/list.js";
import { pathExists } from "../../utils/fs.js";

const DEFAULT_LIMIT = 10;

export interface ListCommandInput {
  root: string;
  runsFilePath: string;
  limit?: number;
  specPath?: string;
  runId?: string;
  includePruned?: boolean;
}

export interface ListCommandResult {
  warnings: string[];
  output?: string;
}

export async function executeListCommand(
  input: ListCommandInput,
): Promise<ListCommandResult> {
  const { root, runsFilePath, specPath, runId, includePruned } = input;
  const limit = input.limit ?? DEFAULT_LIMIT;

  const result = await listRuns({
    root,
    runsFilePath,
    limit,
    specPath,
    runId,
    includePruned,
  });

  return {
    warnings: result.warnings,
    output: result.output,
  };
}

interface ListRunsOptions {
  root: string;
  runsFilePath: string;
  limit: number;
  specPath?: string;
  runId?: string;
  includePruned?: boolean;
}

interface ListRunsResult {
  warnings: string[];
  output?: string;
}

async function listRuns(options: ListRunsOptions): Promise<ListRunsResult> {
  const { root, runsFilePath, limit, specPath, runId, includePruned } = options;

  if (!(await pathExists(runsFilePath))) {
    return { warnings: [] };
  }

  const filters: RunQueryFilters = {};
  if (includePruned) {
    filters.includeDeleted = true;
  }
  if (specPath) {
    filters.specPath = specPath;
  }
  if (runId) {
    filters.runId = runId;
  }

  const { records, warnings } = await fetchRunsSafely({
    root,
    runsFilePath,
    limit,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
  });

  const formattedWarnings = warnings.map((warning: RunRecordWarning) =>
    formatWarningMessage(warning),
  );

  if (records.length === 0) {
    const hasFilters = specPath || runId;
    const emptyMessage = hasFilters
      ? "No records match the provided filters."
      : undefined;
    return { warnings: formattedWarnings, output: emptyMessage };
  }

  return {
    warnings: formattedWarnings,
    output: renderListTranscript(records),
  };
}

function formatWarningMessage(warning: RunRecordWarning): string {
  if (warning.kind === "missing-record") {
    return `Run ${warning.runId} was referenced in the index, but ${warning.displayPath} is missing.`;
  }

  return `Ignored corrupt run data at ${warning.displayPath}: ${warning.details}`;
}
