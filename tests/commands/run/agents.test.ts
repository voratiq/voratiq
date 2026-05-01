import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { runSandboxedAgent } from "../../../src/agents/runtime/harness.js";
import { runPreparedWithLimit } from "../../../src/competition/core.js";
import type { AgentDefinition } from "../../../src/configs/agents/types.js";
import type { EnvironmentConfig } from "../../../src/configs/environment/types.js";
import { runPreparedAgent } from "../../../src/domain/run/competition/agents/lifecycle.js";
import { runPostProcessingAndCollectArtifacts } from "../../../src/domain/run/competition/agents/post-processing.js";
import { AgentRunContext } from "../../../src/domain/run/competition/agents/run-context.js";
import type { PreparedAgentExecution } from "../../../src/domain/run/competition/agents/types.js";
import { buildRunAgentWorkspacePaths } from "../../../src/domain/run/competition/agents/workspace.js";
import type { AgentExecutionResult } from "../../../src/domain/run/competition/reports.js";
import type { AgentInvocationRecord } from "../../../src/domain/run/model/types.js";
import { extractProviderNativeTokenUsageForSession } from "../../../src/workspace/chat/native-usage.js";
import { buildAgentWorkspacePaths } from "../../../src/workspace/layout.js";

jest.mock("../../../src/agents/runtime/harness.js", () => ({
  runSandboxedAgent: jest.fn(),
}));

jest.mock(
  "../../../src/domain/run/competition/agents/post-processing.js",
  () => ({
    runPostProcessingAndCollectArtifacts: jest.fn(),
  }),
);

jest.mock("../../../src/workspace/chat/native-usage.js", () => ({
  extractProviderNativeTokenUsageForSession: jest.fn(),
}));

const runSandboxedAgentMock = jest.mocked(runSandboxedAgent);
const runPostProcessingAndCollectArtifactsMock = jest.mocked(
  runPostProcessingAndCollectArtifacts,
);
const extractProviderNativeTokenUsageForSessionMock = jest.mocked(
  extractProviderNativeTokenUsageForSession,
);

const TEMP_DIR_PREFIX = "voratiq-agent-lifecycle-";
const environment: EnvironmentConfig = {};

