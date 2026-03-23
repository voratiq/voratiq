import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { teardownSessionAuth } from "../../../src/agents/runtime/registry.js";
import { executeRunCommand } from "../../../src/commands/run/command.js";
import {
  clearActiveRun,
  registerActiveRun,
} from "../../../src/commands/run/lifecycle.js";
import { initializeRunRecord } from "../../../src/commands/run/record-init.js";
import {
  validateAndPrepare,
  type ValidationResult,
} from "../../../src/commands/run/validation.js";
import { resolveStageCompetitors } from "../../../src/commands/shared/resolve-stage-competitors.js";
import type { ResolvedExtraContextFile } from "../../../src/competition/shared/extra-context.js";
import type { AgentDefinition } from "../../../src/configs/agents/types.js";
import { executeAgents } from "../../../src/domains/runs/competition/agent-execution.js";
import type { AgentExecutionPhaseResult } from "../../../src/domains/runs/competition/phases.js";
import { toRunReport } from "../../../src/domains/runs/competition/reports.js";
import { generateRunId } from "../../../src/domains/runs/model/id.js";
import {
  type AgentRecordMutators,
  createAgentRecordMutators,
} from "../../../src/domains/runs/model/mutators.js";
import type {
  AgentInvocationRecord,
  AgentReport,
  RunRecord,
  RunReport,
} from "../../../src/domains/runs/model/types.js";
import { rewriteRunRecord } from "../../../src/domains/runs/persistence/adapter.js";
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

jest.mock("../../../src/domains/runs/model/mutators.js", () => ({
  createAgentRecordMutators: jest.fn(),
}));

jest.mock("../../../src/domains/runs/competition/agent-execution.js", () => ({
  executeAgents: jest.fn(),
}));

jest.mock("../../../src/domains/runs/persistence/adapter.js", () => ({
  rewriteRunRecord: jest.fn(),
  flushRunRecordBuffer: jest.fn(),
}));

jest.mock("../../../src/domains/runs/competition/reports.js", () => ({
  toRunReport: jest.fn(),
}));

jest.mock("../../../src/commands/run/lifecycle.js", () => ({
  registerActiveRun: jest.fn(),
  clearActiveRun: jest.fn(),
}));

jest.mock("../../../src/commands/shared/resolve-stage-competitors.js", () => ({
  resolveStageCompetitors: jest.fn(),
}));

