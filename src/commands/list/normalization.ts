import type {
  ListJsonArtifact,
  ListJsonChanges,
  ListJsonTargetRef,
  ListOperator,
} from "../../contracts/list.js";
import type { InteractiveSessionRecord } from "../../domain/interactive/model/types.js";
import type { MessageRecord } from "../../domain/message/model/types.js";
import type { ReductionRecord } from "../../domain/reduce/model/types.js";
import { buildRunRecordEnhanced } from "../../domain/run/model/enhanced.js";
import type { RunRecord } from "../../domain/run/model/types.js";
import type { SpecRecord } from "../../domain/spec/model/types.js";
import type { VerificationMethodResultRef } from "../../domain/verify/model/types.js";
import type { VerificationRecord } from "../../domain/verify/model/types.js";
import {
  getInteractiveSessionDirectoryPath,
  getMessageSessionDirectoryPath,
  getReductionSessionDirectoryPath,
  getRunDirectoryPath,
  getSpecSessionDirectoryPath,
  getVerificationSessionDirectoryPath,
} from "../../workspace/session-paths.js";
export {
  formatTargetDisplay,
  formatTargetTablePreview,
  TARGET_TABLE_PREVIEW_LENGTH,
} from "../../utils/list-target.js";
const FILES_CHANGED_PATTERN = /(\d+)\s+file/u;
const INSERTIONS_PATTERN = /(\d+)\s+insertion/u;
const DELETIONS_PATTERN = /(\d+)\s+deletion/u;

export type ListTargetOperator = ListOperator;

export type ListSessionTarget = {
  kind: ListTargetOperator;
  sessionId: string;
};

export type ListLaneTarget = {
  kind: Exclude<ListTargetOperator, "interactive">;
  sessionId: string;
  agentId: string;
};

export type ListFileTarget = {
  kind: "file";
  path: string;
};

export type ListTarget = ListSessionTarget | ListLaneTarget | ListFileTarget;

export type ListOperatorRecord =
  | InteractiveSessionRecord
  | RunRecord
  | SpecRecord
  | MessageRecord
  | ReductionRecord
  | VerificationRecord;

export interface NormalizedListSession {
  operator: ListOperator;
  sessionId: string;
  status: string;
  createdAt: string;
  target?: ListTarget;
  description?: string | null;
}

export interface NormalizedListAgent {
  agentId: string | null;
  status: string;
  startedAt?: string;
  completedAt?: string;
  verifier?: string;
  diffStatistics?: string;
  changes?: ListJsonChanges;
  outputPath?: string;
  dataPath?: string;
  errorLine?: string;
  artifacts: ListJsonArtifact[];
}

export interface NormalizedListDetailSession extends NormalizedListSession {
  startedAt?: string;
  completedAt?: string;
  workspacePath: string;
  agents: NormalizedListAgent[];
}

export function normalizeListSession(
  operator: ListOperator,
  record: ListOperatorRecord,
): NormalizedListSession {
  return {
    operator,
    sessionId: getRecordId(operator, record),
    status: getRecordStatus(record),
    createdAt: getRecordCreatedAt(record),
    target: normalizeListTarget(operator, record),
    ...(operator === "spec"
      ? {
          description: normalizeDescription((record as SpecRecord).description),
        }
      : {}),
  };
}

