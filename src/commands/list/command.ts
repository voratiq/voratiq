import type {
  ListJsonDetailOutput,
  ListJsonOutput,
  ListJsonTableRecord,
  ListMode,
  ListOperator,
  MessageListJsonArtifact,
  MessageListJsonRow,
  ReduceListJsonRow,
  ReductionListJsonArtifact,
  RunListJsonRow,
  SpecListJsonArtifact,
  SpecListJsonRow,
  VerificationListJsonArtifact,
  VerifyListJsonRow,
} from "../../contracts/list.js";
import type { MessageRecord } from "../../domain/message/model/types.js";
import {
  type MessageRecordWarning,
  readMessageRecords,
} from "../../domain/message/persistence/adapter.js";
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
  renderMessageList,
  renderReduceList,
  renderRunList,
  renderSpecList,
  renderVerifyList,
} from "../../render/transcripts/list.js";
import {
  formatMessageElapsed,
  formatMessageRecipientDuration,
  renderMessageTranscript,
} from "../../render/transcripts/message.js";
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
  getMessageSessionDirectoryPath,
  getReductionSessionDirectoryPath,
  getRunDirectoryPath,
  getSpecSessionDirectoryPath,
  getVerificationSessionDirectoryPath,
} from "../../workspace/structure.js";

const DEFAULT_LIMIT = 10;
const DASH = "—";

export interface ListCommandInput {
  root: string;
  specsFilePath: string;
  runsFilePath: string;
  reductionsFilePath: string;
  messagesFilePath: string;
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
        : operator === "message"
          ? renderMessageList(records as readonly MessageRecord[])
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

  if (operator === "message") {
    const messageRecord = record as MessageRecord;
    return renderMessageTranscript({
      messageId: messageRecord.sessionId,
      createdAt: messageRecord.createdAt,
      elapsed:
        formatMessageElapsed({
          status: messageRecord.status,
          startedAt: messageRecord.startedAt,
          completedAt: messageRecord.completedAt,
        }) ?? DASH,
      workspacePath: getMessageSessionDirectoryPath(messageRecord.sessionId),
      status: messageRecord.status,
      recipients: messageRecord.recipients.map((recipient) => ({
        agentId: recipient.agentId,
        status: recipient.status,
        duration:
          formatMessageRecipientDuration({
            status: recipient.status,
            startedAt: recipient.startedAt,
            completedAt: recipient.completedAt,
          }) ?? DASH,
        outputPath: recipient.outputPath,
        errorLine: recipient.error ?? undefined,
      })),
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
    target: verificationRecord.target,
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

  if (operator === "message") {
    const messageRecord = record as MessageRecord;
    return {
      id: messageRecord.sessionId,
      status: messageRecord.status,
      createdAt: messageRecord.createdAt,
      promptPreview: normalizePreviewText(messageRecord.prompt),
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
      target: {
        kind: reductionRecord.target.type,
        id: reductionRecord.target.id,
      },
      rows: reductionRecord.reducers.map(toReductionJsonRow),
      artifacts: reductionRecord.reducers.map(toReductionArtifact),
    };
  }

  if (operator === "message") {
    const messageRecord = record as MessageRecord;
    return {
      id: messageRecord.sessionId,
      status: messageRecord.status,
      createdAt: messageRecord.createdAt,
      elapsed: formatMessageRecordElapsed(messageRecord),
      workspacePath: getMessageSessionDirectoryPath(messageRecord.sessionId),
      rows: messageRecord.recipients.map(toMessageJsonRow),
      artifacts: messageRecord.recipients.flatMap(toMessageArtifacts),
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
    target: {
      kind: verificationRecord.target.kind,
      id: verificationRecord.target.sessionId,
    },
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

function formatMessageRecordElapsed(record: MessageRecord): string | undefined {
  return formatMessageElapsed({
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  });
}

function normalizePreviewText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 ? normalized : null;
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

function toMessageJsonRow(
  recipient: MessageRecord["recipients"][number],
): MessageListJsonRow {
  return {
    agentId: recipient.agentId,
    status: recipient.status,
    duration:
      formatMessageRecipientDuration({
        status: recipient.status,
        startedAt: recipient.startedAt,
        completedAt: recipient.completedAt,
      }) ?? DASH,
  };
}

function toMessageArtifacts(
  recipient: MessageRecord["recipients"][number],
): MessageListJsonArtifact[] {
  return [
    {
      kind: "output",
      agentId: recipient.agentId,
      path: recipient.outputPath ?? null,
    },
  ];
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
  | MessageRecord
  | ReductionRecord
  | VerificationRecord;

interface ReadOperatorRecordsInput {
  root: string;
  specsFilePath: string;
  runsFilePath: string;
  reductionsFilePath: string;
  messagesFilePath: string;
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

  if (operator === "message") {
    if (!(await pathExists(input.messagesFilePath))) {
      return { records: [], warnings: [] };
    }

    const warnings: MessageRecordWarning[] = [];
    const records = await readMessageRecords({
      root,
      messagesFilePath: input.messagesFilePath,
      limit: input.limit,
      predicate: input.predicate as
        | ((record: MessageRecord) => boolean)
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
  return (
    record as SpecRecord | MessageRecord | ReductionRecord | VerificationRecord
  ).sessionId;
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
