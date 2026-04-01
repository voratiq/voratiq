import type { ReductionRecord } from "../../domain/reduce/model/types.js";
import {
  readReductionRecords,
  type ReductionRecordWarning,
} from "../../domain/reduce/persistence/adapter.js";
import type { RunRecord } from "../../domain/run/model/types.js";
import {
  readRunRecords,
  type RunRecordWarning,
} from "../../domain/run/persistence/adapter.js";
import type { SpecRecord } from "../../domain/spec/model/types.js";
import {
  readSpecRecords,
  type SpecRecordWarning,
} from "../../domain/spec/persistence/adapter.js";
import type {
  VerificationMethodResultRef,
  VerificationRecord,
} from "../../domain/verify/model/types.js";
import { TERMINAL_VERIFICATION_STATUSES } from "../../domain/verify/model/types.js";
import {
  readVerificationRecords,
  type VerificationRecordWarning,
} from "../../domain/verify/persistence/adapter.js";
import {
  renderListTableTranscript,
  renderReduceList,
  renderRunList,
  renderSpecList,
  renderVerifyList,
} from "../../render/transcripts/list.js";
import {
  formatReduceElapsed,
  formatReducerDuration,
  renderReduceTranscript,
} from "../../render/transcripts/reduce.js";
import {
  formatRunElapsed,
  renderRunTranscript,
} from "../../render/transcripts/run.js";
import {
  formatSpecAgentDuration,
  formatSpecElapsed,
  renderSpecTranscript,
} from "../../render/transcripts/spec.js";
import {
  formatVerifyElapsed,
  renderVerifyTranscript,
} from "../../render/transcripts/verify.js";
import { formatAgentDuration } from "../../render/utils/agents.js";
import { formatRenderLifecycleDuration } from "../../render/utils/duration.js";
import { formatCompactDiffStatistics } from "../../utils/diff.js";
import { pathExists } from "../../utils/fs.js";
import {
  getReductionSessionDirectoryPath,
  getRunDirectoryPath,
  getSpecSessionDirectoryPath,
  getVerificationSessionDirectoryPath,
} from "../../workspace/structure.js";

const DEFAULT_LIMIT = 10;
const DASH = "—";

export type ListOperator = "spec" | "run" | "reduce" | "verify";
export type ListMode = "table" | "detail";

interface ListJsonRecordBase {
  id: string;
  status: string;
  createdAt: string;
}

interface ListJsonTargetRef {
  kind: string;
  id: string;
}

export interface RunListJsonTableRecord extends ListJsonRecordBase {
  specPath: string;
}

export interface SpecListJsonTableRecord extends ListJsonRecordBase {
  description: string | null;
}

export interface TargetedListJsonTableRecord extends ListJsonRecordBase {
  target: ListJsonTargetRef;
}

export type ListJsonTableRecord =
  | RunListJsonTableRecord
  | SpecListJsonTableRecord
  | TargetedListJsonTableRecord;

export interface RunListJsonRow {
  agentId: string;
  status: string;
  duration: string;
  changes: string | null;
}

export interface SpecListJsonRow {
  agentId: string;
  status: string;
  duration: string;
}

export interface ReduceListJsonRow {
  agentId: string;
  status: string;
  duration: string;
}

export interface VerifyListJsonRow {
  agentId: string | null;
  verifier: string;
  status: string;
  duration: string;
}

export type ListJsonRow =
  | RunListJsonRow
  | SpecListJsonRow
  | ReduceListJsonRow
  | VerifyListJsonRow;

export interface SpecListJsonArtifact {
  kind: "spec";
  agentId: string;
  path: string | null;
}

export interface ReductionListJsonArtifact {
  kind: "reduction";
  agentId: string;
  path: string | null;
}

export interface VerificationListJsonArtifact {
  kind: "result";
  agentId: string | null;
  verifier: string;
  path: string | null;
}

export type ListJsonArtifact =
  | SpecListJsonArtifact
  | ReductionListJsonArtifact
  | VerificationListJsonArtifact;

export interface ListJsonTableOutput {
  operator: ListOperator;
  mode: "table";
  records: ListJsonTableRecord[];
  warnings: string[];
}

export interface ListJsonDetailOutput {
  operator: ListOperator;
  mode: "detail";
  sessionId: string;
  session: {
    id: string;
    status: string;
    createdAt: string;
    elapsed?: string;
    workspacePath: string;
    rows: ListJsonRow[];
    artifacts: ListJsonArtifact[];
  } | null;
  warnings: string[];
}

