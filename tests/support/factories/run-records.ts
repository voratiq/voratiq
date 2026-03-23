import { randomUUID } from "node:crypto";

import {
  buildRunRecordEnhanced,
  type RunRecordEnhanced,
} from "../../../src/domains/runs/model/enhanced.js";
import type {
  AgentArtifactState,
  AgentInvocationRecord,
  RunRecord,
  RunReport,
} from "../../../src/domains/runs/model/types.js";

const DEFAULT_AGENT_ID = "agent-1";
const DEFAULT_MODEL = "model-v1";
const DEFAULT_SPEC_PATH = "specs/sample.md";
const DEFAULT_BASE_REVISION_SHA = "1234567890abcdef1234567890abcdef12345678";

function buildDefaultArtifacts(): AgentArtifactState {
  return {
    diffAttempted: true,
    diffCaptured: true,
    stdoutCaptured: true,
    stderrCaptured: true,
    summaryCaptured: true,
  };
}

export function createAgentInvocationRecord(
  overrides: Partial<AgentInvocationRecord> = {},
): AgentInvocationRecord {
  const now = new Date("2025-10-23T17:00:00.000Z").toISOString();
  const later = new Date("2025-10-23T17:05:00.000Z").toISOString();

  const agent: AgentInvocationRecord = {
    agentId: DEFAULT_AGENT_ID,
    model: DEFAULT_MODEL,
    status: "succeeded",
    error: undefined,
    ...overrides,
  };

  if (agent.status === "queued") {
    delete agent.startedAt;
    delete agent.completedAt;
    delete agent.commitSha;
    delete agent.artifacts;
    return agent;
  }

  if (agent.status === "running") {
    agent.startedAt ??= now;
    delete agent.completedAt;
    delete agent.commitSha;
    delete agent.artifacts;
    return agent;
  }

  agent.startedAt ??= now;
  agent.completedAt ??= later;
  agent.commitSha ??= DEFAULT_BASE_REVISION_SHA;
  agent.artifacts ??= buildDefaultArtifacts();

  return agent;
}

export function createRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  const runId = overrides.runId ?? `run-${randomUUID()}`;
  const createdAt =
    overrides.createdAt ?? new Date("2025-10-23T17:00:00.000Z").toISOString();
  const startedAt = overrides.startedAt ?? createdAt;
  const completedAt =
    overrides.completedAt ??
    new Date(Date.parse(startedAt) + 5 * 60 * 1000).toISOString();

  const record: RunRecord = {
    runId,
    baseRevisionSha: DEFAULT_BASE_REVISION_SHA,
    rootPath: ".",
    spec: { path: DEFAULT_SPEC_PATH },
    status: "succeeded",
    createdAt,
    agents: [createAgentInvocationRecord()],
    applyStatus: undefined,
    deletedAt: null,
    ...overrides,
  };

  if (record.status === "queued") {
    delete record.startedAt;
    delete record.completedAt;
    return record;
  }

  if (record.status === "running") {
    record.startedAt ??= startedAt;
    delete record.completedAt;
    return record;
  }

  if (
    record.status === "succeeded" ||
    record.status === "failed" ||
    record.status === "errored" ||
    record.status === "aborted"
  ) {
    record.startedAt ??= startedAt;
    record.completedAt ??= completedAt;
    return record;
  }

  return record;
}

export function createRunReport(overrides: Partial<RunReport> = {}): RunReport {
  const createdAt =
    overrides.createdAt ?? new Date("2025-10-23T17:00:00.000Z").toISOString();
  const startedAt = overrides.startedAt ?? createdAt;
  const defaultCompletedAt = new Date(
    Date.parse(startedAt) + 5 * 60 * 1000,
  ).toISOString();

  return {
    runId: overrides.runId ?? `run-${randomUUID()}`,
    spec: overrides.spec ?? { path: DEFAULT_SPEC_PATH },
    status: overrides.status ?? "succeeded",
    createdAt,
    startedAt,
    completedAt:
      overrides.status === "running"
        ? undefined
        : (overrides.completedAt ?? defaultCompletedAt),
    baseRevisionSha: overrides.baseRevisionSha ?? DEFAULT_BASE_REVISION_SHA,
    agents: overrides.agents ?? [],
    hadAgentFailure: overrides.hadAgentFailure ?? false,
  };
}

export function createRunRecordEnhanced(
  overrides: Partial<RunRecord> = {},
): RunRecordEnhanced {
  const record = createRunRecord(overrides);
  return buildRunRecordEnhanced(record);
}
