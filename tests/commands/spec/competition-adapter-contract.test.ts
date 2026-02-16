import { describe } from "@jest/globals";

import {
  createSpecCompetitionAdapter,
  type PreparedSpecCompetitionCandidate,
  type SpecCompetitionExecution,
} from "../../../src/commands/spec/competition-adapter.js";
import { executeCompetitionWithAdapter } from "../../../src/competition/command-adapter.js";
import type { AgentDefinition } from "../../../src/configs/agents/types.js";
import type { EnvironmentConfig } from "../../../src/configs/environment/types.js";
import type { AgentWorkspacePaths } from "../../../src/workspace/layout.js";
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

const subject: AdapterContractSubject<SpecCompetitionExecution> = {
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
  }: AdapterContractScenarioInput<SpecCompetitionExecution>) => {
    const specCandidates = candidates.map((id) => toAgentDefinition(id));

    const adapter = createSpecCompetitionAdapter({
      root: "/repo",
      sessionId: "spec-session",
      description: "Describe the task",
      specTitle: "Task Spec",
      environment,
    });

    return await executeCompetitionWithAdapter({
      candidates: specCandidates,
      maxParallel,
      adapter: {
        ...adapter,
        failurePolicy,
        prepareCandidates: (
          queued,
        ): {
          ready: PreparedSpecCompetitionCandidate[];
          failures: SpecCompetitionExecution[];
        } => ({
          ready: queued.map((candidate) => ({
            candidate,
            workspacePaths: toWorkspacePaths(candidate.id),
            prompt: `prompt:${candidate.id}`,
          })),
          failures: [],
        }),
        executeCandidate: async (prepared) => {
          const candidateId = prepared.candidate.id;
          events.push(`execute:${candidateId}`);

          const delay = delaysMsByCandidateId?.[candidateId] ?? 0;
          if (delay > 0) {
            await sleep(delay);
          }

          if (failingCandidates?.has(candidateId)) {
            throw new Error(`execution failure for ${candidateId}`);
          }

          return {
            agentId: candidateId,
            specPath: normalizeSpecPath(candidateId),
            status: "generated",
          };
        },
        captureExecutionFailure: captureFailures
          ? ({ prepared, error }) => ({
              agentId: prepared.candidate.id,
              specPath: normalizeSpecPath(prepared.candidate.id),
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            })
          : undefined,
        cleanupPreparedCandidate: (prepared) => {
          events.push(`cleanup:${prepared.candidate.id}`);
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
  getResultId: (result) => result.agentId,
  getResultStatus: (result) =>
    result.status === "failed" ? "failed" : "succeeded",
};

describe("spec competition adapter contract", () => {
  defineCompetitionCommandAdapterContract(subject);
});

function toAgentDefinition(id: string): AgentDefinition {
  return {
    id,
    provider: "codex",
    model: "gpt-5",
    binary: "node",
    argv: [],
  };
}

function toWorkspacePaths(id: string): AgentWorkspacePaths {
  const base = `/repo/.voratiq/specs/sessions/spec-session/${id}`;
  return {
    agentRoot: base,
    artifactsPath: `${base}/artifacts`,
    stdoutPath: `${base}/artifacts/stdout.log`,
    stderrPath: `${base}/artifacts/stderr.log`,
    reviewPath: `${base}/artifacts/review.md`,
    workspacePath: `${base}/workspace`,
    runtimeManifestPath: `${base}/runtime/manifest.json`,
    sandboxPath: `${base}/sandbox`,
    sandboxHomePath: `${base}/sandbox/home`,
    sandboxSettingsPath: `${base}/runtime/sandbox.json`,
    runtimePath: `${base}/runtime`,
  };
}

function normalizeSpecPath(id: string): string {
  return `.voratiq/specs/sessions/spec-session/${id}/artifacts/spec.md`;
}
