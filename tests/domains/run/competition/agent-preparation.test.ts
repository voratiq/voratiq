import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { AgentDefinition } from "../../../../src/configs/agents/types.js";
import { prepareAgents } from "../../../../src/domain/run/competition/agent-preparation.js";
import { prepareAgentForExecution } from "../../../../src/domain/run/competition/agents/preparation.js";
import type {
  AgentPreparationOutcome,
  PreparedAgentExecution,
} from "../../../../src/domain/run/competition/agents/types.js";
import type { AgentExecutionResult } from "../../../../src/domain/run/competition/reports.js";

jest.mock(
  "../../../../src/domain/run/competition/agents/preparation.js",
  () => {
    const actual = jest.requireActual<
      typeof import("../../../../src/domain/run/competition/agents/preparation.js")
    >("../../../../src/domain/run/competition/agents/preparation.js");
    return {
      ...actual,
      prepareAgentForExecution: jest.fn(),
    };
  },
);

const prepareAgentForExecutionMock = jest.mocked(prepareAgentForExecution);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for preparation state");
    }
    await sleep(1);
  }
}

function createAgent(id: string): AgentDefinition {
  return {
    id,
    provider: "mock-provider",
    model: "mock-model",
    binary: "mock-binary",
    argv: ["mock-binary"],
  };
}

function createPreparedExecution(
  agent: AgentDefinition,
): PreparedAgentExecution {
  return {
    agent,
    agentContext: {} as PreparedAgentExecution["agentContext"],
    workspacePaths: {} as PreparedAgentExecution["workspacePaths"],
    baseRevisionSha: "base-sha",
    root: "/repo",
    runId: "run-123",
    prompt: "spec",
    hasStagedContext: false,
    environment: {},
  };
}

function createReadyOutcome(agent: AgentDefinition): AgentPreparationOutcome {
  return {
    status: "ready",
    prepared: createPreparedExecution(agent),
  };
}

function createFailureResult(
  agentId: string,
  reason: string,
): AgentExecutionResult {
  return {
    record: {
      agentId,
      model: "mock-model",
      status: "failed",
      error: reason,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      commitSha: "base-sha",
      artifacts: {
        diffAttempted: false,
        diffCaptured: false,
        stdoutCaptured: false,
        stderrCaptured: false,
        summaryCaptured: false,
      },
    },
    report: {
      agentId,
      status: "failed",
      tokenUsageResult: {
        status: "unavailable",
        reason: "chat_not_captured",
        provider: "mock-provider",
        modelId: "mock-model",
      },
      runtimeManifestPath: `.voratiq/run/sessions/run-123/${agentId}/runtime-manifest.json`,
      baseDirectory: `.voratiq/run/sessions/run-123/${agentId}`,
      assets: {},
      error: reason,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      diffAttempted: false,
      diffCaptured: false,
    },
  };
}

function createFailedOutcome(
  agentId: string,
  reason: string,
): AgentPreparationOutcome {
  return {
    status: "failed",
    result: createFailureResult(agentId, reason),
  };
}

function buildPrepareOptions(agents: readonly AgentDefinition[]) {
  return {
    agents,
    baseRevisionSha: "base-sha",
    runId: "run-123",
    root: "/repo",
    specContent: "Implement the task.",
    extraContextFiles: [],
    environment: {},
  };
}

