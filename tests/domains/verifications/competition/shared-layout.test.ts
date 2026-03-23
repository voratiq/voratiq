import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, jest } from "@jest/globals";

import { prepareSharedVerificationInputs } from "../../../../src/domains/verifications/competition/shared-layout.js";
import type { ResolvedVerificationTarget } from "../../../../src/domains/verifications/competition/target.js";
import { pathExists } from "../../../../src/utils/fs.js";
import { removeWorktree } from "../../../../src/utils/git.js";

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
});
