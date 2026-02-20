import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { teardownSessionAuth } from "../../../src/agents/runtime/registry.js";
import { executeAgents } from "../../../src/commands/run/agent-execution.js";
import { executeRunCommand } from "../../../src/commands/run/command.js";
import { generateRunId } from "../../../src/commands/run/id.js";
import {
  clearActiveRun,
  registerActiveRun,
} from "../../../src/commands/run/lifecycle.js";
import type { AgentExecutionPhaseResult } from "../../../src/commands/run/phases.js";
import { initializeRunRecord } from "../../../src/commands/run/record-init.js";
import { toRunReport } from "../../../src/commands/run/reports.js";
import {
  validateAndPrepare,
  type ValidationResult,
} from "../../../src/commands/run/validation.js";
import { resolveStageCompetitors } from "../../../src/commands/shared/resolve-stage-competitors.js";
import type { AgentDefinition } from "../../../src/configs/agents/types.js";
import {
  type AgentRecordMutators,
  createAgentRecordMutators,
} from "../../../src/runs/records/mutators.js";
import { rewriteRunRecord } from "../../../src/runs/records/persistence.js";
import type {
  AgentInvocationRecord,
  AgentReport,
  RunRecord,
  RunReport,
} from "../../../src/runs/records/types.js";
import { prepareRunWorkspace } from "../../../src/workspace/run.js";

jest.mock("../../../src/commands/run/validation.js", () => ({
  validateAndPrepare: jest.fn(),
}));

jest.mock("../../../src/workspace/run.js", () => ({
  prepareRunWorkspace: jest.fn(),
}));

jest.mock("../../../src/commands/run/record-init.js", () => ({
  initializeRunRecord: jest.fn(),
}));

jest.mock("../../../src/runs/records/mutators.js", () => ({
  createAgentRecordMutators: jest.fn(),
}));

jest.mock("../../../src/commands/run/agent-execution.js", () => ({
  executeAgents: jest.fn(),
}));

jest.mock("../../../src/runs/records/persistence.js", () => ({
  rewriteRunRecord: jest.fn(),
  flushRunRecordBuffer: jest.fn(),
}));

jest.mock("../../../src/commands/run/reports.js", () => ({
  toRunReport: jest.fn(),
}));

jest.mock("../../../src/commands/run/lifecycle.js", () => ({
  registerActiveRun: jest.fn(),
  clearActiveRun: jest.fn(),
}));

jest.mock("../../../src/commands/shared/resolve-stage-competitors.js", () => ({
  resolveStageCompetitors: jest.fn(),
}));

jest.mock("../../../src/commands/run/id.js", () => ({
  generateRunId: jest.fn(),
}));

jest.mock("../../../src/agents/runtime/registry.js", () => ({
  teardownSessionAuth: jest.fn(),
}));

const validateAndPrepareMock = jest.mocked(validateAndPrepare);
const prepareRunWorkspaceMock = jest.mocked(prepareRunWorkspace);
const initializeRunRecordMock = jest.mocked(initializeRunRecord);
const createAgentRecordMutatorsMock = jest.mocked(createAgentRecordMutators);
const executeAgentsMock = jest.mocked(executeAgents);
const rewriteRunRecordMock = jest.mocked(rewriteRunRecord);
const toRunReportMock = jest.mocked(toRunReport);
const registerActiveRunMock = jest.mocked(registerActiveRun);
const clearActiveRunMock = jest.mocked(clearActiveRun);
const resolveStageCompetitorsMock = jest.mocked(resolveStageCompetitors);
const generateRunIdMock = jest.mocked(generateRunId);
const teardownSessionAuthMock = jest.mocked(teardownSessionAuth);