describe("prepareAgents", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("caps workspace preparation at two candidates in flight", async () => {
    const agents = ["alpha", "beta", "gamma", "delta"].map(createAgent);
    const deferredByAgent = new Map(
      agents.map((agent) => [
        agent.id,
        createDeferred<AgentPreparationOutcome>(),
      ]),
    );
    const started: string[] = [];
    let active = 0;
    let maxActive = 0;

    prepareAgentForExecutionMock.mockImplementation(async ({ agent }) => {
      started.push(agent.id);
      active += 1;
      maxActive = Math.max(maxActive, active);

      try {
        return await deferredByAgent.get(agent.id)!.promise;
      } finally {
        active -= 1;
      }
    });

    const preparationPromise = prepareAgents(buildPrepareOptions(agents));

    await waitForCondition(() => started.length === 2);
    expect(started).toEqual(["alpha", "beta"]);
    expect(active).toBe(2);

    deferredByAgent.get("beta")!.resolve(createReadyOutcome(agents[1]));
    await waitForCondition(() => started.length === 3);
    expect(started).toEqual(["alpha", "beta", "gamma"]);
    expect(active).toBe(2);

    deferredByAgent.get("alpha")!.resolve(createReadyOutcome(agents[0]));
    await waitForCondition(() => started.length === 4);
    expect(started).toEqual(["alpha", "beta", "gamma", "delta"]);
    expect(active).toBe(2);

    deferredByAgent.get("gamma")!.resolve(createReadyOutcome(agents[2]));
    deferredByAgent.get("delta")!.resolve(createReadyOutcome(agents[3]));

    const result = await preparationPromise;

    expect(maxActive).toBe(2);
    expect(result.ready.map((prepared) => prepared.agent.id)).toEqual([
      "alpha",
      "beta",
      "gamma",
      "delta",
    ]);
    expect(result.failures).toEqual([]);
  });

  it("preserves ready candidate ordering across out-of-order preparation completion", async () => {
    const agents = ["alpha", "beta", "gamma"].map(createAgent);
    const deferredByAgent = new Map(
      agents.map((agent) => [
        agent.id,
        createDeferred<AgentPreparationOutcome>(),
      ]),
    );
    const started: string[] = [];

    prepareAgentForExecutionMock.mockImplementation(async ({ agent }) => {
      started.push(agent.id);
      return await deferredByAgent.get(agent.id)!.promise;
    });

    const preparationPromise = prepareAgents(buildPrepareOptions(agents));

    await waitForCondition(() => started.length === 2);
    deferredByAgent.get("beta")!.resolve(createReadyOutcome(agents[1]));

    await waitForCondition(() => started.length === 3);
    deferredByAgent.get("gamma")!.resolve(createReadyOutcome(agents[2]));
    deferredByAgent.get("alpha")!.resolve(createReadyOutcome(agents[0]));

    const result = await preparationPromise;

    expect(result.ready.map((prepared) => prepared.agent.id)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("captures candidate-specific preparation failures under bounded parallelism", async () => {
    const agents = ["alpha", "beta", "gamma", "delta"].map(createAgent);
    const deferredByAgent = new Map(
      agents.map((agent) => [
        agent.id,
        createDeferred<AgentPreparationOutcome>(),
      ]),
    );
    const started: string[] = [];

    prepareAgentForExecutionMock.mockImplementation(async ({ agent }) => {
      started.push(agent.id);
      return await deferredByAgent.get(agent.id)!.promise;
    });

    const preparationPromise = prepareAgents(buildPrepareOptions(agents));

    await waitForCondition(() => started.length === 2);
    deferredByAgent
      .get("beta")!
      .resolve(createFailedOutcome("beta", "workspace staging failed"));

    await waitForCondition(() => started.length === 3);
    deferredByAgent.get("alpha")!.resolve(createReadyOutcome(agents[0]));

    await waitForCondition(() => started.length === 4);
    deferredByAgent
      .get("delta")!
      .resolve(createFailedOutcome("delta", "context staging failed"));
    deferredByAgent.get("gamma")!.resolve(createReadyOutcome(agents[2]));

    const result = await preparationPromise;

    expect(result.ready.map((prepared) => prepared.agent.id)).toEqual([
      "alpha",
      "gamma",
    ]);
    expect(result.failures.map((failure) => failure.record.agentId)).toEqual([
      "beta",
      "delta",
    ]);
    expect(result.failures.map((failure) => failure.report.error)).toEqual([
      "workspace staging failed",
      "context staging failed",
    ]);
  });
});
