import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { executeRunCommand } from "../../../src/commands/run/command.js";
import {
  clearActiveRun,
  finalizeActiveRun,
  markActiveRunRecordPersisted,
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
import { executeAgents } from "../../../src/domain/run/competition/agent-execution.js";
import type { AgentExecutionPhaseResult } from "../../../src/domain/run/competition/phases.js";
import {
  toAgentReport,
  toRunReport,
} from "../../../src/domain/run/competition/reports.js";
import { generateRunId } from "../../../src/domain/run/model/id.js";
import {
  type AgentRecordMutators,
  createAgentRecordMutators,
  mergeAgentRecords,
} from "../../../src/domain/run/model/mutators.js";
import type {
  AgentInvocationRecord,
  AgentReport,
  RunRecord,
  RunReport,
} from "../../../src/domain/run/model/types.js";
import {
  flushRunRecordBuffer,
  rewriteRunRecord,
} from "../../../src/domain/run/persistence/adapter.js";
import {
  prepareRunWorkspace,
  stageExternalSpecCopy,
} from "../../../src/workspace/run.js";

jest.mock("../../../src/commands/run/validation.js", () => ({
  validateAndPrepare: jest.fn(),
}));

jest.mock("../../../src/workspace/run.js", () => ({
  prepareRunWorkspace: jest.fn(),
  stageExternalSpecCopy: jest.fn(),
}));

jest.mock("../../../src/commands/run/record-init.js", () => ({
  initializeRunRecord: jest.fn(),
}));

jest.mock("../../../src/domain/run/model/mutators.js", () => ({
  createAgentRecordMutators: jest.fn(),
  mergeAgentRecords: jest.fn(
    (
      existing: AgentInvocationRecord | undefined,
      incoming: AgentInvocationRecord,
    ) => ({
      ...(existing ?? {}),
      ...incoming,
      artifacts: incoming.artifacts ?? existing?.artifacts,
    }),
  ),
}));

jest.mock("../../../src/domain/run/competition/agent-execution.js", () => ({
  executeAgents: jest.fn(),
}));

jest.mock("../../../src/domain/run/persistence/adapter.js", () => ({
  rewriteRunRecord: jest.fn(),
  flushRunRecordBuffer: jest.fn(),
}));

jest.mock("../../../src/domain/run/competition/reports.js", () => ({
  toAgentReport: jest.fn(),
  toRunReport: jest.fn(),
}));

jest.mock("../../../src/commands/run/lifecycle.js", () => ({
  clearActiveRun: jest.fn(),
  registerActiveRun: jest.fn(),
  markActiveRunRecordPersisted: jest.fn(),
  finalizeActiveRun: jest.fn(),
}));

jest.mock("../../../src/commands/shared/resolve-stage-competitors.js", () => ({
  resolveStageCompetitors: jest.fn(),
}));

jest.mock("../../../src/domain/run/model/id.js", () => ({
  generateRunId: jest.fn(),
}));

const validateAndPrepareMock = jest.mocked(validateAndPrepare);
const prepareRunWorkspaceMock = jest.mocked(prepareRunWorkspace);
const stageExternalSpecCopyMock = jest.mocked(stageExternalSpecCopy);
const initializeRunRecordMock = jest.mocked(initializeRunRecord);
const createAgentRecordMutatorsMock = jest.mocked(createAgentRecordMutators);
const mergeAgentRecordsMock = jest.mocked(mergeAgentRecords);
const executeAgentsMock = jest.mocked(executeAgents);
const flushRunRecordBufferMock = jest.mocked(flushRunRecordBuffer);
const rewriteRunRecordMock = jest.mocked(rewriteRunRecord);
const toAgentReportMock = jest.mocked(toAgentReport);
const toRunReportMock = jest.mocked(toRunReport);
const clearActiveRunMock = jest.mocked(clearActiveRun);
const registerActiveRunMock = jest.mocked(registerActiveRun);
const markActiveRunRecordPersistedMock = jest.mocked(
  markActiveRunRecordPersisted,
);
const finalizeActiveRunMock = jest.mocked(finalizeActiveRun);
const resolveStageCompetitorsMock = jest.mocked(resolveStageCompetitors);
const generateRunIdMock = jest.mocked(generateRunId);

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
    markActiveRunRecordPersistedMock.mockReset();
    finalizeActiveRunMock.mockResolvedValue(undefined);
    flushRunRecordBufferMock.mockResolvedValue(undefined);
    toAgentReportMock.mockImplementation((_runId, record, derivations) => ({
      agentId: record.agentId,
      status: record.status,
      tokenUsage: record.tokenUsage ?? derivations.tokenUsage,
      tokenUsageResult: derivations.tokenUsageResult,
      runtimeManifestPath: `/repo/${record.agentId}.manifest.json`,
      baseDirectory: `/repo/${record.agentId}`,
      assets: {},
      startedAt: record.startedAt ?? "2025-11-10T00:00:00.000Z",
      completedAt:
        record.completedAt ?? record.startedAt ?? "2025-11-10T00:00:00.000Z",
      diffStatistics: derivations.diffStatistics,
      error: record.error,
      warnings: record.warnings,
      diffAttempted: derivations.diffAttempted,
      diffCaptured: derivations.diffCaptured,
    }));
    mergeAgentRecordsMock.mockImplementation(
      (
        existing: AgentInvocationRecord | undefined,
        incoming: AgentInvocationRecord,
      ) => ({
        ...(existing ?? {}),
        ...incoming,
        artifacts: incoming.artifacts ?? existing?.artifacts,
      }),
    );
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
      specTarget: { kind: "file" },
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
      relative: ".voratiq/run/sessions/run-xyz",
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
      specDisplayPath: "spec.md",
      specsFilePath: undefined,
      resolvedAgentIds: ["alpha"],
      maxParallel: undefined,
    });
    expect(registerActiveRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        root: "/repo",
        runsFilePath: "/repo/runs.json",
        runId: "run-xyz",
        agents: [
          {
            agentId: "alpha",
            providerId: "claude",
            agentRoot: "/repo/.voratiq/run/sessions/run-xyz/alpha",
          },
        ],
      }),
    );
    const registerOrder =
      registerActiveRunMock.mock.invocationCallOrder[0] ??
      Number.POSITIVE_INFINITY;
    const initializeOrder =
      initializeRunRecordMock.mock.invocationCallOrder[0] ??
      Number.NEGATIVE_INFINITY;
    expect(registerOrder).toBeLessThan(initializeOrder);
    const registeredContext = registerActiveRunMock.mock.calls[0]?.[0];
    expect(registeredContext?.teardown?.listResources()).toEqual([
      {
        kind: "action",
        key: "run-auth:run-xyz",
        label: "session auth",
        cleanup: expect.any(Function),
      },
      {
        kind: "worktree",
        root: "/repo",
        worktreePath: "/repo/.voratiq/run/sessions/run-xyz/alpha/workspace",
        label: "alpha workspace",
      },
      {
        kind: "path",
        path: "/repo/.voratiq/run/sessions/run-xyz/alpha/context",
        label: "alpha context",
      },
      {
        kind: "path",
        path: "/repo/.voratiq/run/sessions/run-xyz/alpha/runtime",
        label: "alpha runtime",
      },
      {
        kind: "path",
        path: "/repo/.voratiq/run/sessions/run-xyz/alpha/sandbox",
        label: "alpha sandbox",
      },
      {
        kind: "branch",
        root: "/repo",
        branch: "voratiq/run/run-xyz/alpha",
        worktreePath: "/repo/.voratiq/run/sessions/run-xyz/alpha/workspace",
        label: "alpha branch",
      },
    ]);
    expect(executeAgentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-xyz",
        agents: expect.any(Array),
        mutators,
      }),
    );
    expect(rewriteRunRecordMock).toHaveBeenCalled();
    expect(flushRunRecordBufferMock).toHaveBeenCalledWith({
      runsFilePath: "/repo/runs.json",
      runId: "run-xyz",
    });
    expect(finalizeActiveRunMock).toHaveBeenCalledWith("run-xyz");
    const flushOrder =
      flushRunRecordBufferMock.mock.invocationCallOrder[0] ??
      Number.POSITIVE_INFINITY;
    const finalizeOrder =
      finalizeActiveRunMock.mock.invocationCallOrder[0] ??
      Number.NEGATIVE_INFINITY;
    expect(flushOrder).toBeLessThan(finalizeOrder);
    expect(report).toEqual(runReport);
  });

  it("normalizes external specs into the retained spec directory", async () => {
    generateRunIdMock.mockReturnValue("run-external");
    stageExternalSpecCopyMock.mockResolvedValue({
      absolutePath: "/repo/.voratiq/spec/external-spec.md",
      relativePath: ".voratiq/spec/external-spec.md",
    });
    validateAndPrepareMock.mockResolvedValue({
      specContent: "Implement feature",
      specTarget: { kind: "file" },
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
        relative: ".voratiq/run/sessions/run-external",
      },
    });
    initializeRunRecordMock.mockResolvedValue({
      initialRecord: {
        runId: "run-external",
        baseRevisionSha: "abc123",
        rootPath: ".",
        spec: { path: ".voratiq/spec/external-spec.md" },
        status: "running",
        createdAt: "2025-11-10T00:00:00.000Z",
        startedAt: "2025-11-10T00:00:00.000Z",
        agents: [],
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
    });
    rewriteRunRecordMock.mockResolvedValue({
      runId: "run-external",
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: ".voratiq/spec/external-spec.md" },
      status: "succeeded",
      createdAt: "2025-11-10T00:00:00.000Z",
      agents: [],
    });
    toRunReportMock.mockReturnValue({
      runId: "run-external",
      spec: { path: ".voratiq/spec/external-spec.md" },
      status: "succeeded",
      createdAt: "2025-11-10T00:00:00.000Z",
      baseRevisionSha: "abc123",
      agents: [],
      hadAgentFailure: false,
    });

    const report = await executeRunCommand({
      root: "/repo",
      runsFilePath: "/repo/runs.json",
      specAbsolutePath: "/tmp/external-spec.md",
      specDisplayPath: "../../tmp/external-spec.md",
    });

    expect(stageExternalSpecCopyMock).toHaveBeenCalledWith({
      root: "/repo",
      sourceAbsolutePath: "/tmp/external-spec.md",
    });
    expect(validateAndPrepareMock).toHaveBeenCalledWith(
      expect.objectContaining({
        specAbsolutePath: "/repo/.voratiq/spec/external-spec.md",
        specDisplayPath: ".voratiq/spec/external-spec.md",
      }),
    );
    expect(initializeRunRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        specDisplayPath: ".voratiq/spec/external-spec.md",
      }),
    );
    expect(report.spec.path).toBe(".voratiq/spec/external-spec.md");
  });

  it("still finalizes teardown when flushing the run record buffer fails", async () => {
    generateRunIdMock.mockReturnValue("run-flush-fail");
    validateAndPrepareMock.mockResolvedValue({
      specContent: "Implement feature",
      specTarget: { kind: "file" },
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
        relative: ".voratiq/run/sessions/run-flush-fail",
      },
    });
    initializeRunRecordMock.mockResolvedValue({
      initialRecord: {
        runId: "run-flush-fail",
        baseRevisionSha: "abc123",
        rootPath: ".",
        spec: { path: "spec.md" },
        status: "running",
        createdAt: "2025-11-10T00:00:00.000Z",
        startedAt: "2025-11-10T00:00:00.000Z",
        agents: [],
      },
      recordPersisted: true,
    });
    createAgentRecordMutatorsMock.mockReturnValue({
      recordAgentQueued: jest.fn(() => Promise.resolve()),
      recordAgentSnapshot: jest.fn(() => Promise.resolve()),
    });
    executeAgentsMock.mockResolvedValue({
      agentRecords: [
        {
          agentId: "alpha",
          model: "claude-3",
          status: "succeeded",
        },
      ],
      agentReports: [
        {
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
        },
      ],
      hadAgentFailure: false,
    });
    rewriteRunRecordMock.mockResolvedValue({
      runId: "run-flush-fail",
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "spec.md" },
      status: "succeeded",
      createdAt: "2025-11-10T00:00:00.000Z",
      agents: [],
    });
    toRunReportMock.mockReturnValue({
      runId: "run-flush-fail",
      spec: { path: "spec.md" },
      status: "succeeded",
      createdAt: "2025-11-10T00:00:00.000Z",
      baseRevisionSha: "abc123",
      agents: [],
      hadAgentFailure: false,
    });
    flushRunRecordBufferMock.mockRejectedValue(new Error("flush failed"));

    await expect(
      executeRunCommand({
        root: "/repo",
        runsFilePath: "/repo/runs.json",
        specAbsolutePath: "/repo/spec.md",
        specDisplayPath: "spec.md",
      }),
    ).rejects.toThrow("flush failed");

    expect(finalizeActiveRunMock).toHaveBeenCalledWith("run-flush-fail");
  });

  it("clears the active run when initial record persistence fails", async () => {
    generateRunIdMock.mockReturnValue("run-init-fail");
    validateAndPrepareMock.mockResolvedValue({
      specContent: "Implement feature",
      specTarget: { kind: "file" },
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
        relative: ".voratiq/run/sessions/run-init-fail",
      },
    });
    initializeRunRecordMock.mockRejectedValue(new Error("init failed"));

    await expect(
      executeRunCommand({
        root: "/repo",
        runsFilePath: "/repo/runs.json",
        specAbsolutePath: "/repo/spec.md",
        specDisplayPath: "spec.md",
      }),
    ).rejects.toThrow("init failed");

    expect(registerActiveRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-init-fail" }),
    );
    expect(clearActiveRunMock).toHaveBeenCalledWith("run-init-fail");
    expect(finalizeActiveRunMock).not.toHaveBeenCalled();
  });

  it("returns the run report when post-run cleanup fails after success", async () => {
    generateRunIdMock.mockReturnValue("run-cleanup-warn");
    const validationResult: ValidationResult = {
      specContent: "Implement feature",
      specTarget: { kind: "file" },
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
    prepareRunWorkspaceMock.mockResolvedValue({
      runWorkspace: {
        absolute: "/tmp/run-workspace",
        relative: ".voratiq/run/sessions/run-cleanup-warn",
      },
    });
    initializeRunRecordMock.mockResolvedValue({
      initialRecord: {
        runId: "run-cleanup-warn",
        baseRevisionSha: "abc123",
        rootPath: ".",
        spec: { path: "spec.md" },
        status: "running",
        createdAt: "2025-11-10T00:00:00.000Z",
        startedAt: "2025-11-10T00:00:00.000Z",
        agents: [],
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
    });
    rewriteRunRecordMock.mockResolvedValue({
      runId: "run-cleanup-warn",
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "spec.md" },
      status: "succeeded",
      createdAt: "2025-11-10T00:00:00.000Z",
      agents: [],
    });
    const report: RunReport = {
      runId: "run-cleanup-warn",
      spec: { path: "spec.md" },
      status: "succeeded",
      createdAt: "2025-11-10T00:00:00.000Z",
      baseRevisionSha: "abc123",
      agents: [],
      hadAgentFailure: false,
    };
    toRunReportMock.mockReturnValue(report);
    finalizeActiveRunMock.mockRejectedValue(new Error("cleanup failed"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      executeRunCommand({
        root: "/repo",
        runsFilePath: "/repo/runs.json",
        specAbsolutePath: "/repo/spec.md",
        specDisplayPath: "spec.md",
      }),
    ).resolves.toEqual(report);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("post-run cleanup failed: cleanup failed"),
    );

    warnSpy.mockRestore();
  });

  it("preserves richer persisted agent artifacts when finalizing the run record", async () => {
    generateRunIdMock.mockReturnValue("run-xyz");
    const createdAt = "2025-11-10T00:00:00.000Z";
    const validationResult: ValidationResult = {
      specContent: "Implement feature",
      specTarget: { kind: "file" },
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

    prepareRunWorkspaceMock.mockResolvedValue({
      runWorkspace: {
        absolute: "/tmp/run-workspace",
        relative: ".voratiq/run/sessions/run-xyz",
      },
    });

    initializeRunRecordMock.mockResolvedValue({
      initialRecord: {
        runId: "run-xyz",
        baseRevisionSha: validationResult.baseRevisionSha,
        rootPath: ".",
        spec: { path: "spec.md" },
        status: "running",
        createdAt,
        startedAt: createdAt,
        agents: [],
      },
      recordPersisted: true,
    });

    createAgentRecordMutatorsMock.mockReturnValue({
      recordAgentQueued: jest.fn(() => Promise.resolve()),
      recordAgentSnapshot: jest.fn(() => Promise.resolve()),
    });

    const agentRecord: AgentInvocationRecord = {
      agentId: "alpha",
      model: "claude-3",
      status: "succeeded",
      startedAt: "2025-11-10T00:00:00.000Z",
      completedAt: "2025-11-10T00:10:00.000Z",
    };

    executeAgentsMock.mockResolvedValue({
      agentRecords: [agentRecord],
      agentReports: [
        {
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
        },
      ],
      hadAgentFailure: false,
    });

    let currentRecord: RunRecord = {
      runId: "run-xyz",
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "spec.md" },
      status: "running",
      createdAt,
      startedAt: createdAt,
      agents: [
        {
          agentId: "alpha",
          model: "claude-3",
          status: "succeeded",
          startedAt: "2025-11-10T00:00:00.000Z",
          completedAt: "2025-11-10T00:10:00.000Z",
          artifacts: {
            stdoutCaptured: true,
            summaryCaptured: true,
          },
        },
      ],
    };
    rewriteRunRecordMock.mockImplementation(({ mutate }) => {
      currentRecord = mutate(currentRecord);
      return Promise.resolve(currentRecord);
    });

    toRunReportMock.mockReturnValue({
      runId: "run-xyz",
      spec: { path: "spec.md" },
      status: "succeeded",
      createdAt,
      baseRevisionSha: "abc123",
      agents: [],
      hadAgentFailure: false,
    });

    await executeRunCommand({
      root: "/repo",
      runsFilePath: "/repo/runs.json",
      specAbsolutePath: "/repo/spec.md",
      specDisplayPath: "spec.md",
    });

    expect(currentRecord.agents[0]?.artifacts?.summaryCaptured).toBe(true);
    expect(mergeAgentRecordsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "alpha",
        artifacts: expect.objectContaining({
          summaryCaptured: true,
        }),
      }),
      agentRecord,
    );
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
      specTarget: { kind: "file" },
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
        relative: ".voratiq/run/sessions/run-mixed",
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
      specTarget: { kind: "file" },
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
        relative: ".voratiq/run/sessions/run-no-success",
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
      specTarget: { kind: "file" },
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
      relative: ".voratiq/run/sessions/run-aborted",
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
      [
        expect.objectContaining({
          agentId: "alpha",
          status: "aborted",
          warnings: ["Run aborted before agent completed."],
          startedAt: "2025-11-10T00:00:00.000Z",
          completedAt: "2025-11-10T00:05:00.000Z",
        }),
      ],
      false,
    );
    expect(report).toEqual(runReport);
  });

  it("persists an errored run status when orchestration fails", async () => {
    generateRunIdMock.mockReturnValue("run-orchestration-error");
    validateAndPrepareMock.mockResolvedValue({
      specContent: "Implement feature",
      specTarget: { kind: "file" },
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
        relative: ".voratiq/run/sessions/run-orchestration-error",
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

  it("finalizes run teardown exactly once when execution throws", async () => {
    generateRunIdMock.mockReturnValue("run-fail");
    validateAndPrepareMock.mockResolvedValue({
      specContent: "Implement feature",
      specTarget: { kind: "file" },
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
        relative: ".voratiq/run/sessions/run-fail",
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

    expect(finalizeActiveRunMock).toHaveBeenCalledTimes(1);
    expect(finalizeActiveRunMock).toHaveBeenCalledWith("run-fail");
  });

  it("passes staged extra-context references through to agent execution", async () => {
    generateRunIdMock.mockReturnValue("run-xyz");
    validateAndPrepareMock.mockResolvedValue({
      specContent: "Implement feature",
      specTarget: { kind: "file" },
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
        relative: ".voratiq/run/sessions/run-xyz",
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
