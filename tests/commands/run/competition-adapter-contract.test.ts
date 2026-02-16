import { describe } from "@jest/globals";

import type { PreparedAgentExecution } from "../../../src/commands/run/agents/types.js";
import { createRunCompetitionAdapter } from "../../../src/commands/run/competition-adapter.js";
import type { AgentExecutionResult } from "../../../src/commands/run/reports.js";
import { executeCompetitionWithAdapter } from "../../../src/competition/command-adapter.js";
import type { AgentDefinition } from "../../../src/configs/agents/types.js";
import type { EnvironmentConfig } from "../../../src/configs/environment/types.js";
import type { EvalDefinition } from "../../../src/configs/evals/types.js";
import type { AgentRecordMutators } from "../../../src/runs/records/mutators.js";
import {
  type AdapterContractScenarioInput,
  type AdapterContractSubject,
  defineCompetitionCommandAdapterContract,
} from "../../competition/command-adapter-contract.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const environment: EnvironmentConfig = {};

const subject: AdapterContractSubject<AgentExecutionResult> = {
  run: async ({
    candidates,
    maxParallel,
    failurePolicy,
    failingCandidates,
    captureFailures,
    delaysMsByCandidateId,
    sortResults,
    throwFinalizeError,
    events,
  }: AdapterContractScenarioInput<AgentExecutionResult>) => {
    const agents = candidates.map((id) => toAgentDefinition(id));
    const mutators = createMutators(events);

    const adapter = createRunCompetitionAdapter(
      {
        baseRevisionSha: "base-sha",
        runId: "run-id",
        root: "/repo",
        specContent: "spec",
        evalPlan: [] satisfies readonly EvalDefinition[],
        mutators,
        environment,
      },
      {
        prepareCandidates: ({ agents: queuedAgents }) =>
          Promise.resolve({
            ready: queuedAgents.map((agent) => toPreparedExecution(agent)),
            failures: [],
          }),
        executePrepared: async (execution) => {
          const candidateId = execution.agent.id;
          events.push(`execute:${candidateId}`);
          const delay = delaysMsByCandidateId?.[candidateId] ?? 0;
          if (delay > 0) {
            await sleep(delay);
          }

          if (execution.progress?.onRunning) {
            await execution.progress.onRunning(
              buildAgentRecord(candidateId, "running"),
            );
          }

          if (failingCandidates?.has(candidateId)) {
            throw new Error(`execution failure for ${candidateId}`);
          }

          const result = buildExecutionResult(candidateId, "succeeded");
          if (execution.progress?.onCompleted) {
            await execution.progress.onCompleted(result);
          }
          return result;
        },
      },
    );

    return await executeCompetitionWithAdapter({
      candidates: agents,
      maxParallel,
      adapter: {
        ...adapter,
        failurePolicy,
        captureExecutionFailure: captureFailures
          ? ({ prepared, error }) =>
              buildExecutionResult(
                prepared.agent.id,
                "failed",
                error instanceof Error ? error.message : String(error),
              )
          : undefined,
        cleanupPreparedCandidate: (prepared) => {
          events.push(`cleanup:${prepared.agent.id}`);
        },
        finalizeCompetition: () => {
          events.push("finalize");
          if (throwFinalizeError) {
            throw new Error("finalize failure");
          }
        },
        sortResults,
      },
    });
  },
  getResultId: (result) => result.record.agentId,
  getResultStatus: (result) =>
    result.record.status === "failed" ? "failed" : "succeeded",
};

describe("run competition adapter contract", () => {
  defineCompetitionCommandAdapterContract(subject);
});

function createMutators(events: string[]): AgentRecordMutators {
  return {
    recordAgentQueued: (agent) => {
      events.push(`queued:${agent.id}`);
      return Promise.resolve();
    },
    recordAgentSnapshot: (record) => {
      events.push(`snapshot:${record.agentId}:${record.status}`);
      return Promise.resolve();
    },
  };
}

function toAgentDefinition(id: string): AgentDefinition {
  return {
    id,
    provider: "none",
    model: "mock",
    binary: "mock-binary",
    argv: [],
  };
}

function toPreparedExecution(agent: AgentDefinition): PreparedAgentExecution {
  return {
    agent,
    agentContext: {} as PreparedAgentExecution["agentContext"],
    workspacePaths: {} as PreparedAgentExecution["workspacePaths"],
    baseRevisionSha: "base-sha",
    root: "/repo",
    runId: "run-id",
    prompt: "spec",
    evalPlan: [],
    environment,
  };
}

function buildExecutionResult(
  agentId: string,
  status: "succeeded" | "failed",
  reason?: string,
): AgentExecutionResult {
  return {
    record: buildAgentRecord(agentId, status, reason),
    report: {
      agentId,
      status,
      runtimeManifestPath: `runs/run-id/agents/${agentId}/runtime-manifest.json`,
      baseDirectory: `runs/run-id/agents/${agentId}`,
      assets: {},
      evals: [],
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      diffAttempted: false,
      diffCaptured: false,
      ...(reason ? { error: reason } : {}),
    },
  };
}

function buildAgentRecord(
  agentId: string,
  status: "running" | "succeeded" | "failed",
  reason?: string,
): {
  agentId: string;
  model: string;
  status: "running" | "succeeded" | "failed";
  startedAt?: string;
  completedAt?: string;
  evals?: [];
  error?: string;
} {
  if (status === "running") {
    return {
      agentId,
      model: "mock",
      status,
      startedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  return {
    agentId,
    model: "mock",
    status,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    evals: [],
    ...(reason ? { error: reason } : {}),
  };
}
