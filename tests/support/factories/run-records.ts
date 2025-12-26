import { randomUUID } from "node:crypto";

import {
  buildRunRecordEnhanced,
  type RunRecordEnhanced,
} from "../../../src/runs/records/enhanced.js";
import type {
  AgentArtifactState,
  AgentEvalSnapshot,
  AgentInvocationRecord,
  RunRecord,
  RunReport,
} from "../../../src/runs/records/types.js";

const DEFAULT_AGENT_ID = "agent-1";
const DEFAULT_MODEL = "model-v1";
const DEFAULT_SPEC_PATH = "specs/sample.md";
const DEFAULT_BASE_REVISION_SHA = "1234567890abcdef1234567890abcdef12345678";

const EVAL_SLUGS: AgentEvalSnapshot["slug"][] = [
  "format",
  "lint",
  "typecheck",
  "tests",
];

function buildDefaultEvalSnapshots(): AgentEvalSnapshot[] {
  return EVAL_SLUGS.map((slug) => ({
    slug,
    status: "succeeded",
    exitCode: 0,
    command: `npm run ${slug}`,
    hasLog: true,
  }));
}

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

  const agent: AgentInvocationRecord = {
    agentId: DEFAULT_AGENT_ID,
    model: DEFAULT_MODEL,
    status: "succeeded",
    startedAt: now,
    completedAt: new Date("2025-10-23T17:05:00.000Z").toISOString(),
    commitSha: DEFAULT_BASE_REVISION_SHA,
    artifacts: buildDefaultArtifacts(),
    evals: buildDefaultEvalSnapshots(),
    error: undefined,
    ...overrides,
  };

  return agent;
}

export function createRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  const runId = overrides.runId ?? `run-${randomUUID()}`;

  const record: RunRecord = {
    runId,
    baseRevisionSha: DEFAULT_BASE_REVISION_SHA,
    rootPath: ".",
    spec: { path: DEFAULT_SPEC_PATH },
    status: "succeeded",
    createdAt: new Date("2025-10-23T17:00:00.000Z").toISOString(),
    agents: [createAgentInvocationRecord()],
    applyStatus: undefined,
    deletedAt: null,
    ...overrides,
  };

  return record;
}

export function createRunReport(overrides: Partial<RunReport> = {}): RunReport {
  return {
    runId: overrides.runId ?? `run-${randomUUID()}`,
    spec: overrides.spec ?? { path: DEFAULT_SPEC_PATH },
    status: overrides.status ?? "succeeded",
    createdAt:
      overrides.createdAt ?? new Date("2025-10-23T17:00:00.000Z").toISOString(),
    baseRevisionSha: overrides.baseRevisionSha ?? DEFAULT_BASE_REVISION_SHA,
    agents: overrides.agents ?? [],
    hadAgentFailure: overrides.hadAgentFailure ?? false,
    hadEvalFailure: overrides.hadEvalFailure ?? false,
  };
}

export function createRunRecordEnhanced(
  overrides: Partial<RunRecord> = {},
): RunRecordEnhanced {
  const record = createRunRecord(overrides);
  return buildRunRecordEnhanced(record);
}