export type ListJsonOutput = ListJsonTableOutput | ListJsonDetailOutput;

export interface ListCommandInput {
  root: string;
  specsFilePath: string;
  runsFilePath: string;
  reductionsFilePath: string;
  verificationsFilePath: string;
  operator: ListOperator;
  sessionId?: string;
  limit?: number;
  verbose?: boolean;
}

export interface ListCommandResult {
  warnings: string[];
  output?: string;
  mode: ListMode;
  json: ListJsonOutput;
}

export async function executeListCommand(
  input: ListCommandInput,
): Promise<ListCommandResult> {
  const mode: ListMode = input.sessionId ? "detail" : "table";
  const limit = input.limit ?? DEFAULT_LIMIT;

  if (mode === "detail") {
    return await executeDetailMode(input);
  }

  return await executeTableMode({
    ...input,
    limit,
  });
}

async function executeTableMode(
  input: ListCommandInput & { limit: number },
): Promise<ListCommandResult> {
  const { operator, limit, verbose = false } = input;
  const query = await readOperatorRecords({ ...input, limit: undefined });
  const filtered = verbose
    ? query.records
    : query.records.filter((record) =>
        shouldIncludeInDefaultTable(operator, getRecordStatus(record)),
      );
  const records = filtered.slice(0, limit);
  const warnings = query.warnings;
  const output = renderTableOutput(operator, records);

  return {
    warnings,
    output,
    mode: "table",
    json: {
      operator,
      mode: "table",
      records: records.map((record) => toJsonTableRecord(operator, record)),
      warnings,
    },
  };
}

async function executeDetailMode(
  input: ListCommandInput,
): Promise<ListCommandResult> {
  const { operator } = input;
  const sessionId = input.sessionId;
  if (!sessionId) {
    throw new Error("Session ID is required for detail mode.");
  }

  const query = await readOperatorRecords({
    ...input,
    limit: 1,
    predicate: (record) => getRecordId(operator, record) === sessionId,
  });
  const warnings = query.warnings;
  const record = query.records[0];

  if (!record) {
    return {
      warnings,
      output: `${operator} session \`${sessionId}\` not found.`,
      mode: "detail",
      json: {
        operator,
        mode: "detail",
        sessionId,
        session: null,
        warnings,
      },
    };
  }

  return {
    warnings,
    output: renderDetailOutput(operator, record),
    mode: "detail",
    json: {
      operator,
      mode: "detail",
      sessionId,
      session: toJsonDetailSession(operator, record),
      warnings,
    },
  };
}

function renderTableOutput(
  operator: ListOperator,
  records: readonly OperatorRecord[],
): string | undefined {
  if (records.length === 0) {
    return undefined;
  }

  const table =
    operator === "run"
      ? renderRunList(records as readonly RunRecord[])
      : operator === "spec"
        ? renderSpecList(records as readonly SpecRecord[])
        : operator === "reduce"
          ? renderReduceList(records as readonly ReductionRecord[])
          : renderVerifyList(records as readonly VerificationRecord[]);

  return renderListTableTranscript(table);
}

