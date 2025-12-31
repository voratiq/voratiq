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
import { runAgentsWithLimit } from "../../../src/commands/run/agents.js";
import { runPostProcessingAndEvaluations } from "../../../src/commands/run/agents/eval-runner.js";
import { AgentRunContext } from "../../../src/commands/run/agents/run-context.js";
import type { PreparedAgentExecution } from "../../../src/commands/run/agents/types.js";
import { buildRunAgentWorkspacePaths } from "../../../src/commands/run/agents/workspace.js";
import type { AgentExecutionResult } from "../../../src/commands/run/reports.js";
import type { AgentDefinition } from "../../../src/configs/agents/types.js";
import type { EnvironmentConfig } from "../../../src/configs/environment/types.js";
import type { EvalDefinition } from "../../../src/configs/evals/types.js";
import type { AgentInvocationRecord } from "../../../src/runs/records/types.js";
import { buildAgentWorkspacePaths } from "../../../src/workspace/layout.js";

jest.mock("../../../src/agents/runtime/harness.js", () => ({
  runSandboxedAgent: jest.fn(),
}));

jest.mock("../../../src/commands/run/agents/eval-runner.js", () => ({
  runPostProcessingAndEvaluations: jest.fn(),
}));

const runSandboxedAgentMock = jest.mocked(runSandboxedAgent);
const runPostProcessingAndEvaluationsMock = jest.mocked(
  runPostProcessingAndEvaluations,
);

const TEMP_DIR_PREFIX = "voratiq-agent-lifecycle-";
const evalPlan: EvalDefinition[] = [
  { slug: "format" },
  { slug: "lint" },
  { slug: "typecheck" },
  { slug: "tests" },
];
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

    const [result] = await runAgentsWithLimit([execution], 1);

    expect(progress.onRunning).toHaveBeenCalledTimes(1);
    expect(progress.onCompleted).toHaveBeenCalledTimes(1);
    expect(progress.onCompleted).toHaveBeenCalledWith(result);
    expect(result.record.status).toBe("failed");
    expect(runPostProcessingAndEvaluationsMock).not.toHaveBeenCalled();
  });

  it("invokes onCompleted exactly once for successful agents", async () => {
    const { execution, progress } = await createPreparedExecution();
    runSandboxedAgentMock.mockResolvedValue({
      exitCode: 0,
      signal: null,
      sandboxSettings: minimalSandboxSettings(),
      manifestEnv: {},
    });
    runPostProcessingAndEvaluationsMock.mockResolvedValue({
      artifacts: {
        summaryCaptured: false,
        diffAttempted: false,
        diffCaptured: false,
      },
      evaluations: [],
      warnings: [],
    });

    const [result] = await runAgentsWithLimit([execution], 1);

    expect(progress.onRunning).toHaveBeenCalledTimes(1);
    expect(progress.onCompleted).toHaveBeenCalledTimes(1);
    expect(progress.onCompleted).toHaveBeenCalledWith(result);
    expect(result.record.status).toBe("succeeded");
    expect(runPostProcessingAndEvaluationsMock).toHaveBeenCalledTimes(1);
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
    runPostProcessingAndEvaluationsMock.mockResolvedValue({
      artifacts: {
        summaryCaptured: true,
        diffAttempted: true,
        diffCaptured: true,
        diffStatistics,
      },
      evaluations: evalPlan.map((definition) => ({
        slug: definition.slug,
        status: "succeeded" as const,
        command: definition.command,
        exitCode: 0,
      })),
      warnings: [],
    });

    const [result] = await runAgentsWithLimit([execution], 1);

    expect(result.record.diffStatistics).toBe(diffStatistics);
    expect(result.report.diffStatistics).toBe(diffStatistics);
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

    runPostProcessingAndEvaluationsMock.mockResolvedValue({
      artifacts: {
        summaryCaptured: false,
        diffAttempted: false,
        diffCaptured: false,
      },
      evaluations: [],
      warnings: [],
    });

    const results = await runAgentsWithLimit([first, second], 1);
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
});

describe("AgentRunContext", () => {
  it("persists an empty eval array when the plan is empty", () => {
    const agent: AgentDefinition = {
      id: "agent-empty-evals",
      provider: "none",
      model: "mock",
      binary: "node",
      argv: [],
    };

    const context = new AgentRunContext({
      agent,
      runId: "run-empty-evals",
      startedAt: new Date().toISOString(),
      evalPlan: [],
    });

    context.setCompleted();
    const result = context.finalize();

    expect(result.record.evals).toEqual([]);
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
  await mkdir(workspacePaths.evalsDirPath, { recursive: true });
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
    evalPlan,
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
    evalPlan,
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
