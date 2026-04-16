import type {
  ListJsonOutput,
  ListMode,
  ListOperator,
} from "../../contracts/list.js";
import type { InteractiveSessionRecord } from "../../domain/interactive/model/types.js";
import {
  type InteractiveRecordWarning,
  readInteractiveRecords,
} from "../../domain/interactive/persistence/adapter.js";
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
import type { VerificationRecord } from "../../domain/verify/model/types.js";
import { TERMINAL_VERIFICATION_STATUSES } from "../../domain/verify/model/types.js";
import {
  readVerificationRecords,
  type VerificationRecordWarning,
} from "../../domain/verify/persistence/adapter.js";
import { renderInteractiveTranscript } from "../../render/transcripts/interactive.js";
import {
  renderInteractiveListTable,
  renderListTableTranscript,
  renderMessageListTable,
  renderReduceListTable,
  renderRunListTable,
  renderSpecListTable,
  renderVerifyListTable,
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
import { renderRunTranscript } from "../../render/transcripts/run.js";
import {
  formatSpecAgentDuration,
  formatSpecElapsed,
  renderSpecTranscript,
} from "../../render/transcripts/spec.js";
import {
  formatVerifyElapsed,
  renderVerifyTranscript,
} from "../../render/transcripts/verify.js";
import {
  formatRenderLifecycleDuration,
  formatRenderLifecycleRowDuration,
} from "../../render/utils/duration.js";
import { pathExists } from "../../utils/fs.js";
import {
  formatTargetDisplay,
  formatTargetTablePreview,
  type ListOperatorRecord,
  type NormalizedListAgent,
  type NormalizedListDetailSession,
  type NormalizedListSession,
  normalizeListDetailSession,
  normalizeListSession,
  toListJsonTargetRef,
} from "./normalization.js";
import { getListRecordId } from "./records.js";

const DEFAULT_LIMIT = 10;
const DASH = "—";

export interface ListCommandInput {
  root: string;
  specsFilePath: string;
  runsFilePath: string;
  reductionsFilePath: string;
  messagesFilePath: string;
  verificationsFilePath: string;
  interactiveFilePath: string;
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
  const predicate = verbose
    ? undefined
    : (record: OperatorRecord) =>
        shouldIncludeInDefaultTable(operator, getRecordStatus(record));
  const query = await readOperatorRecords({ ...input, limit, predicate });
  const records = query.records;
  const sessions = records.map((record) =>
    normalizeListSession(operator, record),
  );
  const warnings = query.warnings;
  const output = renderTableOutput(operator, records, sessions);

  return {
    warnings,
    output,
    mode: "table",
    json: {
      operator,
      mode: "list",
      sessions: sessions.map(toJsonSummarySession),
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
        session: null,
        warnings,
      },
    };
  }

  const detailSession = normalizeListDetailSession(operator, record);

  return {
    warnings,
    output: renderDetailOutput(operator, detailSession),
    mode: "detail",
    json: {
      operator,
      mode: "detail",
      session: toJsonDetailSession(detailSession),
      warnings,
    },
  };
}

function renderTableOutput(
  operator: ListOperator,
  records: readonly OperatorRecord[],
  sessions: readonly NormalizedListSession[],
): string | undefined {
  if (records.length === 0) {
    return undefined;
  }

  const table =
    operator === "run"
      ? renderRunListTable(
          sessions.map((session) => ({
            id: session.sessionId,
            target: session.target
              ? formatTargetTablePreview(session.target)
              : DASH,
            status: session.status,
            createdAt: session.createdAt,
          })),
        )
      : operator === "spec"
        ? renderSpecListTable(
            sessions.map((session) => {
              return {
                id: session.sessionId,
                description: session.description ?? null,
                status: session.status,
                createdAt: session.createdAt,
              };
            }),
          )
        : operator === "message"
          ? renderMessageListTable(
              sessions.map((session) => ({
                id: session.sessionId,
                target: session.target
                  ? formatTargetTablePreview(session.target)
                  : DASH,
                status: session.status,
                createdAt: session.createdAt,
              })),
            )
          : operator === "interactive"
            ? renderInteractiveListTable(
                sessions.map((session) => ({
                  id: session.sessionId,
                  status: session.status,
                  createdAt: session.createdAt,
                })),
              )
            : operator === "reduce"
              ? renderReduceListTable(
                  sessions.map((session) => ({
                    id: session.sessionId,
                    target: session.target
                      ? formatTargetTablePreview(session.target)
                      : DASH,
                    status: session.status,
                    createdAt: session.createdAt,
                  })),
                )
              : renderVerifyListTable(
                  sessions.map((session) => ({
                    id: session.sessionId,
                    target: session.target
                      ? formatTargetTablePreview(session.target)
                      : DASH,
                    status: session.status,
                    createdAt: session.createdAt,
                  })),
                );

  return renderListTableTranscript(table);
}

