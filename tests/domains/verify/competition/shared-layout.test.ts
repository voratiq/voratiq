import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { EnvironmentConfig } from "../../../../src/configs/environment/types.js";
import { prepareSharedVerificationInputs } from "../../../../src/domain/verify/competition/shared-layout.js";
import type { ResolvedVerificationTarget } from "../../../../src/domain/verify/competition/target.js";
import { pathExists } from "../../../../src/utils/fs.js";
import { removeWorktree } from "../../../../src/utils/git.js";
import { ensureWorkspaceDependencies } from "../../../../src/workspace/dependencies.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../../../support/factories/run-records.js";

jest.mock("../../../../src/utils/git.js", () => ({
  removeWorktree: jest.fn(() => Promise.resolve()),
  createDetachedWorktree: jest.fn(() => Promise.resolve()),
}));

jest.mock("../../../../src/workspace/dependencies.js", () => ({
  ensureWorkspaceDependencies: jest.fn(() => Promise.resolve()),
}));

const removeWorktreeMock = jest.mocked(removeWorktree);
const ensureWorkspaceDependenciesMock = jest.mocked(
  ensureWorkspaceDependencies,
);

describe("prepareSharedVerificationInputs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("removes shared inputs root when preparation fails after setup for legacy slugged spec records", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-verify-shared-layout-"));
    const verificationId = "verify-failed-prep";
    const missingSpecOutputPath =
      ".voratiq/spec/sessions/spec-123/agent/artifacts/payment-flow.md";

    try {
      await writeFile(
        join(root, ".git"),
        "gitdir: ./.git/worktrees/test\n",
        "utf8",
      );

      await expect(
        prepareSharedVerificationInputs({
          root,
          verificationId,
          environment: {},
          resolvedTarget: {
            baseRevisionSha: "base-sha",
            competitiveCandidates: [],
            target: { kind: "spec", sessionId: "spec-123" },
            specRecord: {
              sessionId: "spec-123",
              createdAt: "2026-01-01T00:00:00.000Z",
              startedAt: "2026-01-01T00:00:00.000Z",
              completedAt: "2026-01-01T00:01:00.000Z",
              description: "Draft a spec",
              status: "succeeded",
              agents: [
                {
                  agentId: "agent",
                  status: "succeeded",
                  startedAt: "2026-01-01T00:00:00.000Z",
                  completedAt: "2026-01-01T00:01:00.000Z",
                  outputPath: missingSpecOutputPath,
                  dataPath:
                    ".voratiq/spec/sessions/spec-123/agent/artifacts/payment-flow.json",
                },
              ],
            },
          } as ResolvedVerificationTarget,
        }),
      ).rejects.toThrow();

      const sharedRootAbsolute = join(
        root,
        ".voratiq",
        "verify",
        "sessions",
        verificationId,
        ".shared",
      );
      const referenceRepoAbsolute = join(
        sharedRootAbsolute,
        "reference",
        "repo",
      );

      expect(ensureWorkspaceDependenciesMock).toHaveBeenCalledWith({
        root,
        workspacePath: referenceRepoAbsolute,
        environment: {},
      });
      await expect(pathExists(sharedRootAbsolute)).resolves.toBe(false);
      expect(removeWorktreeMock).toHaveBeenCalledWith({
        root,
        worktreePath: referenceRepoAbsolute,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stages rubric inputs for run targets from durable artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-verify-shared-run-"));
    const verificationId = "verify-run";
    const runId = "run-123";
    const agentId = "agent-1";
    const specPath = "specs/run.md";

    try {
      await writeFile(
        join(root, ".git"),
        "gitdir: ./.git/worktrees/test\n",
        "utf8",
      );
      await mkdir(join(root, "specs"), { recursive: true });
      await writeFile(join(root, specPath), "# spec\n", "utf8");

      const artifactsDir = join(
        root,
        ".voratiq",
        "run",
        "sessions",
        runId,
        agentId,
        "artifacts",
      );
      await mkdir(artifactsDir, { recursive: true });
      await writeFile(join(artifactsDir, "diff.patch"), "diff --git\n", "utf8");
      await writeFile(join(artifactsDir, "stdout.log"), "stdout\n", "utf8");
      await writeFile(join(artifactsDir, "stderr.log"), "stderr\n", "utf8");
      await writeFile(join(artifactsDir, "chat.jsonl"), "{}\n", "utf8");
      await writeFile(join(artifactsDir, "summary.txt"), "summary\n", "utf8");

      const result = await prepareSharedVerificationInputs({
        root,
        verificationId,
        environment: {},
        resolvedTarget: {
          baseRevisionSha: "base-sha",
          competitiveCandidates: [
            {
              canonicalId: agentId,
              forbiddenIdentityTokens: [agentId],
            },
          ],
          target: {
            kind: "run",
            sessionId: runId,
            candidateIds: [agentId],
          },
          runRecord: createRunRecord({
            runId,
            status: "succeeded",
            spec: { path: specPath },
            agents: [
              createAgentInvocationRecord({
                agentId,
                artifacts: {
                  diffCaptured: true,
                  summaryCaptured: true,
                  stdoutCaptured: true,
                  stderrCaptured: true,
                },
              }),
            ],
          }),
        } as ResolvedVerificationTarget,
      });

      expect(result.kind).toBe("run");
      if (result.kind !== "run") {
        throw new Error("expected run shared inputs");
      }
      expect(result.candidates).toEqual([
        {
          alias: agentId,
          hasDiff: true,
          hasSummary: true,
        },
      ]);
      await expect(
        pathExists(
          join(
            result.sharedInputsAbsolute,
            "candidates",
            agentId,
            "diff.patch",
          ),
        ),
      ).resolves.toBe(true);
      await expect(
        pathExists(
          join(
            result.sharedInputsAbsolute,
            "candidates",
            agentId,
            "summary.txt",
          ),
        ),
      ).resolves.toBe(true);
      await expect(
        pathExists(
          join(
            result.sharedInputsAbsolute,
            "candidates",
            agentId,
            "stdout.log",
          ),
        ),
      ).resolves.toBe(false);
      await expect(
        pathExists(
          join(
            result.sharedInputsAbsolute,
            "candidates",
            agentId,
            "stderr.log",
          ),
        ),
      ).resolves.toBe(false);
      await expect(
        pathExists(
          join(
            result.sharedInputsAbsolute,
            "candidates",
            agentId,
            "chat.jsonl",
          ),
        ),
      ).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats summary.txt as optional even when metadata says it was captured", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-verify-shared-run-optional-summary-"),
    );
    const verificationId = "verify-run-optional-summary";
    const runId = "run-optional-summary";
    const agentId = "agent-1";
    const specPath = "specs/run-optional-summary.md";

    try {
      await writeFile(
        join(root, ".git"),
        "gitdir: ./.git/worktrees/test\n",
        "utf8",
      );
      await mkdir(join(root, "specs"), { recursive: true });
      await writeFile(join(root, specPath), "# spec\n", "utf8");

      const artifactsDir = join(
        root,
        ".voratiq",
        "run",
        "sessions",
        runId,
        agentId,
        "artifacts",
      );
      await mkdir(artifactsDir, { recursive: true });
      await writeFile(join(artifactsDir, "diff.patch"), "diff --git\n", "utf8");

      const result = await prepareSharedVerificationInputs({
        root,
        verificationId,
        environment: {},
        resolvedTarget: {
          baseRevisionSha: "base-sha",
          competitiveCandidates: [
            {
              canonicalId: agentId,
              forbiddenIdentityTokens: [agentId],
            },
          ],
          target: {
            kind: "run",
            sessionId: runId,
            candidateIds: [agentId],
          },
          runRecord: createRunRecord({
            runId,
            status: "succeeded",
            spec: { path: specPath },
            agents: [
              createAgentInvocationRecord({
                agentId,
                artifacts: {
                  diffCaptured: true,
                  summaryCaptured: true,
                },
              }),
            ],
          }),
        } as ResolvedVerificationTarget,
      });

      expect(result.kind).toBe("run");
      if (result.kind !== "run") {
        throw new Error("expected run shared inputs");
      }
      expect(result.candidates).toEqual([
        {
          alias: agentId,
          hasDiff: true,
          hasSummary: false,
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails with an explicit artifact error when a required run artifact is missing", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-verify-shared-run-missing-"),
    );
    const verificationId = "verify-run-missing";
    const runId = "run-missing";
    const agentId = "agent-1";
    const specPath = "specs/run-missing.md";

    try {
      await writeFile(
        join(root, ".git"),
        "gitdir: ./.git/worktrees/test\n",
        "utf8",
      );
      await mkdir(join(root, "specs"), { recursive: true });
      await writeFile(join(root, specPath), "# spec\n", "utf8");

      const artifactsDir = join(
        root,
        ".voratiq",
        "run",
        "sessions",
        runId,
        agentId,
        "artifacts",
      );
      await mkdir(artifactsDir, { recursive: true });
      await writeFile(join(artifactsDir, "stdout.log"), "stdout\n", "utf8");
      await writeFile(join(artifactsDir, "stderr.log"), "stderr\n", "utf8");
      await writeFile(join(artifactsDir, "summary.txt"), "summary\n", "utf8");

      await expect(
        prepareSharedVerificationInputs({
          root,
          verificationId,
          environment: {},
          resolvedTarget: {
            baseRevisionSha: "base-sha",
            competitiveCandidates: [
              {
                canonicalId: agentId,
                forbiddenIdentityTokens: [agentId],
              },
            ],
            target: {
              kind: "run",
              sessionId: runId,
              candidateIds: [agentId],
            },
            runRecord: createRunRecord({
              runId,
              status: "succeeded",
              spec: { path: specPath },
              agents: [
                createAgentInvocationRecord({
                  agentId,
                  artifacts: {
                    diffCaptured: true,
                    summaryCaptured: true,
                    stdoutCaptured: true,
                    stderrCaptured: true,
                  },
                }),
              ],
            }),
          } as ResolvedVerificationTarget,
        }),
      ).rejects.toThrow(
        /missing required verification artifact `diff.patch`/iu,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stages spec deliverables from recorded paths, including legacy slugged artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-verify-shared-spec-"));
    const verificationId = "verify-spec-artifacts";
    const agentId = "agent-spec";
    const specArtifactsDir = join(
      root,
      ".voratiq",
      "spec",
      "sessions",
      "spec-123",
      agentId,
      "artifacts",
    );

    try {
      await writeFile(
        join(root, ".git"),
        "gitdir: ./.git/worktrees/test\n",
        "utf8",
      );
      await mkdir(specArtifactsDir, { recursive: true });
      await writeFile(
        join(specArtifactsDir, "payment-flow.md"),
        "# spec\n",
        "utf8",
      );
      await writeFile(
        join(specArtifactsDir, "payment-flow.json"),
        '{"title":"Spec"}\n',
        "utf8",
      );
      await writeFile(join(specArtifactsDir, "stdout.log"), "stdout\n", "utf8");
      await writeFile(join(specArtifactsDir, "stderr.log"), "stderr\n", "utf8");
      await writeFile(join(specArtifactsDir, "chat.jsonl"), "{}\n", "utf8");

      const result = await prepareSharedVerificationInputs({
        root,
        verificationId,
        environment: {},
        resolvedTarget: {
          baseRevisionSha: "base-sha",
          competitiveCandidates: [
            {
              canonicalId: agentId,
              forbiddenIdentityTokens: [agentId],
            },
          ],
          target: { kind: "spec", sessionId: "spec-123" },
          specRecord: {
            sessionId: "spec-123",
            createdAt: "2026-01-01T00:00:00.000Z",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:01:00.000Z",
            description: "Draft a spec",
            status: "succeeded",
            baseRevisionSha: "base-sha",
            agents: [
              {
                agentId,
                status: "succeeded",
                startedAt: "2026-01-01T00:00:00.000Z",
                completedAt: "2026-01-01T00:01:00.000Z",
                outputPath:
                  ".voratiq/spec/sessions/spec-123/agent-spec/artifacts/payment-flow.md",
                dataPath:
                  ".voratiq/spec/sessions/spec-123/agent-spec/artifacts/payment-flow.json",
              },
            ],
          },
        } as ResolvedVerificationTarget,
      });

      expect(result.kind).toBe("spec");
      if (result.kind !== "spec") {
        throw new Error("expected spec shared inputs");
      }
      expect(result.candidates).toEqual([
        {
          alias: agentId,
          hasSpecData: true,
        },
      ]);
      await expect(
        pathExists(
          join(result.sharedInputsAbsolute, "drafts", agentId, "spec.md"),
        ),
      ).resolves.toBe(true);
      await expect(
        pathExists(
          join(result.sharedInputsAbsolute, "drafts", agentId, "spec.json"),
        ),
      ).resolves.toBe(true);
      await expect(
        pathExists(
          join(result.sharedInputsAbsolute, "drafts", agentId, "stdout.log"),
        ),
      ).resolves.toBe(false);
      await expect(
        pathExists(
          join(result.sharedInputsAbsolute, "drafts", agentId, "stderr.log"),
        ),
      ).resolves.toBe(false);
      await expect(
        pathExists(
          join(result.sharedInputsAbsolute, "drafts", agentId, "chat.jsonl"),
        ),
      ).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stages reduction deliverables and excludes raw execution artifacts", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-verify-shared-reduction-"),
    );
    const verificationId = "verify-reduction-artifacts";
    const agentId = "reducer-a";
    const reducerArtifactsDir = join(
      root,
      ".voratiq",
      "reduce",
      "sessions",
      "reduce-123",
      agentId,
      "artifacts",
    );

    try {
      await writeFile(
        join(root, ".git"),
        "gitdir: ./.git/worktrees/test\n",
        "utf8",
      );
      await mkdir(reducerArtifactsDir, { recursive: true });
      await writeFile(
        join(reducerArtifactsDir, "reduction.md"),
        "# reduction\n",
        "utf8",
      );
      await writeFile(
        join(reducerArtifactsDir, "stdout.log"),
        "stdout\n",
        "utf8",
      );
      await writeFile(
        join(reducerArtifactsDir, "stderr.log"),
        "stderr\n",
        "utf8",
      );
      await writeFile(join(reducerArtifactsDir, "chat.jsonl"), "{}\n", "utf8");

      const result = await prepareSharedVerificationInputs({
        root,
        verificationId,
        environment: {},
        resolvedTarget: {
          baseRevisionSha: "base-sha",
          competitiveCandidates: [
            {
              canonicalId: agentId,
              forbiddenIdentityTokens: [agentId],
            },
          ],
          target: { kind: "reduce", sessionId: "reduce-123" },
          reductionRecord: {
            sessionId: "reduce-123",
            target: { type: "run", id: "run-123" },
            createdAt: "2026-01-01T00:00:00.000Z",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:01:00.000Z",
            status: "succeeded",
            reducers: [
              {
                agentId,
                status: "succeeded",
                outputPath:
                  ".voratiq/reduce/sessions/reduce-123/reducer-a/artifacts/reduction.md",
                startedAt: "2026-01-01T00:00:00.000Z",
                completedAt: "2026-01-01T00:01:00.000Z",
              },
            ],
          },
        } as ResolvedVerificationTarget,
      });

      expect(result.kind).toBe("reduce");
      await expect(
        pathExists(
          join(
            result.sharedInputsAbsolute,
            "candidates",
            agentId,
            "reduction.md",
          ),
        ),
      ).resolves.toBe(true);
      await expect(
        pathExists(
          join(
            result.sharedInputsAbsolute,
            "candidates",
            agentId,
            "stdout.log",
          ),
        ),
      ).resolves.toBe(false);
      await expect(
        pathExists(
          join(
            result.sharedInputsAbsolute,
            "candidates",
            agentId,
            "stderr.log",
          ),
        ),
      ).resolves.toBe(false);
      await expect(
        pathExists(
          join(
            result.sharedInputsAbsolute,
            "candidates",
            agentId,
            "chat.jsonl",
          ),
        ),
      ).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("hydrates dependency roots for the shared reference repo", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-verify-shared-dependencies-"),
    );
    const verificationId = "verify-shared-deps";
    const runId = "run-shared-deps";
    const agentId = "agent-1";
    const specPath = "specs/run-shared-deps.md";
    const environment: EnvironmentConfig = {
      node: {
        dependencyRoots: ["node_modules"],
      },
    };

    try {
      await writeFile(
        join(root, ".git"),
        "gitdir: ./.git/worktrees/test\n",
        "utf8",
      );
      await mkdir(join(root, "specs"), { recursive: true });
      await writeFile(join(root, specPath), "# spec\n", "utf8");
      await mkdir(join(root, "node_modules"), { recursive: true });

      const result = await prepareSharedVerificationInputs({
        root,
        verificationId,
        environment,
        resolvedTarget: {
          baseRevisionSha: "base-sha",
          competitiveCandidates: [
            {
              canonicalId: agentId,
              forbiddenIdentityTokens: [agentId],
            },
          ],
          target: {
            kind: "run",
            sessionId: runId,
            candidateIds: [agentId],
          },
          runRecord: createRunRecord({
            runId,
            status: "succeeded",
            spec: { path: specPath },
            agents: [
              createAgentInvocationRecord({
                agentId,
                artifacts: {},
              }),
            ],
          }),
        } as ResolvedVerificationTarget,
      });

      expect(result.kind).toBe("run");
      if (result.kind !== "run") {
        throw new Error("expected run shared inputs");
      }
      expect(ensureWorkspaceDependenciesMock).toHaveBeenCalledWith({
        root,
        workspacePath: result.referenceRepoAbsolute,
        environment,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stages message prompt and blinded response artifacts without creating a reference repo", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-verify-shared-message-"),
    );
    const verificationId = "verify-message-artifacts";
    const messageArtifactsDir = join(
      root,
      ".voratiq",
      "message",
      "sessions",
      "message-123",
      "agent-a",
      "artifacts",
    );

    try {
      await mkdir(messageArtifactsDir, { recursive: true });
      await writeFile(join(messageArtifactsDir, "response.md"), "response\n");

      const result = await prepareSharedVerificationInputs({
        root,
        verificationId,
        environment: {},
        resolvedTarget: {
          competitiveCandidates: [
            {
              canonicalId: "agent-a",
              forbiddenIdentityTokens: ["agent-a"],
            },
          ],
          target: { kind: "message", sessionId: "message-123" },
          messageRecord: {
            sessionId: "message-123",
            createdAt: "2026-04-06T00:00:00.000Z",
            startedAt: "2026-04-06T00:00:00.000Z",
            completedAt: "2026-04-06T00:00:05.000Z",
            status: "succeeded",
            prompt: "Review the response.",
            recipients: [
              {
                agentId: "agent-a",
                status: "succeeded",
                startedAt: "2026-04-06T00:00:00.000Z",
                completedAt: "2026-04-06T00:00:05.000Z",
                outputPath:
                  ".voratiq/message/sessions/message-123/agent-a/artifacts/response.md",
                error: null,
              },
            ],
            error: null,
          },
        } as ResolvedVerificationTarget,
      });

      expect(result.kind).toBe("message");
      if (result.kind !== "message") {
        throw new Error("expected message shared inputs");
      }
      expect(result.candidates).toEqual([{ alias: "agent-a" }]);
      expect(result.worktreesToRemove).toEqual([]);
      await expect(pathExists(result.promptAbsolute)).resolves.toBe(true);
      await expect(
        pathExists(
          join(
            result.sharedInputsAbsolute,
            "candidates",
            "agent-a",
            "response.md",
          ),
        ),
      ).resolves.toBe(true);
      expect(ensureWorkspaceDependenciesMock).not.toHaveBeenCalled();
      expect(removeWorktreeMock).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
