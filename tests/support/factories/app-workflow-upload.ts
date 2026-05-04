import type {
  AppRepositoryConnectionEnsureRequest,
  AppRepositoryConnectionEnsureResponse,
} from "../../../src/app-session/repository-connections.js";
import type { RepositoryLinkStateSnapshot } from "../../../src/app-session/state.js";
import type { AppWorkflowSessionResponse } from "../../../src/app-session/workflow-sessions.js";
import type { AppWorkflowPersistedRecord } from "../../../src/app-session/workflow-upload.js";
import type { MessageRecord } from "../../../src/domain/message/model/types.js";
import type { ReductionRecord } from "../../../src/domain/reduce/model/types.js";
import type { RunRecord } from "../../../src/domain/run/model/types.js";
import type { SpecRecord } from "../../../src/domain/spec/model/types.js";
import type { VerificationRecord } from "../../../src/domain/verify/model/types.js";
import {
  buildRepositoryEnsureRequest,
  buildRepositoryEnsureResponse,
  buildRepositoryLinkStateSnapshot,
} from "./app-session.js";
import { createRunRecord } from "./run-records.js";

type PersistedRecordForOperator<
  Operator extends AppWorkflowPersistedRecord["operator"],
> = Extract<AppWorkflowPersistedRecord, { operator: Operator }>;

export interface WorkflowSessionResponseFixture extends AppWorkflowSessionResponse {
  workflow_id: string;
  workflow_session_id: string;
}

type PersistedRecordOverrides<
  Operator extends AppWorkflowPersistedRecord["operator"],
  Record,
> = Omit<
  Partial<PersistedRecordForOperator<Operator>>,
  "operator" | "record"
> & {
  record?: Partial<Record>;
};

export function buildRunWorkflowPersistedRecord(
  overrides: PersistedRecordOverrides<"run", RunRecord> = {},
): PersistedRecordForOperator<"run"> {
  const { record, ...eventOverrides } = overrides;
  return {
    operator: "run",
    root: "/repo",
    record: createRunRecord({
      runId: "run-123",
      status: "succeeded",
      createdAt: "2026-04-24T12:34:56.000Z",
      startedAt: "2026-04-24T12:35:01.000Z",
      completedAt: "2026-04-24T12:39:00.000Z",
      spec: {
        path: "specs/sample.md",
        target: {
          kind: "spec",
          sessionId: "spec-123",
        },
      },
      agents: [
        {
          agentId: "alpha",
          model: "gpt-5",
          status: "succeeded",
          startedAt: "2026-04-24T12:35:01.000Z",
          completedAt: "2026-04-24T12:39:00.000Z",
          commitSha: "1234567890abcdef1234567890abcdef12345678",
          artifacts: {
            diffAttempted: true,
            diffCaptured: true,
            stdoutCaptured: true,
            stderrCaptured: true,
            summaryCaptured: true,
          },
        },
      ],
      ...record,
    }),
    recordUpdatedAt: "2026-04-24T12:39:01.000Z",
    ...eventOverrides,
  };
}

export function buildSpecWorkflowPersistedRecord(
  overrides: PersistedRecordOverrides<"spec", SpecRecord> = {},
): PersistedRecordForOperator<"spec"> {
  const { record, ...eventOverrides } = overrides;
  return {
    operator: "spec",
    root: "/repo",
    record: buildSpecRecord(record),
    recordUpdatedAt: "2026-04-24T12:39:01.000Z",
    ...eventOverrides,
  };
}

export function buildMessageWorkflowPersistedRecord(
  overrides: PersistedRecordOverrides<"message", MessageRecord> = {},
): PersistedRecordForOperator<"message"> {
  const { record, ...eventOverrides } = overrides;
  return {
    operator: "message",
    root: "/repo",
    record: buildMessageRecord(record),
    recordUpdatedAt: "2026-04-24T12:39:01.000Z",
    ...eventOverrides,
  };
}

export function buildReductionWorkflowPersistedRecord(
  overrides: PersistedRecordOverrides<"reduce", ReductionRecord> = {},
): PersistedRecordForOperator<"reduce"> {
  const { record, ...eventOverrides } = overrides;
  return {
    operator: "reduce",
    root: "/repo",
    record: buildReductionRecord(record),
    recordUpdatedAt: "2026-04-24T12:39:01.000Z",
    ...eventOverrides,
  };
}

export function buildVerificationWorkflowPersistedRecord(
  overrides: PersistedRecordOverrides<"verify", VerificationRecord> = {},
): PersistedRecordForOperator<"verify"> {
  const { record, ...eventOverrides } = overrides;
  return {
    operator: "verify",
    root: "/repo",
    record: buildVerificationRecord(record),
    recordUpdatedAt: "2026-04-24T12:39:01.000Z",
    ...eventOverrides,
  };
}