function renderDetailOutput(
  operator: ListOperator,
  session: NormalizedListDetailSession,
) {
  if (operator === "run") {
    return renderRunTranscript({
      runId: session.sessionId,
      status: session.status as RunRecord["status"],
      workspacePath: session.workspacePath,
      createdAt: session.createdAt,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      targetDisplay: session.target
        ? formatTargetDisplay(session.target)
        : undefined,
      agents: session.agents.map((agent) => ({
        agentId: agent.agentId ?? DASH,
        status: agent.status as RunRecord["agents"][number]["status"],
        startedAt: agent.startedAt,
        completedAt: agent.completedAt,
        diffStatistics: agent.diffStatistics,
        outputPath: agent.outputPath,
        errorLine: agent.errorLine,
      })),
      isTty: process.stdout.isTTY,
    });
  }

  if (operator === "spec") {
    return renderSpecTranscript(
      {
        sessionId: session.sessionId,
        createdAt: session.createdAt,
        elapsed:
          formatSpecElapsed({
            status: session.status as SpecRecord["status"],
            startedAt: session.startedAt,
            completedAt: session.completedAt,
          }) ?? DASH,
        workspacePath: session.workspacePath,
        status: session.status as SpecRecord["status"],
        agents: session.agents.map((agent) => ({
          agentId: agent.agentId ?? DASH,
          status: agent.status as SpecRecord["agents"][number]["status"],
          duration: formatSpecAgentDuration({
            status: agent.status as SpecRecord["agents"][number]["status"],
            startedAt: agent.startedAt,
            completedAt: agent.completedAt,
          }),
          outputPath: agent.outputPath,
          dataPath: agent.dataPath,
          errorLine: agent.errorLine,
        })),
        isTty: process.stdout.isTTY,
      },
      { suppressHint: true },
    );
  }

  if (operator === "reduce") {
    return renderReduceTranscript({
      reductionId: session.sessionId,
      createdAt: session.createdAt,
      elapsed:
        formatReduceElapsed({
          status: session.status as ReductionRecord["status"],
          startedAt: session.startedAt,
          completedAt: session.completedAt,
        }) ?? DASH,
      workspacePath: session.workspacePath,
      status: session.status as ReductionRecord["status"],
      targetDisplay: session.target
        ? formatTargetDisplay(session.target)
        : undefined,
      reducers: session.agents.map((agent) => ({
        reducerAgentId: agent.agentId ?? DASH,
        status: agent.status as ReductionRecord["reducers"][number]["status"],
        duration: formatReducerDuration({
          status: agent.status as ReductionRecord["reducers"][number]["status"],
          startedAt: agent.startedAt,
          completedAt: agent.completedAt,
        }),
        outputPath: agent.outputPath,
        dataPath: agent.dataPath,
        errorLine: agent.errorLine,
      })),
      suppressHint: true,
      isTty: process.stdout.isTTY,
    });
  }

  if (operator === "message") {
    return renderMessageTranscript({
      messageId: session.sessionId,
      createdAt: session.createdAt,
      elapsed:
        formatMessageElapsed({
          status: session.status as MessageRecord["status"],
          startedAt: session.startedAt,
          completedAt: session.completedAt,
        }) ?? DASH,
      workspacePath: session.workspacePath,
      status: session.status as MessageRecord["status"],
      targetDisplay: session.target
        ? formatTargetDisplay(session.target)
        : undefined,
      recipients: session.agents.map((agent) => ({
        agentId: agent.agentId ?? DASH,
        status: agent.status as MessageRecord["recipients"][number]["status"],
        duration: formatMessageRecipientDuration({
          status: agent.status as MessageRecord["recipients"][number]["status"],
          startedAt: agent.startedAt,
          completedAt: agent.completedAt,
        }),
        outputPath: agent.outputPath,
        errorLine: agent.errorLine,
      })),
      isTty: process.stdout.isTTY,
    });
  }

  if (operator === "interactive") {
    const interactiveAgent = session.agents[0];
    return renderInteractiveTranscript({
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      elapsed:
        formatInteractiveElapsed({
          status: session.status as InteractiveSessionRecord["status"],
          startedAt: session.startedAt,
          completedAt: session.completedAt,
        }) ?? DASH,
      workspacePath: session.workspacePath,
      status: session.status as InteractiveSessionRecord["status"],
      agents: [
        {
          agentId: interactiveAgent?.agentId ?? DASH,
          status:
            (interactiveAgent?.status as InteractiveSessionRecord["status"]) ??
            "failed",
          duration: formatInteractiveAgentDuration(interactiveAgent),
          outputPath: interactiveAgent?.outputPath,
        },
      ],
      isTty: process.stdout.isTTY,
    });
  }

  return renderVerifyTranscript({
    verificationId: session.sessionId,
    createdAt: session.createdAt,
    elapsed:
      formatVerifyElapsed({
        status: session.status as VerificationRecord["status"],
        startedAt: session.startedAt,
        completedAt: session.completedAt,
      }) ?? DASH,
    workspacePath: session.workspacePath,
    targetDisplay: session.target
      ? formatTargetDisplay(session.target)
      : undefined,
    status: session.status as VerificationRecord["status"],
    methods: session.agents.map((agent) => ({
      verifierLabel: agent.verifier ?? "rubric",
      agentLabel: agent.agentId ?? undefined,
      status: agent.status as VerificationRecord["methods"][number]["status"],
      duration: formatVerifyAgentDuration(agent),
      artifactPath: agent.outputPath,
      errorLine: agent.errorLine,
    })),
    suppressHint: true,
    isTty: process.stdout.isTTY,
  });
}