function renderDetailOutput(operator: ListOperator, record: OperatorRecord) {
  if (operator === "run") {
    const runRecord = record as RunRecord;
    return renderRunTranscript({
      runId: runRecord.runId,
      status: runRecord.status,
      workspacePath: getRunDirectoryPath(runRecord.runId),
      createdAt: runRecord.createdAt,
      startedAt: runRecord.startedAt,
      completedAt: runRecord.completedAt,
      agents: runRecord.agents.map((agent) => ({
        agentId: agent.agentId,
        status: agent.status,
        startedAt: agent.startedAt,
        completedAt: agent.completedAt,
        diffStatistics: agent.diffStatistics,
      })),
      isTty: process.stdout.isTTY,
    });
  }

  if (operator === "spec") {
    const specRecord = record as SpecRecord;
    return renderSpecTranscript(
      {
        sessionId: specRecord.sessionId,
        createdAt: specRecord.createdAt,
        elapsed:
          formatSpecElapsed({
            status: specRecord.status,
            startedAt: specRecord.startedAt,
            completedAt: specRecord.completedAt,
          }) ?? DASH,
        workspacePath: getSpecSessionDirectoryPath(specRecord.sessionId),
        status: specRecord.status,
        agents: specRecord.agents.map((agent) => ({
          agentId: agent.agentId,
          status: agent.status,
          duration: formatSpecAgentDuration({
            status: agent.status,
            startedAt: agent.startedAt,
            completedAt: agent.completedAt,
          }),
          outputPath: agent.outputPath,
          dataPath: agent.dataPath,
          errorLine: agent.error ?? undefined,
        })),
        isTty: process.stdout.isTTY,
      },
      { suppressHint: true },
    );
  }

  if (operator === "reduce") {
    const reductionRecord = record as ReductionRecord;
    return renderReduceTranscript({
      reductionId: reductionRecord.sessionId,
      createdAt: reductionRecord.createdAt,
      elapsed:
        formatReduceElapsed({
          status: reductionRecord.status,
          startedAt: reductionRecord.startedAt,
          completedAt: reductionRecord.completedAt,
        }) ?? DASH,
      workspacePath: getReductionSessionDirectoryPath(
        reductionRecord.sessionId,
      ),
      status: reductionRecord.status,
      reducers: reductionRecord.reducers.map((reducer) => ({
        reducerAgentId: reducer.agentId,
        status: reducer.status,
        duration: formatReducerDuration({
          status: reducer.status,
          startedAt: reducer.startedAt,
          completedAt: reducer.completedAt,
        }),
        outputPath: reducer.outputPath,
        dataPath: reducer.dataPath,
        errorLine: reducer.error ?? undefined,
      })),
      suppressHint: true,
      isTty: process.stdout.isTTY,
    });
  }

  const verificationRecord = record as VerificationRecord;
  return renderVerifyTranscript({
    verificationId: verificationRecord.sessionId,
    createdAt: verificationRecord.createdAt,
    elapsed:
      formatVerifyElapsed({
        status: verificationRecord.status,
        startedAt: verificationRecord.startedAt,
        completedAt: verificationRecord.completedAt,
      }) ?? DASH,
    workspacePath: getVerificationSessionDirectoryPath(
      verificationRecord.sessionId,
    ),
    status: verificationRecord.status,
    methods: verificationRecord.methods.map((method) => ({
      verifierLabel:
        method.method === "programmatic"
          ? "programmatic"
          : (method.template ?? "rubric"),
      agentLabel: method.verifierId,
      status: method.status,
      duration: formatVerifyMethodDuration(method),
      artifactPath: method.artifactPath,
      errorLine: method.error ?? undefined,
    })),
    suppressHint: true,
    isTty: process.stdout.isTTY,
  });
}

function toJsonTableRecord(
  operator: ListOperator,
  record: OperatorRecord,
): ListJsonTableRecord {
  if (operator === "run") {
    const runRecord = record as RunRecord;
    return {
      id: runRecord.runId,
      status: runRecord.status,
      createdAt: runRecord.createdAt,
      specPath: runRecord.spec.path,
    };
  }

  if (operator === "spec") {
    const specRecord = record as SpecRecord;
    return {
      id: specRecord.sessionId,
      status: specRecord.status,
      createdAt: specRecord.createdAt,
      description: normalizeDescription(specRecord.description),
    };
  }

  if (operator === "reduce") {
    const reductionRecord = record as ReductionRecord;
    return {
      id: reductionRecord.sessionId,
      status: reductionRecord.status,
      createdAt: reductionRecord.createdAt,
      target: {
        kind: reductionRecord.target.type,
        id: reductionRecord.target.id,
      },
    };
  }

  const verificationRecord = record as VerificationRecord;
  return {
    id: verificationRecord.sessionId,
    status: verificationRecord.status,
    createdAt: verificationRecord.createdAt,
    target: {
      kind: verificationRecord.target.kind,
      id: verificationRecord.target.sessionId,
    },
  };
}

