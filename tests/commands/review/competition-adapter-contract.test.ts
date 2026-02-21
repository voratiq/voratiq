import { describe } from "@jest/globals";

import {
  createReviewCompetitionAdapter,
  type PreparedReviewCompetitionCandidate,
  type ReviewCompetitionCandidate,
  type ReviewCompetitionExecution,
} from "../../../src/commands/review/competition-adapter.js";
import { executeCompetitionWithAdapter } from "../../../src/competition/command-adapter.js";
import type { AgentDefinition } from "../../../src/configs/agents/types.js";
import type { EnvironmentConfig } from "../../../src/configs/environment/types.js";
import type { RunRecordEnhanced } from "../../../src/runs/records/enhanced.js";
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

const run: RunRecordEnhanced = {
  runId: "run-id",
  createdAt: "2026-01-01T00:00:00.000Z",
  status: "succeeded",
  baseRevisionSha: "base-sha",
  rootPath: ".",
  spec: {
    path: "spec.md",
  },
  agents: [],
};

const subject: AdapterContractSubject<ReviewCompetitionExecution> = {
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
  }: AdapterContractScenarioInput<ReviewCompetitionExecution>) => {
    const reviewCandidates = candidates.map((id) =>
      toReviewCompetitionCandidate(id),
    );

    const adapter = createReviewCompetitionAdapter({
      root: "/repo",
      reviewId: "review-id",
      createdAt: "2026-01-01T00:00:00.000Z",
      reviewsFilePath: "/repo/.voratiq/reviews/index.json",
      run,
      environment,
      runWorkspaceAbsolute: "/repo/.voratiq/runs/sessions/run-id",
    });

    return await executeCompetitionWithAdapter({
      candidates: reviewCandidates,
      maxParallel,
      adapter: {
        ...adapter,
        failurePolicy,
        prepareCandidates: (
          queued,
        ): {
          ready: PreparedReviewCompetitionCandidate[];
          failures: ReviewCompetitionExecution[];
        } => ({
          ready: queued.map((candidate) => ({
            candidate,
            workspacePaths: toWorkspacePaths(candidate.id),
            outputPath: normalizeOutputPath(candidate.id),
            prompt: `prompt:${candidate.id}`,
            missingArtifacts: [],
            blinded: {
              enabled: true,
              aliasMap: { r_aaaaaaaaaa: "agent-a" },
              stagedSpecPath:
                ".voratiq/reviews/sessions/review-id/.shared/inputs/spec.md",
              baseSnapshotPath:
                ".voratiq/reviews/sessions/review-id/.shared/inputs/base",
              stagedCandidates: [
                {
                  candidateId: "r_aaaaaaaaaa",
                  agentId: "agent-a",
                  diffPath:
                    ".voratiq/reviews/sessions/review-id/.shared/inputs/candidates/r_aaaaaaaaaa/diff.patch",
                  diffRecorded: true,
                },
              ],
              extraWriteProtectedPaths: [],
              extraReadProtectedPaths: [],
            },
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
            outputPath: normalizeOutputPath(candidateId),
            status: "succeeded",
            missingArtifacts: [],
          };
        },
        captureExecutionFailure: captureFailures
          ? ({ prepared, error }) => ({
              agentId: prepared.candidate.id,
              outputPath: normalizeOutputPath(prepared.candidate.id),
              status: "failed",
              missingArtifacts: [],
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
  getResultStatus: (result) => result.status,
};

describe("review competition adapter contract", () => {
  defineCompetitionCommandAdapterContract(subject);
});

function toReviewCompetitionCandidate(id: string): ReviewCompetitionCandidate {
  return toAgentDefinition(id);
}

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
  const base = `/repo/.voratiq/reviews/sessions/review-id/${id}`;
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

function normalizeOutputPath(id: string): string {
  return `.voratiq/reviews/sessions/review-id/${id}/artifacts/review.md`;
}
