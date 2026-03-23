import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, jest } from "@jest/globals";

import { prepareSharedVerificationInputs } from "../../../../src/domains/verifications/competition/shared-layout.js";
import type { ResolvedVerificationTarget } from "../../../../src/domains/verifications/competition/target.js";
import { pathExists } from "../../../../src/utils/fs.js";
import { removeWorktree } from "../../../../src/utils/git.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../../../support/factories/run-records.js";

jest.mock("../../../../src/utils/git.js", () => ({
  removeWorktree: jest.fn(() => Promise.resolve()),
  createDetachedWorktree: jest.fn(() => Promise.resolve()),
}));

const removeWorktreeMock = jest.mocked(removeWorktree);

describe("prepareSharedVerificationInputs", () => {
  it("removes shared inputs root when preparation fails after setup", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-verify-shared-layout-"));
    const verificationId = "verify-failed-prep";
    const missingSpecOutputPath =
      ".voratiq/specs/sessions/spec-123/agent/artifacts/spec.md";

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
                    ".voratiq/specs/sessions/spec-123/agent/artifacts/spec.json",
                },
              ],
            },
          } as ResolvedVerificationTarget,
        }),
      ).rejects.toThrow();

      const sharedRootAbsolute = join(
        root,
        ".voratiq",
        "verifications",
        "sessions",
        verificationId,
        ".shared",
      );
      const referenceRepoAbsolute = join(
        sharedRootAbsolute,
        "reference",
        "repo",
      );

      await expect(pathExists(sharedRootAbsolute)).resolves.toBe(false);
      expect(removeWorktreeMock).toHaveBeenCalledWith({
        root,
        worktreePath: referenceRepoAbsolute,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stages rubric inputs for pruned run targets from durable artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-verify-shared-run-"));
    const verificationId = "verify-run-pruned";
    const runId = "run-123";
    const agentId = "agent-1";
    const specPath = "specs/run-pruned.md";

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
        "runs",
        "sessions",
        runId,
        agentId,
        "artifacts",
      );
      await mkdir(artifactsDir, { recursive: true });
      await writeFile(join(artifactsDir, "diff.patch"), "diff --git\n", "utf8");
      await writeFile(join(artifactsDir, "stdout.log"), "stdout\n", "utf8");
      await writeFile(join(artifactsDir, "stderr.log"), "stderr\n", "utf8");
      await writeFile(join(artifactsDir, "summary.txt"), "summary\n", "utf8");

      const result = await prepareSharedVerificationInputs({
        root,
        verificationId,
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
            status: "pruned",
            deletedAt: new Date().toISOString(),
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
          hasStdout: true,
          hasStderr: true,
          hasSummary: true,
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
        "runs",
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
              status: "pruned",
              deletedAt: new Date().toISOString(),
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
});
