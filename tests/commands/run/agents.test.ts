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

import { runAgentsWithLimit } from "../../../src/commands/run/agents.js";
import { runPostProcessingAndEvaluations } from "../../../src/commands/run/agents/eval-runner.js";
import { AgentRunContext } from "../../../src/commands/run/agents/run-context.js";
import { runAgentProcess } from "../../../src/commands/run/agents/sandbox-launcher.js";
import type { PreparedAgentExecution } from "../../../src/commands/run/agents/types.js";
import type { AgentExecutionResult } from "../../../src/commands/run/reports.js";
import type { AgentDefinition } from "../../../src/configs/agents/types.js";
import type { EnvironmentConfig } from "../../../src/configs/environment/types.js";
import type { EvalDefinition } from "../../../src/configs/evals/types.js";
import type { AgentInvocationRecord } from "../../../src/records/types.js";
import { buildAgentWorkspacePaths } from "../../../src/workspace/layout.js";

jest.mock("../../../src/commands/run/agents/sandbox-launcher.js", () => {
  const actual: typeof import("../../../src/commands/run/agents/sandbox-launcher.js") =
    jest.requireActual("../../../src/commands/run/agents/sandbox-launcher.js");
  return {
    ...actual,
    runAgentProcess: jest.fn(),
  };
});

jest.mock("../../../src/commands/run/agents/eval-runner.js", () => ({
  runPostProcessingAndEvaluations: jest.fn(),
}));

jest.mock("../../../src/commands/run/agents/auth-stage.js", () => {
  const actual: typeof import("../../../src/commands/run/agents/auth-stage.js") =
    jest.requireActual("../../../src/commands/run/agents/auth-stage.js");
  const stageAgentAuth = jest.fn<typeof actual.stageAgentAuth>();
  const teardownAuthContext = jest
    .fn<typeof actual.teardownAuthContext>()
    .mockResolvedValue(undefined);
  return {
    ...actual,
    stageAgentAuth,
    teardownAuthContext,
  };
});

const runAgentProcessMock = jest.mocked(runAgentProcess);
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
    runAgentProcessMock.mockResolvedValue({
      exitCode: 1,
      signal: null,
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
    runAgentProcessMock.mockResolvedValue({
      exitCode: 0,
      signal: null,
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
    runAgentProcessMock.mockResolvedValue({
      exitCode: 0,
      signal: null,
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

async function createPreparedExecution(): Promise<{
  execution: PreparedAgentExecution;
  progress: NonNullable<PreparedAgentExecution["progress"]>;
}> {
  const root = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX));
  tempRoots.push(root);

  const runId = "run-id";
  const agentId = "agent-id";
  const workspacePaths = buildAgentWorkspacePaths({ root, runId, agentId });

  await mkdir(workspacePaths.agentRoot, { recursive: true });
  await mkdir(workspacePaths.workspacePath, { recursive: true });
  await mkdir(workspacePaths.evalsDirPath, { recursive: true });
  await mkdir(workspacePaths.sandboxPath, { recursive: true });
  await mkdir(workspacePaths.sandboxHomePath, { recursive: true });
  await mkdir(workspacePaths.runtimePath, { recursive: true });
  await ensureParentDirectory(workspacePaths.stdoutPath);
  await ensureParentDirectory(workspacePaths.stderrPath);
  await ensureParentDirectory(workspacePaths.diffPath);
  await ensureParentDirectory(workspacePaths.summaryPath);
  await ensureParentDirectory(workspacePaths.runtimeManifestPath);
  await ensureParentDirectory(workspacePaths.sandboxSettingsPath);

  const manifestContent = {
    binary: "/bin/echo",
    argv: [],
    promptPath: "../prompt.txt",
    workspace: workspacePaths.workspacePath,
    env: {},
  };
  await writeFile(
    workspacePaths.runtimeManifestPath,
    `${JSON.stringify(manifestContent)}\n`,
    "utf8",
  );

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
    runtimeManifestPath: workspacePaths.runtimeManifestPath,
    baseRevisionSha: "base-sha",
    root,
    runId,
    evalPlan,
    environment,
    manifestEnv: {},
    progress,
  };

  return { execution, progress };
}

async function ensureParentDirectory(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}