export function buildAppWorkflowPersistedRecord(
  operator: AppWorkflowPersistedRecord["operator"] = "run",
): AppWorkflowPersistedRecord {
  switch (operator) {
    case "message":
      return buildMessageWorkflowPersistedRecord();
    case "reduce":
      return buildReductionWorkflowPersistedRecord();
    case "run":
      return buildRunWorkflowPersistedRecord();
    case "spec":
      return buildSpecWorkflowPersistedRecord();
    case "verify":
      return buildVerificationWorkflowPersistedRecord();
  }
}

export function buildLinkedRepositoryState(
  linked: boolean | null = true,
  overrides: Partial<RepositoryLinkStateSnapshot> = {},
): RepositoryLinkStateSnapshot {
  return buildRepositoryLinkStateSnapshot(linked, overrides);
}

export function buildRepositoryEnsureRequestForUpload(
  overrides: Partial<AppRepositoryConnectionEnsureRequest> = {},
): AppRepositoryConnectionEnsureRequest {
  return buildRepositoryEnsureRequest({
    local_repo_key: "repo-derived-key",
    slug: "repo",
    ...overrides,
  });
}

export function buildRepositoryEnsureResponseForUpload(
  overrides: Partial<AppRepositoryConnectionEnsureResponse> = {},
): AppRepositoryConnectionEnsureResponse {
  return buildRepositoryEnsureResponse(overrides);
}

export function buildWorkflowSessionResponse(
  overrides: Partial<WorkflowSessionResponseFixture> = {},
): WorkflowSessionResponseFixture {
  return {
    workflow_id: "workflow-123",
    workflow_session_id: "workflow-session-123",
    ...overrides,
  };
}

function buildSpecRecord(overrides: Partial<SpecRecord> = {}): SpecRecord {
  return {
    sessionId: "spec-123",
    createdAt: "2026-04-24T12:34:56.000Z",
    startedAt: "2026-04-24T12:35:01.000Z",
    completedAt: "2026-04-24T12:39:00.000Z",
    status: "succeeded",
    baseRevisionSha: "spec-base-sha",
    description: "Generate spec",
    agents: [
      {
        agentId: "alpha",
        status: "succeeded",
        startedAt: "2026-04-24T12:35:01.000Z",
        completedAt: "2026-04-24T12:39:00.000Z",
        outputPath: ".voratiq/specs/sessions/spec-123/alpha/spec.md",
        dataPath: ".voratiq/specs/sessions/spec-123/alpha/spec.json",
        contentHash: `sha256:${"a".repeat(64)}`,
        error: null,
      },
    ],
    error: null,
    ...overrides,
  };
}

function buildMessageRecord(
  overrides: Partial<MessageRecord> = {},
): MessageRecord {
  return {
    sessionId: "message-123",
    createdAt: "2026-04-24T12:34:56.000Z",
    startedAt: "2026-04-24T12:35:01.000Z",
    completedAt: "2026-04-24T12:39:00.000Z",
    status: "succeeded",
    baseRevisionSha: "message-base-sha",
    prompt: "Review the change.",
    target: {
      kind: "interactive",
      sessionId: "interactive-123",
    },
    recipients: [
      {
        agentId: "alpha",
        status: "succeeded",
        startedAt: "2026-04-24T12:35:01.000Z",
        completedAt: "2026-04-24T12:39:00.000Z",
        outputPath: ".voratiq/message/sessions/message-123/alpha/response.md",
        error: null,
      },
    ],
    error: null,
    ...overrides,
  };
}

function buildReductionRecord(
  overrides: Partial<ReductionRecord> = {},
): ReductionRecord {
  return {
    sessionId: "reduce-123",
    target: {
      type: "message",
      id: "message-123",
    },
    createdAt: "2026-04-24T12:34:56.000Z",
    startedAt: "2026-04-24T12:35:01.000Z",
    completedAt: "2026-04-24T12:39:00.000Z",
    status: "succeeded",
    reducers: [
      {
        agentId: "alpha",
        status: "succeeded",
        outputPath: ".voratiq/reduce/sessions/reduce-123/alpha/output.md",
        startedAt: "2026-04-24T12:35:01.000Z",
        completedAt: "2026-04-24T12:39:00.000Z",
        error: null,
      },
    ],
    error: null,
    ...overrides,
  };
}

function buildVerificationRecord(
  overrides: Partial<VerificationRecord> = {},
): VerificationRecord {
  return {
    sessionId: "verify-123",
    createdAt: "2026-04-24T12:34:56.000Z",
    startedAt: "2026-04-24T12:35:01.000Z",
    completedAt: "2026-04-24T12:39:00.000Z",
    status: "succeeded",
    target: {
      kind: "run",
      sessionId: "run-123",
      candidateIds: ["alpha"],
    },
    methods: [
      {
        method: "programmatic",
        slug: "programmatic",
        scope: { kind: "run" },
        status: "succeeded",
        artifactPath:
          ".voratiq/verify/sessions/verify-123/programmatic.result.json",
        startedAt: "2026-04-24T12:35:01.000Z",
        completedAt: "2026-04-24T12:39:00.000Z",
        error: null,
      },
    ],
    error: null,
    ...overrides,
  };
}
