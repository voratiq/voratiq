import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe } from "@jest/globals";

import { executeCompetitionWithAdapter } from "../../../src/competition/command-adapter.js";
import { createTeardownController } from "../../../src/competition/shared/teardown.js";
import type { EnvironmentConfig } from "../../../src/configs/environment/types.js";
import {
  createVerifyCompetitionAdapter,
  type PreparedVerifyCompetitionCandidate,
  type VerifyCompetitionCandidate,
  type VerifyCompetitionExecution,
} from "../../../src/domains/verifications/competition/adapter.js";
import type { RubricTemplateContents } from "../../../src/domains/verifications/competition/prompt.js";
import type { SharedVerificationInputs } from "../../../src/domains/verifications/competition/shared-layout.js";
import type { ResolvedVerificationTarget } from "../../../src/domains/verifications/competition/target.js";
import type { VerificationRecordMutators } from "../../../src/domains/verifications/model/mutators.js";
import type { VerificationRecord } from "../../../src/domains/verifications/model/types.js";
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
const template: RubricTemplateContents = {
  template: "reduce-review",
  prompt: "prompt",
  rubric: "rubric",
  schema: "schema: value",
};
const sharedInputs: SharedVerificationInputs = {
  kind: "reduce",
  sharedRootAbsolute: "/repo/.voratiq/verifications/sessions/verify-id/.shared",
  sharedInputsAbsolute:
    "/repo/.voratiq/verifications/sessions/verify-id/.shared/inputs",
  referenceRepoAbsolute:
    "/repo/.voratiq/verifications/sessions/verify-id/.shared/reference/repo",
  worktreesToRemove: [],
  candidates: [{ alias: "r_aaaaaaaaaa" }],
};

const subject: AdapterContractSubject<VerifyCompetitionExecution> = {
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
  }: AdapterContractScenarioInput<VerifyCompetitionExecution>) => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-verify-adapter-"));
    try {
      const verifyCandidates = candidates.map((id) => toVerifyCandidate(id));
      const teardown = createTeardownController("verify `verify-id`");
      const adapter = createVerifyCompetitionAdapter({
        root,
        verificationId: "verify-id",
        resolvedTarget: buildResolvedTarget(),
        environment,
        extraContextFiles: [],
        sharedInputs,
        teardown,
        mutators: createMutators(events),
      });

      return await executeCompetitionWithAdapter({
        candidates: verifyCandidates,
        maxParallel,
        adapter: {
          ...adapter,
          failurePolicy,
          prepareCandidates: (
            queued,
          ): {
            ready: PreparedVerifyCompetitionCandidate[];
            failures: VerifyCompetitionExecution[];
          } => ({
            ready: queued.map((candidate) => ({
              candidate,
              workspacePaths: toWorkspacePaths(candidate.agent.id),
            })),
            failures: [],
          }),
          executeCandidate: async (prepared) => {
            const candidateId = prepared.candidate.agent.id;
            events.push(`execute:${candidateId}`);

            const delay = delaysMsByCandidateId?.[candidateId] ?? 0;
            if (delay > 0) {
              await sleep(delay);
            }

            if (failingCandidates?.has(candidateId)) {
              throw new Error(`execution failure for ${candidateId}`);
            }

            return {
              template: prepared.candidate.template.template,
              verifierId: candidateId,
              status: "succeeded",
              artifactPath: normalizeArtifactPath(candidateId),
              startedAt: "2026-01-01T00:00:00.000Z",
              completedAt: "2026-01-01T00:00:01.000Z",
              tokenUsageResult: buildUnavailableTokenUsageResult(candidateId),
            };
          },
          captureExecutionFailure: captureFailures
            ? adapter.captureExecutionFailure
            : undefined,
          cleanupPreparedCandidate: (prepared) => {
            events.push(`cleanup:${prepared.candidate.agent.id}`);
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
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  getResultId: (result) => result.verifierId,
  getResultStatus: (result) => result.status,
};

describe("verify competition adapter contract", () => {
  defineCompetitionCommandAdapterContract(subject);
});

function createMutators(events: string[]): VerificationRecordMutators {
  return {
    recordVerificationRunning: () => Promise.resolve(),
    recordMethodSnapshot: (method) => {
      events.push(
        `snapshot:${method.method}:${method.verifierId ?? method.slug}:${method.status}`,
      );
      return Promise.resolve();
    },
    completeVerification: () =>
      Promise.resolve({
        sessionId: "verify-id",
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "succeeded",
        target: { kind: "reduce", sessionId: "reduce-id" },
        methods: [],
      } as VerificationRecord),
    readRecord: () => Promise.resolve(undefined),
  };
}

function toVerifyCandidate(id: string): VerifyCompetitionCandidate {
  return {
    agent: {
      id,
      provider: "codex",
      model: "gpt-5",
      binary: "node",
      argv: [],
    },
    template,
  };
}

function toWorkspacePaths(id: string): AgentWorkspacePaths {
  const base = `/repo/.voratiq/verifications/sessions/verify-id/${id}`;
  return {
    agentRoot: base,
    artifactsPath: `${base}/artifacts`,
    contextPath: `${base}/context`,
    stdoutPath: `${base}/artifacts/stdout.log`,
    stderrPath: `${base}/artifacts/stderr.log`,
    workspacePath: `${base}/workspace`,
    runtimeManifestPath: `${base}/runtime/manifest.json`,
    sandboxPath: `${base}/sandbox`,
    sandboxHomePath: `${base}/sandbox/home`,
    sandboxSettingsPath: `${base}/runtime/sandbox.json`,
    runtimePath: `${base}/runtime`,
  };
}

function buildResolvedTarget(): ResolvedVerificationTarget {
  return {
    baseRevisionSha: "base-sha",
    competitiveCandidates: [
      {
        canonicalId: "agent-a",
        forbiddenIdentityTokens: ["agent-a"],
      },
    ],
    target: {
      kind: "reduce",
      sessionId: "reduce-id",
    },
    reductionRecord: {
      sessionId: "reduce-id",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "succeeded",
      target: {
        type: "verification",
        id: "verification-id",
      },
      reducers: [],
    },
  } as ResolvedVerificationTarget;
}

function normalizeArtifactPath(id: string): string {
  return `.voratiq/verifications/sessions/verify-id/${id}/template/artifacts/result.json`;
}

function buildUnavailableTokenUsageResult(agentId: string) {
  return {
    status: "unavailable" as const,
    reason: "chat_not_captured" as const,
    provider: "unknown",
    modelId: agentId,
  };
}