jest.mock("../../../src/domains/runs/model/id.js", () => ({
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

function buildUnavailableTokenUsageResult(modelId = "unknown") {
  return {
    status: "unavailable" as const,
    reason: "chat_not_captured" as const,
    provider: "unknown",
    modelId,
  };
}

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
      startedAt: createdAt,
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
    };

    const agentReport: AgentReport = {
      agentId: "alpha",
      status: "succeeded",
      tokenUsageResult: buildUnavailableTokenUsageResult("claude-3"),
      runtimeManifestPath: "/repo/agent.json",
      baseDirectory: "/repo/agent",
      assets: {
        stdoutPath: "/repo/stdout.log",
        stderrPath: "/repo/stderr.log",
      },
      startedAt: "2025-11-10T00:00:00.000Z",
      completedAt: "2025-11-10T00:10:00.000Z",
      diffAttempted: false,
      diffCaptured: false,
    };

    const executionResult: AgentExecutionPhaseResult = {
      agentRecords: [agentRecord],
      agentReports: [agentReport],
      hadAgentFailure: false,
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

  it("marks the run succeeded when at least one agent succeeds in a mixed outcome", async () => {
    generateRunIdMock.mockReturnValue("run-mixed");
    resolveStageCompetitorsMock.mockReturnValue({
      source: "orchestration",
      agentIds: ["alpha", "beta"],
      competitors: [
        {
          id: "alpha",
          provider: "claude",
          model: "claude-3",
          binary: "node",
          argv: ["index.mjs"],
        },
        {
          id: "beta",
          provider: "claude",
          model: "claude-3",
          binary: "node",
          argv: ["index.mjs"],
        },
      ],
    });

    const createdAt = "2025-11-10T01:00:00.000Z";
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
        {
          id: "beta",
          provider: "claude",
          model: "claude-3",
          binary: "node",
          argv: ["index.mjs"],
        },
      ],
      effectiveMaxParallel: 2,
      environment: {},
    };
    validateAndPrepareMock.mockResolvedValue(validationResult);

    prepareRunWorkspaceMock.mockResolvedValue({
      runWorkspace: {
        absolute: "/tmp/run-workspace",
        relative: ".voratiq/runs/sessions/run-mixed",
      },
    });

    const initialRecord: RunRecord = {
      runId: "run-mixed",
      baseRevisionSha: validationResult.baseRevisionSha,
      rootPath: ".",
      spec: { path: "spec.md" },
      status: "running",
      createdAt,
      startedAt: createdAt,
      agents: [],
      deletedAt: null,
    };
    initializeRunRecordMock.mockResolvedValue({
      initialRecord,
      recordPersisted: true,
    });

    createAgentRecordMutatorsMock.mockReturnValue({
      recordAgentQueued: jest.fn(() => Promise.resolve()),
      recordAgentSnapshot: jest.fn(() => Promise.resolve()),
    });

    const agentRecords: AgentInvocationRecord[] = [
      {
        agentId: "alpha",
        model: "claude-3",
        status: "succeeded",
        startedAt: "2025-11-10T01:00:00.000Z",
        completedAt: "2025-11-10T01:10:00.000Z",
      },
      {
        agentId: "beta",
        model: "claude-3",
        status: "failed",
        startedAt: "2025-11-10T01:00:00.000Z",
        completedAt: "2025-11-10T01:05:00.000Z",
        error: "agent failed",
      },
    ];

    const agentReports: AgentReport[] = [
      {
        agentId: "alpha",
        status: "succeeded",
        tokenUsageResult: buildUnavailableTokenUsageResult("claude-3"),
        runtimeManifestPath: "/repo/alpha.json",
        baseDirectory: "/repo/alpha",
        assets: {},
        startedAt: "2025-11-10T01:00:00.000Z",
        completedAt: "2025-11-10T01:10:00.000Z",
        diffAttempted: false,
        diffCaptured: false,
      },
      {
        agentId: "beta",
        status: "failed",
        tokenUsageResult: buildUnavailableTokenUsageResult("claude-3"),
        runtimeManifestPath: "/repo/beta.json",
        baseDirectory: "/repo/beta",
        assets: {},
        error: "agent failed",
        startedAt: "2025-11-10T01:00:00.000Z",
        completedAt: "2025-11-10T01:05:00.000Z",
        diffAttempted: false,
        diffCaptured: false,
      },
    ];

    const executionResult: AgentExecutionPhaseResult = {
      agentRecords,
      agentReports,
      hadAgentFailure: true,
    };
    executeAgentsMock.mockResolvedValue(executionResult);

    let mutatedRecord: RunRecord | undefined;
    rewriteRunRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(initialRecord);
      return Promise.resolve(mutatedRecord);
    });

    const runReport: RunReport = {
      runId: "run-mixed",
      spec: initialRecord.spec,
      status: "succeeded",
      createdAt,
      baseRevisionSha: initialRecord.baseRevisionSha,
      agents: agentReports,
      hadAgentFailure: true,
    };
    toRunReportMock.mockReturnValue(runReport);

    const report = await executeRunCommand({
      root: "/repo",
      runsFilePath: "/repo/runs.json",
      specAbsolutePath: "/repo/spec.md",
      specDisplayPath: "spec.md",
    });

    expect(mutatedRecord?.status).toBe("succeeded");
    expect(report.status).toBe("succeeded");
    expect(report.hadAgentFailure).toBe(true);
  });

  it("marks the run failed when no agents succeed", async () => {
    generateRunIdMock.mockReturnValue("run-no-success");
    resolveStageCompetitorsMock.mockReturnValue({
      source: "orchestration",
      agentIds: ["alpha", "beta"],
      competitors: [
        {
          id: "alpha",
          provider: "claude",
          model: "claude-3",
          binary: "node",
          argv: ["index.mjs"],
        },
        {
          id: "beta",
          provider: "claude",
          model: "claude-3",
          binary: "node",
          argv: ["index.mjs"],
        },
      ],
    });

    const createdAt = "2025-11-10T02:00:00.000Z";
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
        {
          id: "beta",
          provider: "claude",
          model: "claude-3",
          binary: "node",
          argv: ["index.mjs"],
        },
      ],
      effectiveMaxParallel: 2,
      environment: {},
    };
    validateAndPrepareMock.mockResolvedValue(validationResult);

    prepareRunWorkspaceMock.mockResolvedValue({
      runWorkspace: {
        absolute: "/tmp/run-workspace",
        relative: ".voratiq/runs/sessions/run-no-success",
      },
    });

    const initialRecord: RunRecord = {
      runId: "run-no-success",
      baseRevisionSha: validationResult.baseRevisionSha,
      rootPath: ".",
      spec: { path: "spec.md" },
      status: "running",
      createdAt,
      startedAt: createdAt,
      agents: [],
      deletedAt: null,
    };
    initializeRunRecordMock.mockResolvedValue({
      initialRecord,
      recordPersisted: true,
    });

    createAgentRecordMutatorsMock.mockReturnValue({
      recordAgentQueued: jest.fn(() => Promise.resolve()),
      recordAgentSnapshot: jest.fn(() => Promise.resolve()),
    });

    const agentRecords: AgentInvocationRecord[] = [
      {
        agentId: "alpha",
        model: "claude-3",
        status: "errored",
        startedAt: "2025-11-10T02:00:00.000Z",
        completedAt: "2025-11-10T02:01:00.000Z",
        error: "runtime error",
      },
      {
        agentId: "beta",
        model: "claude-3",
        status: "errored",
        startedAt: "2025-11-10T02:00:00.000Z",
        completedAt: "2025-11-10T02:01:00.000Z",
        error: "runtime error",
      },
    ];

    const agentReports: AgentReport[] = [
      {
        agentId: "alpha",
        status: "errored",
        tokenUsageResult: buildUnavailableTokenUsageResult("claude-3"),
        runtimeManifestPath: "/repo/alpha.json",
        baseDirectory: "/repo/alpha",
        assets: {},
        error: "runtime error",
        startedAt: "2025-11-10T02:00:00.000Z",
        completedAt: "2025-11-10T02:01:00.000Z",
        diffAttempted: false,
        diffCaptured: false,
      },
      {
        agentId: "beta",
        status: "errored",
        tokenUsageResult: buildUnavailableTokenUsageResult("claude-3"),
        runtimeManifestPath: "/repo/beta.json",
        baseDirectory: "/repo/beta",
        assets: {},
        error: "runtime error",
        startedAt: "2025-11-10T02:00:00.000Z",
        completedAt: "2025-11-10T02:01:00.000Z",
        diffAttempted: false,
        diffCaptured: false,
      },
    ];

    const executionResult: AgentExecutionPhaseResult = {
      agentRecords,
      agentReports,
      hadAgentFailure: true,
    };
    executeAgentsMock.mockResolvedValue(executionResult);

    let mutatedRecord: RunRecord | undefined;
    rewriteRunRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(initialRecord);
      return Promise.resolve(mutatedRecord);
    });

    const runReport: RunReport = {
      runId: "run-no-success",
      spec: initialRecord.spec,
      status: "failed",
      createdAt,
      baseRevisionSha: initialRecord.baseRevisionSha,
      agents: agentReports,
      hadAgentFailure: true,
    };
    toRunReportMock.mockReturnValue(runReport);

    const report = await executeRunCommand({
      root: "/repo",
      runsFilePath: "/repo/runs.json",
      specAbsolutePath: "/repo/spec.md",
      specDisplayPath: "spec.md",
    });

    expect(mutatedRecord?.status).toBe("failed");
    expect(report.status).toBe("failed");
    expect(report.hadAgentFailure).toBe(true);
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
      startedAt: createdAt,
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
    };

    const agentReport: AgentReport = {
      agentId: "alpha",
      status: "succeeded",
      tokenUsageResult: buildUnavailableTokenUsageResult("claude-3"),
      runtimeManifestPath: "/repo/agent.json",
      baseDirectory: "/repo/agent",
      assets: {
        stdoutPath: "/repo/stdout.log",
        stderrPath: "/repo/stderr.log",
      },
      startedAt: "2025-11-10T00:00:00.000Z",
      completedAt: "2025-11-10T00:10:00.000Z",
      diffAttempted: false,
      diffCaptured: false,
    };

    const executionResult: AgentExecutionPhaseResult = {
      agentRecords: [agentRecord],
      agentReports: [agentReport],
      hadAgentFailure: false,
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
    );
    expect(report).toEqual(runReport);
  });

  it("persists an errored run status when orchestration fails", async () => {
    generateRunIdMock.mockReturnValue("run-orchestration-error");
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
      effectiveMaxParallel: 1,
      environment: {},
    });
    prepareRunWorkspaceMock.mockResolvedValue({
      runWorkspace: {
        absolute: "/tmp/run-workspace",
        relative: ".voratiq/runs/sessions/run-orchestration-error",
      },
    });
    const initialRecord: RunRecord = {
      runId: "run-orchestration-error",
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "spec.md" },
      status: "running",
      createdAt: "2025-11-10T00:00:00.000Z",
      startedAt: "2025-11-10T00:00:00.000Z",
      agents: [],
      deletedAt: null,
    };
    initializeRunRecordMock.mockResolvedValue({
      initialRecord,
      recordPersisted: true,
    });
    createAgentRecordMutatorsMock.mockReturnValue({
      recordAgentQueued: jest.fn(() => Promise.resolve()),
      recordAgentSnapshot: jest.fn(() => Promise.resolve()),
    });
    executeAgentsMock.mockRejectedValue(new Error("orchestration exploded"));

    let mutatedRecord: RunRecord | undefined;
    rewriteRunRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(initialRecord);
      return Promise.resolve(mutatedRecord);
    });

    await expect(
      executeRunCommand({
        root: "/repo",
        runsFilePath: "/repo/runs.json",
        specAbsolutePath: "/repo/spec.md",
        specDisplayPath: "spec.md",
      }),
    ).rejects.toThrow("orchestration exploded");

    expect(mutatedRecord?.status).toBe("errored");
    expect(toRunReportMock).not.toHaveBeenCalled();
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
        startedAt: "2025-11-10T00:00:00.000Z",
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

  it("passes staged extra-context references through to agent execution", async () => {
    generateRunIdMock.mockReturnValue("run-xyz");
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
      effectiveMaxParallel: 1,
      environment: {},
    });

    prepareRunWorkspaceMock.mockResolvedValue({
      runWorkspace: {
        absolute: "/tmp/run-workspace",
        relative: ".voratiq/runs/sessions/run-xyz",
      },
    });

    initializeRunRecordMock.mockResolvedValue({
      initialRecord: {
        runId: "run-xyz",
        baseRevisionSha: "abc123",
        rootPath: ".",
        spec: { path: "spec.md" },
        status: "running",
        createdAt: "2025-11-10T00:00:00.000Z",
        startedAt: "2025-11-10T00:00:00.000Z",
        agents: [],
        deletedAt: null,
      },
      recordPersisted: true,
    });
    createAgentRecordMutatorsMock.mockReturnValue({
      recordAgentQueued: jest.fn(() => Promise.resolve()),
      recordAgentSnapshot: jest.fn(() => Promise.resolve()),
    });
    executeAgentsMock.mockResolvedValue({
      agentRecords: [],
      agentReports: [],
      hadAgentFailure: false,
    } satisfies AgentExecutionPhaseResult);
    rewriteRunRecordMock.mockResolvedValue({
      runId: "run-xyz",
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "spec.md" },
      status: "succeeded",
      createdAt: "2025-11-10T00:00:00.000Z",
      agents: [],
    });
    toRunReportMock.mockReturnValue({
      runId: "run-xyz",
      spec: { path: "spec.md" },
      status: "succeeded",
      createdAt: "2025-11-10T00:00:00.000Z",
      baseRevisionSha: "abc123",
      agents: [],
      hadAgentFailure: false,
    });

    const extraContextFiles: ResolvedExtraContextFile[] = [
      {
        absolutePath: "/repo/notes/a.md",
        displayPath: "notes/a.md",
        stagedRelativePath: "../context/a.md",
      },
    ];

    await executeRunCommand({
      root: "/repo",
      runsFilePath: "/repo/runs.json",
      specAbsolutePath: "/repo/spec.md",
      specDisplayPath: "spec.md",
      extraContextFiles,
    });

    expect(executeAgentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        extraContextFiles,
      }),
    );
    expect(initializeRunRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        extraContext: ["../context/a.md"],
        extraContextMetadata: [
          {
            stagedPath: "../context/a.md",
            sourcePath: "notes/a.md",
          },
        ],
      }),
    );
  });
});