describe("executeRunCommand integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    teardownSessionAuthMock.mockResolvedValue(undefined);
    resolveStageCompetitorsMock.mockReturnValue({
      source: "orchestration",
      agentIds: ["alpha"],
      competitors: [
        {
          id: "alpha",
          provider: "claude",
          model: "claude-3",
          binary: "node",
          argv: ["index.mjs"],
        },
      ],
    });
  });

  it("wires together validation, agent execution, and run persistence", async () => {
    generateRunIdMock.mockReturnValue("run-xyz");
    const createdAt = "2025-11-10T00:00:00.000Z";
    const validationResult: ValidationResult = {
      specContent: "Implement feature",
      baseRevisionSha: "abc123",
      agents: [
        {
          id: "alpha",
          provider: "claude",
          model: "claude-3",
          binary: "node",
          argv: ["index.mjs"],
        },
      ],
      evalPlan: [],
      effectiveMaxParallel: 1,
      environment: {},
    };
    validateAndPrepareMock.mockResolvedValue(validationResult);

    const runWorkspace = {
      absolute: "/tmp/run-workspace",
      relative: ".voratiq/runs/sessions/run-xyz",
    };
    prepareRunWorkspaceMock.mockResolvedValue({
      runWorkspace,
    });

    const initialRecord: RunRecord = {
      runId: "run-xyz",
      baseRevisionSha: validationResult.baseRevisionSha,
      rootPath: ".",
      spec: { path: "spec.md" },
      status: "running",
      createdAt,
      agents: [],
      deletedAt: null,
    };
    initializeRunRecordMock.mockResolvedValue({
      initialRecord,
      recordPersisted: true,
    });

    const recordAgentQueued = jest.fn((agent: AgentDefinition) => {
      void agent;
      return Promise.resolve();
    });
    const recordAgentSnapshot = jest.fn((record: AgentInvocationRecord) => {
      void record;
      return Promise.resolve();
    });
    const mutators: AgentRecordMutators = {
      recordAgentQueued,
      recordAgentSnapshot,
    };
    createAgentRecordMutatorsMock.mockReturnValue(mutators);

    const agentRecord: AgentInvocationRecord = {
      agentId: "alpha",
      model: "claude-3",
      status: "succeeded",
      startedAt: "2025-11-10T00:00:00.000Z",
      completedAt: "2025-11-10T00:10:00.000Z",
      evals: [
        {
          slug: "quality",
          status: "succeeded",
          command: "npm test",
          exitCode: 0,
          hasLog: false,
        },
      ],
    };

    const agentReport: AgentReport = {
      agentId: "alpha",
      status: "succeeded",
      runtimeManifestPath: "/repo/agent.json",
      baseDirectory: "/repo/agent",
      assets: {
        stdoutPath: "/repo/stdout.log",
        stderrPath: "/repo/stderr.log",
      },
      evals: [],
      startedAt: "2025-11-10T00:00:00.000Z",
      completedAt: "2025-11-10T00:10:00.000Z",
      diffAttempted: false,
      diffCaptured: false,
    };

    const executionResult: AgentExecutionPhaseResult = {
      agentRecords: [agentRecord],
      agentReports: [agentReport],
      hadAgentFailure: false,
      hadEvalFailure: false,
    };
    executeAgentsMock.mockResolvedValue(executionResult);

    const runRecord: RunRecord = {
      runId: "run-xyz",
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "spec.md" },
      status: "succeeded",
      createdAt,
      agents: [agentRecord],
    };
    rewriteRunRecordMock.mockResolvedValue(runRecord);

    const runReport: RunReport = {
      runId: "run-xyz",
      spec: runRecord.spec,
      status: "succeeded",
      createdAt,
      baseRevisionSha: runRecord.baseRevisionSha,
      agents: [],
      hadAgentFailure: false,
      hadEvalFailure: false,
    };
    toRunReportMock.mockReturnValue(runReport);

    const report = await executeRunCommand({
      root: "/repo",
      runsFilePath: "/repo/runs.json",
      specAbsolutePath: "/repo/spec.md",
      specDisplayPath: "spec.md",
    });

    expect(validateAndPrepareMock).toHaveBeenCalledWith({
      root: "/repo",
      specAbsolutePath: "/repo/spec.md",
      resolvedAgentIds: ["alpha"],
      maxParallel: undefined,
    });
    expect(registerActiveRunMock).toHaveBeenCalledWith({
      root: "/repo",
      runsFilePath: "/repo/runs.json",
      runId: "run-xyz",
      agents: [
        {
          agentId: "alpha",
          providerId: "claude",
          agentRoot: "/repo/.voratiq/runs/sessions/run-xyz/alpha",
        },
      ],
    });
    expect(executeAgentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-xyz",
        agents: expect.any(Array),
        mutators,
      }),
    );
    expect(rewriteRunRecordMock).toHaveBeenCalled();
    expect(clearActiveRunMock).toHaveBeenCalledWith("run-xyz");
    expect(report).toEqual(runReport);
  });

  it("preserves aborted run status if finalization races with an abort", async () => {
    generateRunIdMock.mockReturnValue("run-aborted");
    const createdAt = "2025-11-10T00:00:00.000Z";
    const validationResult: ValidationResult = {
      specContent: "Implement feature",
      baseRevisionSha: "abc123",
      agents: [
        {
          id: "alpha",
          provider: "claude",
          model: "claude-3",
          binary: "node",
          argv: ["index.mjs"],
        },
      ],
      evalPlan: [],
      effectiveMaxParallel: 1,
      environment: {},
    };
    validateAndPrepareMock.mockResolvedValue(validationResult);

    const runWorkspace = {
      absolute: "/tmp/run-workspace",
      relative: ".voratiq/runs/sessions/run-aborted",
    };
    prepareRunWorkspaceMock.mockResolvedValue({
      runWorkspace,
    });

    const initialRecord: RunRecord = {
      runId: "run-aborted",
      baseRevisionSha: validationResult.baseRevisionSha,
      rootPath: ".",
      spec: { path: "spec.md" },
      status: "running",
      createdAt,
      agents: [],
      deletedAt: null,
    };
    initializeRunRecordMock.mockResolvedValue({
      initialRecord,
      recordPersisted: true,
    });

    const recordAgentQueued = jest.fn((agent: AgentDefinition) => {
      void agent;
      return Promise.resolve();
    });
    const recordAgentSnapshot = jest.fn((record: AgentInvocationRecord) => {
      void record;
      return Promise.resolve();
    });
    const mutators: AgentRecordMutators = {
      recordAgentQueued,
      recordAgentSnapshot,
    };
    createAgentRecordMutatorsMock.mockReturnValue(mutators);

    const agentRecord: AgentInvocationRecord = {
      agentId: "alpha",
      model: "claude-3",
      status: "succeeded",
      startedAt: "2025-11-10T00:00:00.000Z",
      completedAt: "2025-11-10T00:10:00.000Z",
      evals: [
        {
          slug: "quality",
          status: "succeeded",
          command: "npm test",
          exitCode: 0,
          hasLog: false,
        },
      ],
    };

    const agentReport: AgentReport = {
      agentId: "alpha",
      status: "succeeded",
      runtimeManifestPath: "/repo/agent.json",
      baseDirectory: "/repo/agent",
      assets: {
        stdoutPath: "/repo/stdout.log",
        stderrPath: "/repo/stderr.log",
      },
      evals: [],
      startedAt: "2025-11-10T00:00:00.000Z",
      completedAt: "2025-11-10T00:10:00.000Z",
      diffAttempted: false,
      diffCaptured: false,
    };

    const executionResult: AgentExecutionPhaseResult = {
      agentRecords: [agentRecord],
      agentReports: [agentReport],
      hadAgentFailure: false,
      hadEvalFailure: false,
    };
    executeAgentsMock.mockResolvedValue(executionResult);

    const abortedSnapshot: RunRecord = {
      runId: "run-aborted",
      baseRevisionSha: validationResult.baseRevisionSha,
      rootPath: ".",
      spec: { path: "spec.md" },
      status: "aborted",
      createdAt,
      agents: [
        {
          agentId: "alpha",
          model: "claude-3",
          status: "aborted",
          startedAt: "2025-11-10T00:00:00.000Z",
          completedAt: "2025-11-10T00:05:00.000Z",
          warnings: ["Run aborted before agent completed."],
        },
      ],
      deletedAt: null,
    };

    let mutatedRecord: RunRecord | undefined;
    rewriteRunRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(abortedSnapshot);
      return Promise.resolve(mutatedRecord);
    });

    const runReport: RunReport = {
      runId: "run-aborted",
      spec: abortedSnapshot.spec,
      status: "aborted",
      createdAt,
      baseRevisionSha: abortedSnapshot.baseRevisionSha,
      agents: [],
      hadAgentFailure: false,
      hadEvalFailure: false,
    };
    toRunReportMock.mockReturnValue(runReport);

    const report = await executeRunCommand({
      root: "/repo",
      runsFilePath: "/repo/runs.json",
      specAbsolutePath: "/repo/spec.md",
      specDisplayPath: "spec.md",
    });

    expect(rewriteRunRecordMock).toHaveBeenCalledTimes(1);
    expect(mutatedRecord).toBe(abortedSnapshot);
    expect(toRunReportMock).toHaveBeenCalledWith(
      abortedSnapshot,
      executionResult.agentReports,
      executionResult.hadAgentFailure,
      executionResult.hadEvalFailure,
    );
    expect(report).toEqual(runReport);
  });

  it("tears down run auth exactly once when execution throws", async () => {
    generateRunIdMock.mockReturnValue("run-fail");
    validateAndPrepareMock.mockResolvedValue({
      specContent: "Implement feature",
      baseRevisionSha: "abc123",
      agents: [
        {
          id: "alpha",
          provider: "claude",
          model: "claude-3",
          binary: "node",
          argv: ["index.mjs"],
        },
      ],
      evalPlan: [],
      effectiveMaxParallel: 1,
      environment: {},
    });
    prepareRunWorkspaceMock.mockResolvedValue({
      runWorkspace: {
        absolute: "/tmp/run-workspace",
        relative: ".voratiq/runs/sessions/run-fail",
      },
    });
    initializeRunRecordMock.mockResolvedValue({
      initialRecord: {
        runId: "run-fail",
        baseRevisionSha: "abc123",
        rootPath: ".",
        spec: { path: "spec.md" },
        status: "running",
        createdAt: "2025-11-10T00:00:00.000Z",
        agents: [],
      },
      recordPersisted: false,
    });
    createAgentRecordMutatorsMock.mockReturnValue({
      recordAgentQueued: jest.fn(() => Promise.resolve()),
      recordAgentSnapshot: jest.fn(() => Promise.resolve()),
    });
    executeAgentsMock.mockRejectedValue(new Error("post-processing failed"));

    await expect(
      executeRunCommand({
        root: "/repo",
        runsFilePath: "/repo/runs.json",
        specAbsolutePath: "/repo/spec.md",
        specDisplayPath: "spec.md",
      }),
    ).rejects.toThrow("post-processing failed");

    expect(teardownSessionAuthMock).toHaveBeenCalledTimes(1);
    expect(teardownSessionAuthMock).toHaveBeenCalledWith("run-fail");
  });
});