const tempRoots: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("executeAgentLifecycle integration", () => {
  it("records a failed snapshot when the agent process exits with an error", async () => {
    const { execution, progress } = await createPreparedExecution();
    runSandboxedAgentMock.mockResolvedValue({
      exitCode: 1,
      signal: null,
      sandboxSettings: minimalSandboxSettings(),
      manifestEnv: {},
    });

    const [result] = await runPreparedExecutionsWithLimit([execution], 1);

    expect(progress.onRunning).toHaveBeenCalledTimes(1);
    expect(progress.onCompleted).toHaveBeenCalledTimes(1);
    expect(progress.onCompleted).toHaveBeenCalledWith(result);
    expect(result.record.status).toBe("failed");
    expect(runPostProcessingAndCollectArtifactsMock).not.toHaveBeenCalled();
  });

  it("prefers extracted failure detail over fatal watchdog pattern text", async () => {
    const { execution } = await createPreparedExecution();
    execution.agent.provider = "codex";
    await writeFile(
      execution.workspacePaths.stdoutPath,
      '{"error":{"type":"invalid_request_error","message":"unsupported_value: model"}}',
      "utf8",
    );

    runSandboxedAgentMock.mockResolvedValue({
      exitCode: 1,
      signal: null,
      errorMessage:
        "Fatal error pattern detected: invalid_request_error (exit code 0)",
      watchdog: {
        silenceTimeoutMs: 1,
        wallClockCapMs: 1,
        trigger: "fatal-pattern",
      },
      sandboxSettings: minimalSandboxSettings(),
      manifestEnv: {},
    });

    const [result] = await runPreparedExecutionsWithLimit([execution], 1);

    expect(result.record.status).toBe("failed");
    expect(result.record.error).toBe("unsupported_value: model (exit code 1)");
  });

  it("invokes onCompleted exactly once for successful agents", async () => {
    const { execution, progress } = await createPreparedExecution();
    runSandboxedAgentMock.mockResolvedValue({
      exitCode: 0,
      signal: null,
      sandboxSettings: minimalSandboxSettings(),
      manifestEnv: {},
    });
    runPostProcessingAndCollectArtifactsMock.mockResolvedValue({
      summaryCaptured: false,
      diffAttempted: false,
      diffCaptured: false,
    });

    const [result] = await runPreparedExecutionsWithLimit([execution], 1);

    expect(progress.onRunning).toHaveBeenCalledTimes(1);
    expect(progress.onCompleted).toHaveBeenCalledTimes(1);
    expect(progress.onCompleted).toHaveBeenCalledWith(result);
    expect(result.record.status).toBe("succeeded");
    expect(runPostProcessingAndCollectArtifactsMock).toHaveBeenCalledTimes(1);
  });

  it("defers sandbox teardown until run-level cleanup", async () => {
    const { execution } = await createPreparedExecution();
    runSandboxedAgentMock.mockResolvedValue({
      exitCode: 0,
      signal: null,
      sandboxSettings: minimalSandboxSettings(),
      manifestEnv: {},
    });
    runPostProcessingAndCollectArtifactsMock.mockResolvedValue({
      summaryCaptured: false,
      diffAttempted: false,
      diffCaptured: false,
    });

    await runPreparedExecutionsWithLimit([execution], 1);

    const invocation = runSandboxedAgentMock.mock.calls.at(-1)?.[0];
    expect(invocation?.teardownAuthOnExit).toBe(false);
    expect(invocation?.sandboxStageId).toBe("run");
  });

  it("propagates diff statistics from artifact collection into agent records", async () => {
    const { execution } = await createPreparedExecution();
    runSandboxedAgentMock.mockResolvedValue({
      exitCode: 0,
      signal: null,
      sandboxSettings: minimalSandboxSettings(),
      manifestEnv: {},
    });

    const diffStatistics = "3 files changed, 4 insertions(+), 1 deletion(-)";
    runPostProcessingAndCollectArtifactsMock.mockResolvedValue({
      summaryCaptured: true,
      diffAttempted: true,
      diffCaptured: true,
      diffStatistics,
    });

    const [result] = await runPreparedExecutionsWithLimit([execution], 1);

    expect(result.record.diffStatistics).toBe(diffStatistics);
    expect(result.report.diffStatistics).toBe(diffStatistics);
  });

  it("threads artifact warnings into the final agent record and report", async () => {
    const { execution } = await createPreparedExecution();
    runSandboxedAgentMock.mockResolvedValue({
      exitCode: 0,
      signal: null,
      sandboxSettings: minimalSandboxSettings(),
      manifestEnv: {},
    });
    runPostProcessingAndCollectArtifactsMock.mockResolvedValue({
      summaryCaptured: false,
      warnings: ["Agent did not produce a change summary."],
      diffAttempted: true,
      diffCaptured: true,
    });

    const [result] = await runPreparedExecutionsWithLimit([execution], 1);

    expect(result.record.warnings).toEqual([
      "Agent did not produce a change summary.",
    ]);
    expect(result.report.warnings).toEqual([
      "Agent did not produce a change summary.",
    ]);
  });

  it("records fail-fast metadata and continues running other agents", async () => {
    const { execution: first } = await createPreparedExecution("agent-1");
    const { execution: second, progress } =
      await createPreparedExecution("agent-2");

    runSandboxedAgentMock
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        errorMessage:
          "Sandbox: repeated denial to registry.npmjs.org:443, aborting to prevent resource exhaustion",
        sandboxSettings: minimalSandboxSettings(),
        manifestEnv: {},
        watchdog: {
          silenceTimeoutMs: 1,
          wallClockCapMs: 1,
          trigger: "sandbox-denial",
        },
        failFast: {
          operation: "network-connect",
          target: "registry.npmjs.org:443",
        },
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        sandboxSettings: minimalSandboxSettings(),
        manifestEnv: {},
      });

    runPostProcessingAndCollectArtifactsMock.mockResolvedValue({
      summaryCaptured: false,
      diffAttempted: false,
      diffCaptured: false,
    });

    const results = await runPreparedExecutionsWithLimit([first, second], 1);
    expect(results).toHaveLength(2);

    const failed = results.find(
      (result) => result.record.agentId === "agent-1",
    );
    const succeeded = results.find(
      (result) => result.record.agentId === "agent-2",
    );
    expect(failed?.record.failFastTriggered).toBe(true);
    expect(failed?.record.failFastTarget).toBe("registry.npmjs.org:443");
    expect(failed?.record.failFastOperation).toBe("network-connect");
    expect(succeeded?.record.status).toBe("succeeded");

    expect(progress.onCompleted).toHaveBeenCalledTimes(1);
  });

  it("extracts token usage from captured chat artifacts before success finalization", async () => {
    const { execution } = await createPreparedExecution();
    execution.agent.provider = "codex";
    execution.agent.model = "codex-mini";

    runSandboxedAgentMock.mockResolvedValue({
      exitCode: 0,
      signal: null,
      sandboxSettings: minimalSandboxSettings(),
      manifestEnv: {},
      chat: {
        captured: true,
        format: "jsonl",
        artifactPath: "/tmp/codex.chat.jsonl",
      },
    });
    runPostProcessingAndCollectArtifactsMock.mockResolvedValue({
      summaryCaptured: false,
      diffAttempted: false,
      diffCaptured: false,
    });
    extractProviderNativeTokenUsageForSessionMock.mockResolvedValue({
      status: "available",
      provider: "codex",
      modelId: "codex-mini",
      tokenUsage: {
        input_tokens: 120,
        cached_input_tokens: 30,
        output_tokens: 45,
        reasoning_output_tokens: 7,
        total_tokens: 202,
      },
    });

    const [result] = await runPreparedExecutionsWithLimit([execution], 1);

    expect(extractProviderNativeTokenUsageForSessionMock).toHaveBeenCalledWith({
      root: execution.root,
      domain: "run",
      sessionId: execution.runId,
      agentId: execution.agent.id,
      provider: "codex",
      modelId: "codex-mini",
      chatCaptured: true,
      format: "jsonl",
      artifactPath: "/tmp/codex.chat.jsonl",
    });
    expect(result.record.tokenUsage).toEqual({
      input_tokens: 120,
      cached_input_tokens: 30,
      output_tokens: 45,
      reasoning_output_tokens: 7,
      total_tokens: 202,
    });
    expect(result.report.tokenUsage).toEqual(result.record.tokenUsage);
    expect(result.report.tokenUsageResult).toEqual({
      status: "available",
      provider: "codex",
      modelId: "codex-mini",
      tokenUsage: result.record.tokenUsage,
    });
  });

  it("persists Gemini token usage from captured JSONL chat artifacts", async () => {
    const { execution } = await createPreparedExecution();
    execution.agent.provider = "gemini";
    execution.agent.model = "gemini-3-flash-preview";

    runSandboxedAgentMock.mockResolvedValue({
      exitCode: 0,
      signal: null,
      sandboxSettings: minimalSandboxSettings(),
      manifestEnv: {},
      chat: {
        captured: true,
        format: "jsonl",
        artifactPath: "/tmp/gemini.chat.jsonl",
      },
    });
    runPostProcessingAndCollectArtifactsMock.mockResolvedValue({
      summaryCaptured: false,
      diffAttempted: false,
      diffCaptured: false,
    });
    extractProviderNativeTokenUsageForSessionMock.mockResolvedValue({
      status: "available",
      provider: "gemini",
      modelId: "gemini-3-flash-preview",
      tokenUsage: {
        input: 28_037,
        output: 225,
        cached: 11_605,
        thoughts: 865,
        tool: 0,
        total: 29_127,
      },
    });

    const [result] = await runPreparedExecutionsWithLimit([execution], 1);

    expect(extractProviderNativeTokenUsageForSessionMock).toHaveBeenCalledWith({
      root: execution.root,
      domain: "run",
      sessionId: execution.runId,
      agentId: execution.agent.id,
      provider: "gemini",
      modelId: "gemini-3-flash-preview",
      chatCaptured: true,
      format: "jsonl",
      artifactPath: "/tmp/gemini.chat.jsonl",
    });
    expect(result.record.tokenUsage).toEqual({
      input: 28_037,
      output: 225,
      cached: 11_605,
      thoughts: 865,
      tool: 0,
      total: 29_127,
    });
    expect(result.report.tokenUsage).toEqual(result.record.tokenUsage);
    expect(result.report.tokenUsageResult).toEqual({
      status: "available",
      provider: "gemini",
      modelId: "gemini-3-flash-preview",
      tokenUsage: result.record.tokenUsage,
    });
  });

  it("extracts token usage on failed terminal paths when chat artifacts exist", async () => {
    const { execution } = await createPreparedExecution();
    execution.agent.provider = "claude";
    execution.agent.model = "claude-sonnet";

    runSandboxedAgentMock.mockResolvedValue({
      exitCode: 1,
      signal: null,
      errorMessage: "agent failed",
      sandboxSettings: minimalSandboxSettings(),
      manifestEnv: {},
      chat: {
        captured: true,
        format: "jsonl",
        artifactPath: "/tmp/claude.chat.jsonl",
      },
    });
    extractProviderNativeTokenUsageForSessionMock.mockResolvedValue({
      status: "available",
      provider: "claude",
      modelId: "claude-sonnet",
      tokenUsage: {
        input_tokens: 210,
        output_tokens: 65,
        cache_read_input_tokens: 41,
        cache_creation_input_tokens: 11,
      },
    });

    const [result] = await runPreparedExecutionsWithLimit([execution], 1);

    expect(result.record.status).toBe("failed");
    expect(runPostProcessingAndCollectArtifactsMock).not.toHaveBeenCalled();
    expect(extractProviderNativeTokenUsageForSessionMock).toHaveBeenCalledWith({
      root: execution.root,
      domain: "run",
      sessionId: execution.runId,
      agentId: execution.agent.id,
      provider: "claude",
      modelId: "claude-sonnet",
      chatCaptured: true,
      format: "jsonl",
      artifactPath: "/tmp/claude.chat.jsonl",
    });
    expect(result.record.tokenUsage).toEqual({
      input_tokens: 210,
      output_tokens: 65,
      cache_read_input_tokens: 41,
      cache_creation_input_tokens: 11,
    });
  });

  it("treats token usage extraction failures as non-fatal", async () => {
    const { execution } = await createPreparedExecution();
    execution.agent.provider = "gemini";
    execution.agent.model = "gemini-2.5";

    runSandboxedAgentMock.mockResolvedValue({
      exitCode: 0,
      signal: null,
      sandboxSettings: minimalSandboxSettings(),
      manifestEnv: {},
      chat: {
        captured: true,
        format: "jsonl",
        artifactPath: "/tmp/gemini.chat.jsonl",
      },
    });
    runPostProcessingAndCollectArtifactsMock.mockResolvedValue({
      summaryCaptured: false,
      diffAttempted: false,
      diffCaptured: false,
    });
    extractProviderNativeTokenUsageForSessionMock.mockResolvedValue({
      status: "unavailable",
      reason: "extractor_error",
      provider: "gemini",
      modelId: "gemini-2.5",
      message: "Chat usage extraction failed: boom",
    });

    const [result] = await runPreparedExecutionsWithLimit([execution], 1);

    expect(result.record.status).toBe("succeeded");
    expect(result.record.tokenUsage).toBeUndefined();
    expect(result.report.tokenUsageResult).toEqual({
      status: "unavailable",
      reason: "extractor_error",
      provider: "gemini",
      modelId: "gemini-2.5",
      message: "Chat usage extraction failed: boom",
    });
    expect(runPostProcessingAndCollectArtifactsMock).toHaveBeenCalledTimes(1);
  });
});

