import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type {
  AgentRuntimeHarnessInput,
  AgentRuntimeHarnessResult,
} from "../../../../src/agents/runtime/types.js";
import { createTeardownController } from "../../../../src/competition/shared/teardown.js";
import type { AgentDefinition } from "../../../../src/configs/agents/types.js";
import type { VerificationConfig } from "../../../../src/configs/verification/types.js";
import { executeAndPersistRubricMethods } from "../../../../src/domain/verify/competition/rubric.js";
import type { ResolvedVerificationTarget } from "../../../../src/domain/verify/competition/target.js";
import type { VerificationRecordMutators } from "../../../../src/domain/verify/model/mutators.js";
import { pathExists } from "../../../../src/utils/fs.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../../../support/factories/run-records.js";

const runSandboxedAgentMock =
  jest.fn<
    typeof import("../../../../src/agents/runtime/harness.js").runSandboxedAgent
  >();
const extractProviderNativeTokenUsageForSessionMock =
  jest.fn<
    typeof import("../../../../src/workspace/chat/native-usage.js").extractProviderNativeTokenUsageForSession
  >();

jest.mock("../../../../src/agents/runtime/harness.js", () => ({
  runSandboxedAgent: (...args: Parameters<typeof runSandboxedAgentMock>) =>
    runSandboxedAgentMock(...args),
}));

jest.mock("../../../../src/utils/git.js", () => ({
  createDetachedWorktree: jest.fn(() => Promise.resolve()),
  removeWorktree: jest.fn(() => Promise.resolve()),
}));

jest.mock("../../../../src/workspace/chat/native-usage.js", () => ({
  extractProviderNativeTokenUsageForSession: (
    ...args: Parameters<typeof extractProviderNativeTokenUsageForSessionMock>
  ) => extractProviderNativeTokenUsageForSessionMock(...args),
}));

const verificationConfig: VerificationConfig = {
  spec: { rubric: [] },
  run: { programmatic: [], rubric: [{ template: "run-review" }] },
  reduce: { rubric: [] },
};

const verifierAgent: AgentDefinition = {
  id: "verifier-a",
  provider: "codex",
  model: "gpt-5",
  binary: "node",
  argv: [],
};