function toJsonDetailSession(
  operator: ListOperator,
  record: OperatorRecord,
): NonNullable<ListJsonDetailOutput["session"]> {
  if (operator === "run") {
    const runRecord = record as RunRecord;
    return {
      id: runRecord.runId,
      status: runRecord.status,
      createdAt: runRecord.createdAt,
      elapsed: formatRunRecordElapsed(runRecord),
      workspacePath: getRunDirectoryPath(runRecord.runId),
      rows: runRecord.agents.map(toRunJsonRow),
      artifacts: [],
    };
  }

  if (operator === "spec") {
    const specRecord = record as SpecRecord;
    return {
      id: specRecord.sessionId,
      status: specRecord.status,
      createdAt: specRecord.createdAt,
      elapsed: formatSpecRecordElapsed(specRecord),
      workspacePath: getSpecSessionDirectoryPath(specRecord.sessionId),
      rows: specRecord.agents.map(toSpecJsonRow),
      artifacts: specRecord.agents.map(toSpecArtifact),
    };
  }

  if (operator === "reduce") {
    const reductionRecord = record as ReductionRecord;
    return {
      id: reductionRecord.sessionId,
      status: reductionRecord.status,
      createdAt: reductionRecord.createdAt,
      elapsed: formatReductionRecordElapsed(reductionRecord),
      workspacePath: getReductionSessionDirectoryPath(
        reductionRecord.sessionId,
      ),
      rows: reductionRecord.reducers.map(toReductionJsonRow),
      artifacts: reductionRecord.reducers.map(toReductionArtifact),
    };
  }

  const verificationRecord = record as VerificationRecord;
  return {
    id: verificationRecord.sessionId,
    status: verificationRecord.status,
    createdAt: verificationRecord.createdAt,
    elapsed: formatVerificationRecordElapsed(verificationRecord),
    workspacePath: getVerificationSessionDirectoryPath(
      verificationRecord.sessionId,
    ),
    rows: verificationRecord.methods.map(toVerificationJsonRow),
    artifacts: verificationRecord.methods.map(toVerificationArtifact),
  };
}

function formatRunRecordElapsed(record: RunRecord): string | undefined {
  return formatRunElapsed({
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  });
}

function formatSpecRecordElapsed(record: SpecRecord): string | undefined {
  return formatSpecElapsed({
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  });
}

function formatReductionRecordElapsed(
  record: ReductionRecord,
): string | undefined {
  return formatReduceElapsed({
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  });
}

function formatVerificationRecordElapsed(
  record: VerificationRecord,
): string | undefined {
  return formatVerifyElapsed({
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  });
}

function formatRunRowDuration(agent: RunRecord["agents"][number]): string {
  return agent.status === "running"
    ? DASH
    : (formatAgentDuration(agent) ?? DASH);
}

function toRunJsonRow(agent: RunRecord["agents"][number]): RunListJsonRow {
  return {
    agentId: agent.agentId,
    status: agent.status,
    duration: formatRunRowDuration(agent),
    changes: formatCompactDiffStatistics(agent.diffStatistics) ?? null,
  };
}

function formatSpecRowDuration(agent: SpecRecord["agents"][number]): string {
  return (
    formatSpecAgentDuration({
      status: agent.status,
      startedAt: agent.startedAt,
      completedAt: agent.completedAt,
    }) ?? DASH
  );
}

function toSpecJsonRow(agent: SpecRecord["agents"][number]): SpecListJsonRow {
  return {
    agentId: agent.agentId,
    status: agent.status,
    duration: formatSpecRowDuration(agent),
  };
}

function toSpecArtifact(
  agent: SpecRecord["agents"][number],
): SpecListJsonArtifact {
  return {
    kind: "spec",
    agentId: agent.agentId,
    path: agent.outputPath ?? null,
  };
}

function formatReductionRowDuration(
  reducer: ReductionRecord["reducers"][number],
): string {
  return (
    formatReducerDuration({
      status: reducer.status,
      startedAt: reducer.startedAt,
      completedAt: reducer.completedAt,
    }) ?? DASH
  );
}

function toReductionJsonRow(
  reducer: ReductionRecord["reducers"][number],
): ReduceListJsonRow {
  return {
    agentId: reducer.agentId,
    status: reducer.status,
    duration: formatReductionRowDuration(reducer),
  };
}

function toReductionArtifact(
  reducer: ReductionRecord["reducers"][number],
): ReductionListJsonArtifact {
  return {
    kind: "reduction",
    agentId: reducer.agentId,
    path: reducer.outputPath ?? null,
  };
}

function getVerificationMethodLabel(
  method: VerificationRecord["methods"][number],
): string {
  return method.method === "programmatic"
    ? "programmatic"
    : (method.template ?? "rubric");
}

function toVerificationJsonRow(
  method: VerificationRecord["methods"][number],
): VerifyListJsonRow {
  return {
    agentId: method.verifierId ?? null,
    verifier: getVerificationMethodLabel(method),
    status: method.status,
    duration: formatVerifyMethodDuration(method),
  };
}

