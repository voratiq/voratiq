import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, jest } from "@jest/globals";

import {
  finalizeActiveVerification,
  registerActiveVerification,
} from "../../../../src/commands/verify/lifecycle.js";
import { createTeardownController } from "../../../../src/competition/shared/teardown.js";
import { createVerifyCompetitionAdapter } from "../../../../src/domains/verifications/competition/adapter.js";
import type { SharedVerificationInputs } from "../../../../src/domains/verifications/competition/shared-layout.js";
import type { ResolvedVerificationTarget } from "../../../../src/domains/verifications/competition/target.js";
import { pathExists } from "../../../../src/utils/fs.js";
import { removeWorktree } from "../../../../src/utils/git.js";

jest.mock("../../../../src/utils/git.js", () => ({
  removeWorktree: jest.fn(() => Promise.resolve()),
  createDetachedWorktree: jest.fn(),
}));

const removeWorktreeMock = jest.mocked(removeWorktree);

describe("verify competition teardown", () => {
  it("retains verifier artifacts while pruning scratch paths and shared inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-verify-teardown-"));

    try {
      const sharedRootAbsolute = join(root, ".shared");
      const referenceRepoAbsolute = join(
        sharedRootAbsolute,
        "reference",
        "repo",
      );
      const teardown = createTeardownController("verify `verify-123`");
      registerActiveVerification({
        root,
        verificationsFilePath: join(
          root,
          ".voratiq",
          "verifications",
          "index.json",
        ),
        verificationId: "verify-123",
        teardown,
      });

      teardown.addWorktree({
        root,
        worktreePath: referenceRepoAbsolute,
        label: "detached reference worktree",
      });
      teardown.addPath(sharedRootAbsolute, "shared verification inputs");

      const adapter = createVerifyCompetitionAdapter({
        root,
        verificationId: "verify-123",
        resolvedTarget: {
          baseRevisionSha: "base-sha",
          competitiveCandidates: [],
          target: { kind: "reduce", sessionId: "reduce-123" },
          reductionRecord: {
            sessionId: "reduce-123",
            createdAt: "2026-01-01T00:00:00.000Z",
            status: "succeeded",
            target: { type: "verification", id: "verify-source" },
            reducers: [],
          },
        } as ResolvedVerificationTarget,
        environment: {},
        extraContextFiles: [],
        sharedInputs: {
          kind: "reduce",
          sharedRootAbsolute,
          sharedInputsAbsolute: join(sharedRootAbsolute, "inputs"),
          referenceRepoAbsolute,
          worktreesToRemove: [referenceRepoAbsolute],
          candidates: [],
        } satisfies SharedVerificationInputs,
        teardown,
        mutators: {
          recordVerificationRunning: () => Promise.resolve(),
          recordMethodSnapshot: () => Promise.resolve(),
          completeVerification: () =>
            Promise.reject(new Error("not used in teardown test")),
          readRecord: () => Promise.resolve(undefined),
        },
      });

      const preparation = await adapter.prepareCandidates([
        {
          agent: {
            id: "verifier",
            provider: "codex",
            model: "gpt-5",
            binary: "node",
            argv: [],
          },
          template: {
            template: "reduce-review",
            prompt: "prompt",
            rubric: "rubric",
            schema: "schema: value",
          },
        },
      ]);
      const prepared = preparation.ready[0];
      expect(prepared).toBeDefined();

      const paths = prepared.workspacePaths;
      await mkdir(paths.workspacePath, { recursive: true });
      await mkdir(paths.contextPath, { recursive: true });
      await mkdir(paths.runtimePath, { recursive: true });
      await mkdir(paths.sandboxPath, { recursive: true });
      await mkdir(paths.artifactsPath, { recursive: true });
      await mkdir(referenceRepoAbsolute, { recursive: true });
      await mkdir(join(sharedRootAbsolute, "inputs"), { recursive: true });

      await finalizeActiveVerification("verify-123");

      await expect(pathExists(paths.workspacePath)).resolves.toBe(false);
      await expect(pathExists(paths.contextPath)).resolves.toBe(false);
      await expect(pathExists(paths.runtimePath)).resolves.toBe(false);
      await expect(pathExists(paths.sandboxPath)).resolves.toBe(false);
      await expect(pathExists(paths.artifactsPath)).resolves.toBe(true);
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