function toJsonSummarySession(session: NormalizedListSession) {
  return {
    operator: session.operator,
    sessionId: session.sessionId,
    status: session.status,
    createdAt: session.createdAt,
    ...(session.target ? { target: toListJsonTargetRef(session.target) } : {}),
    ...(session.description !== undefined
      ? { description: session.description }
      : {}),
  };
}

function toJsonDetailSession(
  session: NormalizedListDetailSession,
): Extract<ListJsonOutput, { mode: "detail" }>["session"] {
  return {
    operator: session.operator,
    sessionId: session.sessionId,
    status: session.status,
    createdAt: session.createdAt,
    ...(session.startedAt ? { startedAt: session.startedAt } : {}),
    ...(session.completedAt ? { completedAt: session.completedAt } : {}),
    workspacePath: session.workspacePath,
    ...(session.target ? { target: toListJsonTargetRef(session.target) } : {}),
    ...(session.description !== undefined
      ? { description: session.description }
      : {}),
    agents: session.agents.map(toJsonAgent),
  };
}

function toJsonAgent(agent: NormalizedListAgent) {
  return {
    agentId: agent.agentId,
    status: agent.status,
    ...(agent.startedAt ? { startedAt: agent.startedAt } : {}),
    ...(agent.completedAt ? { completedAt: agent.completedAt } : {}),
    ...(agent.verifier ? { verifier: agent.verifier } : {}),
    ...(agent.changes ? { changes: agent.changes } : {}),
    artifacts: agent.artifacts,
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

type OperatorRecord = ListOperatorRecord;

interface ReadOperatorRecordsInput {
  root: string;
  specsFilePath: string;
  runsFilePath: string;
  reductionsFilePath: string;
  messagesFilePath: string;
  verificationsFilePath: string;
  interactiveFilePath: string;
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

  if (operator === "interactive") {
    if (!(await pathExists(input.interactiveFilePath))) {
      return { records: [], warnings: [] };
    }

    const warnings: InteractiveRecordWarning[] = [];
    const records = await readInteractiveRecords({
      root,
      interactiveFilePath: input.interactiveFilePath,
      limit: input.limit,
      predicate: input.predicate as
        | ((record: InteractiveSessionRecord) => boolean)
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
  return getListRecordId(operator, record);
}

function formatSessionWarning(warning: { displayPath: string }): string {
  return `Ignoring corrupt session ${warning.displayPath}`;
}

function formatVerifyAgentDuration(agent: NormalizedListAgent): string {
  return formatRenderLifecycleRowDuration({
    lifecycle: {
      status: agent.status,
      startedAt: agent.startedAt,
      completedAt: agent.completedAt,
    },
    terminalStatuses: TERMINAL_VERIFICATION_STATUSES,
  });
}

function formatInteractiveElapsed(input: {
  status: InteractiveSessionRecord["status"];
  startedAt?: string;
  completedAt?: string;
}): string | undefined {
  return formatRenderLifecycleDuration({
    lifecycle: input,
    terminalStatuses: ["succeeded", "failed"],
  });
}

function formatInteractiveAgentDuration(
  agent: NormalizedListAgent | undefined,
): string {
  if (!agent) {
    return DASH;
  }

  return formatRenderLifecycleRowDuration({
    lifecycle: {
      status: agent.status as InteractiveSessionRecord["status"],
      startedAt: agent.startedAt,
      completedAt: agent.completedAt,
    },
    terminalStatuses: ["succeeded", "failed"],
  });
}