describe("executeAndPersistRubricMethods", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    extractProviderNativeTokenUsageForSessionMock.mockResolvedValue({
      status: "unavailable",
      reason: "chat_not_captured",
      provider: "codex",
      modelId: "gpt-5",
    });
  });

  it("stages only blind-safe run artifacts for blinded verifiers", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-verify-rubric-run-"));
    const runId = "run-123";
    const candidateId = "agent-1";
    const blindedAlias = "v_aaaaaaaaaa";
    const specPath = "specs/run-123.md";

    try {
      await writeFile(
        join(root, ".git"),
        "gitdir: ./.git/worktrees/test\n",
        "utf8",
      );
      await mkdir(join(root, "specs"), { recursive: true });
      await writeFile(join(root, specPath), "# spec\n", "utf8");

      const templateDir = join(
        root,
        ".voratiq",
        "verify",
        "templates",
        "run-review",
      );
      await mkdir(templateDir, { recursive: true });
      await writeFile(join(templateDir, "prompt.md"), "Evaluate outcomes.\n");
      await writeFile(
        join(templateDir, "rubric.md"),
        "Prefer the best diff.\n",
      );
      await writeFile(
        join(templateDir, "schema.yaml"),
        "type: object\n",
        "utf8",
      );

      const artifactsDir = join(
        root,
        ".voratiq",
        "run",
        "sessions",
        runId,
        candidateId,
        "artifacts",
      );
      await mkdir(artifactsDir, { recursive: true });
      await writeFile(join(artifactsDir, "diff.patch"), "diff --git\n", "utf8");
      await writeFile(join(artifactsDir, "summary.txt"), "summary\n", "utf8");
      await writeFile(
        join(artifactsDir, "stdout.log"),
        `canonical id leak: ${candidateId}\n`,
        "utf8",
      );
      await writeFile(
        join(artifactsDir, "stderr.log"),
        `error path for ${candidateId}\n`,
        "utf8",
      );
      await writeFile(
        join(artifactsDir, "chat.jsonl"),
        `{"candidate":"${candidateId}"}\n`,
        "utf8",
      );

      runSandboxedAgentMock.mockImplementation(
        async (input: AgentRuntimeHarnessInput) => {
          const candidateInputsDir = join(
            input.paths.workspacePath,
            "inputs",
            "candidates",
            blindedAlias,
          );

          await expect(
            pathExists(join(candidateInputsDir, "diff.patch")),
          ).resolves.toBe(true);
          await expect(
            pathExists(join(candidateInputsDir, "summary.txt")),
          ).resolves.toBe(true);
          await expect(
            pathExists(join(candidateInputsDir, "stdout.log")),
          ).resolves.toBe(false);
          await expect(
            pathExists(join(candidateInputsDir, "stderr.log")),
          ).resolves.toBe(false);
          await expect(
            pathExists(join(candidateInputsDir, "chat.jsonl")),
          ).resolves.toBe(false);
          expect(input.prompt).toContain(
            `diff: \`inputs/candidates/${blindedAlias}/diff.patch\``,
          );
          expect(input.prompt).toContain(
            `summary: \`inputs/candidates/${blindedAlias}/summary.txt\``,
          );
          expect(input.prompt).not.toContain("stdout:");
          expect(input.prompt).not.toContain("stderr:");
          expect(input.prompt).not.toContain(candidateId);

          await writeFile(
            join(input.paths.workspacePath, "result.json"),
            `${JSON.stringify({
              preferred: blindedAlias,
              ranking: [blindedAlias],
              rationale: "Outcome verified.",
            })}\n`,
            "utf8",
          );

          return {
            exitCode: 0,
            signal: null,
            sandboxSettings: {},
            manifestEnv: {},
          } as unknown as AgentRuntimeHarnessResult;
        },
      );

      const methods = await executeAndPersistRubricMethods({
        root,
        verificationId: "verify-123",
        resolvedTarget: buildRunTarget({
          runId,
          specPath,
          candidateId,
        }),
        verificationConfig,
        verifierAgents: [verifierAgent],
        aliasMap: { [blindedAlias]: candidateId },
        environment: {},
        extraContextFiles: [],
        maxParallel: 1,
        teardown: createTeardownController("rubric test"),
        mutators: createMutators(),
      });

      expect(methods).toEqual([
        expect.objectContaining({
          method: "rubric",
          verifierId: verifierAgent.id,
          template: "run-review",
          status: "succeeded",
        }),
      ]);
      expect(runSandboxedAgentMock).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function buildRunTarget(options: {
  runId: string;
  specPath: string;
  candidateId: string;
}): ResolvedVerificationTarget {
  const { runId, specPath, candidateId } = options;
  const runRecord = createRunRecord({
    runId,
    status: "pruned",
    deletedAt: new Date().toISOString(),
    spec: { path: specPath },
    agents: [
      createAgentInvocationRecord({
        agentId: candidateId,
        artifacts: {
          diffCaptured: true,
          summaryCaptured: true,
          stdoutCaptured: true,
          stderrCaptured: true,
          chatCaptured: true,
          chatFormat: "jsonl",
        },
      }),
    ],
  });

  return {
    baseRevisionSha: runRecord.baseRevisionSha,
    competitiveCandidates: [
      { canonicalId: candidateId, forbiddenIdentityTokens: [candidateId] },
    ],
    target: {
      kind: "run",
      sessionId: runId,
      candidateIds: [candidateId],
    },
    runRecord,
  };
}

function createMutators(): VerificationRecordMutators {
  return {
    recordVerificationRunning: () => Promise.resolve(),
    recordMethodSnapshot: () => Promise.resolve(),
    completeVerification: () =>
      Promise.reject(new Error("not used in rubric test")),
    readRecord: () => Promise.resolve(undefined),
  };
}