export function normalizeListDetailSession(
  operator: ListOperator,
  record: ListOperatorRecord,
): NormalizedListDetailSession {
  const session = normalizeListSession(operator, record);

  if (operator === "run") {
    const runRecord = record as RunRecord;
    const enhancedRunRecord = buildRunRecordEnhanced(runRecord);
    return {
      ...session,
      startedAt: runRecord.startedAt,
      completedAt: runRecord.completedAt,
      workspacePath: getRunDirectoryPath(runRecord.runId),
      agents: enhancedRunRecord.agents.map((agent) => ({
        agentId: agent.agentId,
        status: agent.status,
        startedAt: agent.startedAt,
        completedAt: agent.completedAt,
        diffStatistics: agent.diffStatistics,
        changes: parseDiffStatistics(agent.diffStatistics),
        outputPath: agent.assets.diffPath,
        errorLine: agent.error ?? undefined,
        artifacts: agent.assets.diffPath
          ? [
              {
                kind: "diff",
                role: "output",
                path: agent.assets.diffPath,
              },
            ]
          : [],
      })),
    };
  }

  if (operator === "spec") {
    const specRecord = record as SpecRecord;
    return {
      ...session,
      startedAt: specRecord.startedAt,
      completedAt: specRecord.completedAt,
      workspacePath: getSpecSessionDirectoryPath(specRecord.sessionId),
      agents: specRecord.agents.map((agent) => ({
        agentId: agent.agentId,
        status: agent.status,
        startedAt: agent.startedAt,
        completedAt: agent.completedAt,
        outputPath: agent.outputPath,
        dataPath: agent.dataPath,
        errorLine: agent.error ?? undefined,
        artifacts: [
          ...(agent.outputPath
            ? [
                {
                  kind: "spec",
                  role: "output" as const,
                  path: agent.outputPath,
                },
              ]
            : []),
          ...(agent.dataPath
            ? [
                {
                  kind: "spec",
                  role: "data" as const,
                  path: agent.dataPath,
                },
              ]
            : []),
        ],
      })),
    };
  }

  if (operator === "reduce") {
    const reductionRecord = record as ReductionRecord;
    return {
      ...session,
      startedAt: reductionRecord.startedAt,
      completedAt: reductionRecord.completedAt,
      workspacePath: getReductionSessionDirectoryPath(
        reductionRecord.sessionId,
      ),
      agents: reductionRecord.reducers.map((reducer) => ({
        agentId: reducer.agentId,
        status: reducer.status,
        startedAt: reducer.startedAt,
        completedAt: reducer.completedAt,
        outputPath: reducer.outputPath,
        dataPath: reducer.dataPath,
        errorLine: reducer.error ?? undefined,
        artifacts: [
          ...(reducer.outputPath
            ? [
                {
                  kind: "reduction",
                  role: "output" as const,
                  path: reducer.outputPath,
                },
              ]
            : []),
          ...(reducer.dataPath
            ? [
                {
                  kind: "reduction",
                  role: "data" as const,
                  path: reducer.dataPath,
                },
              ]
            : []),
        ],
      })),
    };
  }

  if (operator === "message") {
    const messageRecord = record as MessageRecord;
    return {
      ...session,
      startedAt: messageRecord.startedAt,
      completedAt: messageRecord.completedAt,
      workspacePath: getMessageSessionDirectoryPath(messageRecord.sessionId),
      agents: messageRecord.recipients.map((recipient) => ({
        agentId: recipient.agentId,
        status: recipient.status,
        startedAt: recipient.startedAt,
        completedAt: recipient.completedAt,
        outputPath: recipient.outputPath,
        errorLine: recipient.error ?? undefined,
        artifacts: recipient.outputPath
          ? [
              {
                kind: "response",
                role: "output",
                path: recipient.outputPath,
              },
            ]
          : [],
      })),
    };
  }

  if (operator === "interactive") {
    const interactiveRecord = record as InteractiveSessionRecord;
    return {
      ...session,
      workspacePath: getInteractiveSessionDirectoryPath(
        interactiveRecord.sessionId,
      ),
      agents: [
        {
          agentId: interactiveRecord.agentId,
          status: interactiveRecord.status,
          outputPath: interactiveRecord.chat?.captured
            ? interactiveRecord.chat.artifactPath
            : undefined,
          artifacts:
            interactiveRecord.chat?.captured &&
            interactiveRecord.chat.artifactPath
              ? [
                  {
                    kind: "chat",
                    role: "output",
                    path: interactiveRecord.chat.artifactPath,
                  },
                ]
              : [],
        },
      ],
    };
  }

  const verificationRecord = record as VerificationRecord;
  return {
    ...session,
    startedAt: verificationRecord.startedAt,
    completedAt: verificationRecord.completedAt,
    workspacePath: getVerificationSessionDirectoryPath(
      verificationRecord.sessionId,
    ),
    agents: verificationRecord.methods.map(normalizeVerificationMethod),
  };
}

