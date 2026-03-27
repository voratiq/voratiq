import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type {
  AgentRuntimeHarnessInput,
  AgentRuntimeHarnessResult,
} from "../../../../src/agents/runtime/types.js";
import { createTeardownController } from "../../../../src/competition/shared/teardown.js";
import type { EnvironmentConfig } from "../../../../src/configs/environment/types.js";
import { createVerifyCompetitionAdapter } from "../../../../src/domain/verify/competition/adapter.js";
import type { SharedVerificationInputs } from "../../../../src/domain/verify/competition/shared-layout.js";
import type { ResolvedVerificationTarget } from "../../../../src/domain/verify/competition/target.js";
import { ensureWorkspaceDependencies } from "../../../../src/workspace/dependencies.js";

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

jest.mock("../../../../src/workspace/chat/native-usage.js", () => ({
  extractProviderNativeTokenUsageForSession: (
    ...args: Parameters<typeof extractProviderNativeTokenUsageForSessionMock>
  ) => extractProviderNativeTokenUsageForSessionMock(...args),
}));

jest.mock("../../../../src/workspace/dependencies.js", () => ({
  ensureWorkspaceDependencies: jest.fn(() => Promise.resolve()),
}));

const ensureWorkspaceDependenciesMock = jest.mocked(
  ensureWorkspaceDependencies,
);

describe("createVerifyCompetitionAdapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    extractProviderNativeTokenUsageForSessionMock.mockResolvedValue({
      status: "unavailable",
      reason: "chat_not_captured",
      provider: "codex",
      modelId: "gpt-5",
    });
  });

  it("hydrates verifier workspaces before rubric execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-verify-adapter-"));
    const sharedRootAbsolute = join(root, ".shared");
    const sharedInputsAbsolute = join(sharedRootAbsolute, "inputs");
    const referenceRepoAbsolute = join(sharedRootAbsolute, "reference", "repo");
    const environment: EnvironmentConfig = {
      node: {
        dependencyRoots: ["node_modules"],
      },
    };

    try {
      await mkdir(sharedInputsAbsolute, { recursive: true });
      await mkdir(referenceRepoAbsolute, { recursive: true });
      await mkdir(join(root, "node_modules"), { recursive: true });

      const adapter = createVerifyCompetitionAdapter({
        root,
        verificationId: "verify-123",
        resolvedTarget: {
          baseRevisionSha: "base-sha",
          competitiveCandidates: [
            {
              canonicalId: "candidate-a",
              forbiddenIdentityTokens: ["candidate-a"],
            },
          ],
          target: { kind: "reduce", sessionId: "reduce-123" },
          reductionRecord: {
            sessionId: "reduce-123",
            createdAt: "2026-01-01T00:00:00.000Z",
            status: "succeeded",
            target: { type: "verify", id: "verify-source" },
            reducers: [],
          },
        } as ResolvedVerificationTarget,
        environment,
        extraContextFiles: [],
        sharedInputs: {
          kind: "reduce",
          sharedRootAbsolute,
          sharedInputsAbsolute,
          referenceRepoAbsolute,
          worktreesToRemove: [],
          candidates: [{ alias: "v_aaaaaaaaaa" }],
        } satisfies SharedVerificationInputs,
        teardown: createTeardownController("verify `verify-123`"),
        mutators: {
          recordVerificationRunning: () => Promise.resolve(),
          recordMethodSnapshot: () => Promise.resolve(),
          completeVerification: () =>
            Promise.reject(new Error("not used in adapter test")),
          readRecord: () => Promise.resolve(undefined),
        },
      });

      const preparation = await adapter.prepareCandidates([
        {
          agent: {
            id: "verifier-a",
            provider: "codex",
            model: "gpt-5",
            binary: "node",
            argv: [],
          },
          template: {
            template: "reduce-review",
            prompt: "Evaluate the reduction.",
            rubric: "Choose the best reduction.",
            schema: "type: object",
          },
        },
      ]);
      const prepared = preparation.ready[0];
      if (!prepared) {
        throw new Error("expected prepared verifier candidate");
      }

      runSandboxedAgentMock.mockImplementation(
        async (input: AgentRuntimeHarnessInput) => {
          await writeFile(
            join(input.paths.workspacePath, "result.json"),
            `${JSON.stringify({ rationale: "Dependencies were already present." })}\n`,
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

      const result = await adapter.executeCandidate(prepared, 0);

      expect(result.status).toBe("succeeded");
      expect(ensureWorkspaceDependenciesMock).toHaveBeenCalledWith({
        root,
        workspacePath: prepared.workspacePaths.workspacePath,
        environment,
      });
      expect(
        ensureWorkspaceDependenciesMock.mock.invocationCallOrder[0],
      ).toBeLessThan(runSandboxedAgentMock.mock.invocationCallOrder[0] ?? 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