function toVerificationArtifact(
  method: VerificationRecord["methods"][number],
): VerificationListJsonArtifact {
  return {
    kind: "result",
    agentId: method.verifierId ?? null,
    verifier: getVerificationMethodLabel(method),
    path: method.artifactPath ?? null,
  };
}

function shouldIncludeInDefaultTable(
  operator: ListOperator,
  status: string,
): boolean {
  if (status === "aborted") {
    return false;
  }

  if (operator === "run" && status === "pruned") {
    return false;
  }

  return true;
}

type OperatorRecord =
  | RunRecord
  | SpecRecord
  | ReductionRecord
  | VerificationRecord;

interface ReadOperatorRecordsInput {
  root: string;
  specsFilePath: string;
  runsFilePath: string;
  reductionsFilePath: string;
  verificationsFilePath: string;
  operator: ListOperator;
  limit?: number;
  predicate?: (record: OperatorRecord) => boolean;
}

interface ReadOperatorRecordsOutput {
  records: OperatorRecord[];
  warnings: string[];
}

async function readOperatorRecords(
  input: ReadOperatorRecordsInput,
): Promise<ReadOperatorRecordsOutput> {
  const { root, operator } = input;

  if (operator === "run") {
    if (!(await pathExists(input.runsFilePath))) {
      return { records: [], warnings: [] };
    }

    const warnings: RunRecordWarning[] = [];
    const records = await readRunRecords({
      root,
      runsFilePath: input.runsFilePath,
      limit: input.limit,
      predicate: input.predicate as
        | ((record: RunRecord) => boolean)
        | undefined,
      onWarning: (warning) => warnings.push(warning),
    });

    return {
      records,
      warnings: warnings.map(formatSessionWarning),
    };
  }

  if (operator === "spec") {
    if (!(await pathExists(input.specsFilePath))) {
      return { records: [], warnings: [] };
    }

    const warnings: SpecRecordWarning[] = [];
    const records = await readSpecRecords({
      root,
      specsFilePath: input.specsFilePath,
      limit: input.limit,
      predicate: input.predicate as
        | ((record: SpecRecord) => boolean)
        | undefined,
      onWarning: (warning) => warnings.push(warning),
    });

    return {
      records,
      warnings: warnings.map(formatSessionWarning),
    };
  }

  if (operator === "reduce") {
    if (!(await pathExists(input.reductionsFilePath))) {
      return { records: [], warnings: [] };
    }

    const warnings: ReductionRecordWarning[] = [];
    const records = await readReductionRecords({
      root,
      reductionsFilePath: input.reductionsFilePath,
      limit: input.limit,
      predicate: input.predicate as
        | ((record: ReductionRecord) => boolean)
        | undefined,
      onWarning: (warning) => warnings.push(warning),
    });

    return {
      records,
      warnings: warnings.map(formatSessionWarning),
    };
  }

  if (!(await pathExists(input.verificationsFilePath))) {
    return { records: [], warnings: [] };
  }

  const warnings: VerificationRecordWarning[] = [];
  const records = await readVerificationRecords({
    root,
    verificationsFilePath: input.verificationsFilePath,
    limit: input.limit,
    predicate: input.predicate as
      | ((record: VerificationRecord) => boolean)
      | undefined,
    onWarning: (warning) => warnings.push(warning),
  });

  return {
    records,
    warnings: warnings.map(formatSessionWarning),
  };
}

function getRecordStatus(record: OperatorRecord): string {
  if ("runId" in record) {
    return record.status;
  }
  return record.status;
}

function getRecordId(operator: ListOperator, record: OperatorRecord): string {
  if (operator === "run") {
    return (record as RunRecord).runId;
  }
  return (record as SpecRecord | ReductionRecord | VerificationRecord)
    .sessionId;
}

function formatSessionWarning(warning: { displayPath: string }): string {
  return `Ignoring corrupt session ${warning.displayPath}`;
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function formatVerifyMethodDuration(
  method: VerificationMethodResultRef,
): string {
  return (
    formatRenderLifecycleDuration({
      lifecycle: {
        status: method.status,
        startedAt: method.startedAt,
        completedAt: method.completedAt,
      },
      terminalStatuses: TERMINAL_VERIFICATION_STATUSES,
    }) ?? DASH
  );
}