export function normalizeListTarget(
  operator: ListOperator,
  record: ListOperatorRecord,
): ListTarget | undefined {
  if (operator === "spec" || operator === "interactive") {
    return undefined;
  }

  if (operator === "message") {
    return normalizeMessageTarget(record as MessageRecord);
  }

  if (operator === "run") {
    return normalizeRunTarget(record as RunRecord);
  }

  if (operator === "reduce") {
    const reductionRecord = record as ReductionRecord;
    return {
      kind: reductionRecord.target.type,
      sessionId: reductionRecord.target.id,
    };
  }

  const verificationRecord = record as VerificationRecord;
  return {
    kind: verificationRecord.target.kind,
    sessionId: verificationRecord.target.sessionId,
  };
}

export function toListJsonTargetRef(target: ListTarget): ListJsonTargetRef {
  return target.kind === "file"
    ? target
    : {
        kind: target.kind,
        sessionId: target.sessionId,
        ...("agentId" in target && target.agentId
          ? { agentId: target.agentId }
          : {}),
      };
}

export function normalizeDescription(
  description: string | null | undefined,
): string | null {
  if (typeof description !== "string") {
    return null;
  }

  const normalized = description.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRunTarget(record: RunRecord): ListTarget {
  if (record.spec.target?.kind === "spec") {
    return {
      kind: "spec",
      sessionId: record.spec.target.sessionId,
    };
  }

  return {
    kind: "file",
    path: record.spec.path,
  };
}

function normalizeMessageTarget(record: MessageRecord): ListTarget | undefined {
  if (!record.target) {
    return undefined;
  }

  if (record.target.agentId) {
    return {
      kind: record.target.kind as Exclude<ListTargetOperator, "interactive">,
      sessionId: record.target.sessionId,
      agentId: record.target.agentId,
    };
  }

  return {
    kind: record.target.kind,
    sessionId: record.target.sessionId,
  };
}

function normalizeVerificationMethod(
  method: VerificationMethodResultRef,
): NormalizedListAgent {
  return {
    agentId: method.verifierId ?? null,
    verifier:
      method.method === "programmatic"
        ? "programmatic"
        : (method.template ?? "rubric"),
    status: method.status,
    startedAt: method.startedAt,
    completedAt: method.completedAt,
    outputPath: method.artifactPath,
    errorLine: method.error ?? undefined,
    artifacts: method.artifactPath
      ? [
          {
            kind: "verification-result",
            role: "output",
            path: method.artifactPath,
          },
        ]
      : [],
  };
}

function parseDiffStatistics(value?: string): ListJsonChanges | undefined {
  if (!value) {
    return undefined;
  }

  const filesChanged = extractStat(FILES_CHANGED_PATTERN, value);
  const insertions = extractStat(INSERTIONS_PATTERN, value);
  const deletions = extractStat(DELETIONS_PATTERN, value);

  if (
    filesChanged === undefined &&
    insertions === undefined &&
    deletions === undefined
  ) {
    return undefined;
  }

  return {
    ...(filesChanged !== undefined ? { filesChanged } : {}),
    ...(insertions !== undefined ? { insertions } : {}),
    ...(deletions !== undefined ? { deletions } : {}),
  };
}

function extractStat(pattern: RegExp, input: string): number | undefined {
  const match = input.match(pattern);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function getRecordId(
  operator: ListOperator,
  record: ListOperatorRecord,
): string {
  if (operator === "run") {
    return (record as RunRecord).runId;
  }

  return (
    record as
      | InteractiveSessionRecord
      | SpecRecord
      | MessageRecord
      | ReductionRecord
      | VerificationRecord
  ).sessionId;
}

function getRecordStatus(record: ListOperatorRecord): string {
  return record.status;
}

function getRecordCreatedAt(record: ListOperatorRecord): string {
  return record.createdAt;
}