describe("AgentRunContext", () => {
  it("does not persist legacy placeholders when finalizing", () => {
    const agent: AgentDefinition = {
      id: "agent-placeholder",
      provider: "none",
      model: "mock",
      binary: "node",
      argv: [],
    };

    const context = new AgentRunContext({
      agent,
      runId: "run-placeholder",
      startedAt: new Date().toISOString(),
    });

    context.setCompleted();
    const result = context.finalize();

    expect("evals" in result.record).toBe(false);
  });
});

async function createPreparedExecution(agentId = "agent-id"): Promise<{
  execution: PreparedAgentExecution;
  progress: NonNullable<PreparedAgentExecution["progress"]>;
}> {
  const root = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX));
  tempRoots.push(root);

  const runId = "run-id";
  const corePaths = buildAgentWorkspacePaths({ root, runId, agentId });
  const workspacePaths = buildRunAgentWorkspacePaths({
    root,
    runId,
    agentId,
    corePaths,
  });

  await mkdir(corePaths.agentRoot, { recursive: true });
  await mkdir(corePaths.workspacePath, { recursive: true });
  await mkdir(corePaths.sandboxPath, { recursive: true });
  await mkdir(corePaths.sandboxHomePath, { recursive: true });
  await mkdir(corePaths.runtimePath, { recursive: true });
  await ensureParentDirectory(corePaths.stdoutPath);
  await ensureParentDirectory(corePaths.stderrPath);
  await ensureParentDirectory(workspacePaths.diffPath);
  await ensureParentDirectory(workspacePaths.summaryPath);
  await ensureParentDirectory(corePaths.runtimeManifestPath);
  await ensureParentDirectory(corePaths.sandboxSettingsPath);
  await writeFile(corePaths.stdoutPath, "", "utf8");
  await writeFile(corePaths.stderrPath, "", "utf8");

  const agent: AgentDefinition = {
    id: agentId,
    provider: "test-provider",
    model: "test-model",
    binary: "/bin/echo",
    argv: ["hello"],
  };

  const agentContext = new AgentRunContext({
    agent,
    runId,
    startedAt: new Date().toISOString(),
  });

  const progress = {
    onRunning: jest.fn((record: AgentInvocationRecord) => {
      void record;
      return Promise.resolve();
    }),
    onCompleted: jest.fn((result: AgentExecutionResult) => {
      void result;
      return Promise.resolve();
    }),
  } satisfies NonNullable<PreparedAgentExecution["progress"]>;

  const execution: PreparedAgentExecution = {
    agent,
    agentContext,
    workspacePaths,
    baseRevisionSha: "base-sha",
    root,
    runId,
    prompt: "# test prompt\n",
    hasStagedContext: false,
    environment,
    progress,
  };

  return { execution, progress };
}

async function ensureParentDirectory(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

function minimalSandboxSettings(): {
  network: { allowedDomains: string[]; deniedDomains: string[] };
  filesystem: { denyRead: string[]; allowWrite: string[]; denyWrite: string[] };
} {
  return {
    network: { allowedDomains: [], deniedDomains: [] },
    filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
  };
}

async function runPreparedExecutionsWithLimit(
  prepared: PreparedAgentExecution[],
  limit: number,
): Promise<AgentExecutionResult[]> {
  return await runPreparedWithLimit({
    prepared,
    maxParallel: Math.max(1, limit),
    executePrepared: (execution) => runPreparedAgent(execution),
  });
}
