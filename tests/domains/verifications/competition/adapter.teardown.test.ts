import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { createVerifyCompetitionAdapter } from "../../../../src/domains/verifications/competition/adapter.js";
import type { SharedVerificationInputs } from "../../../../src/domains/verifications/competition/shared-layout.js";
import type { ResolvedVerificationTarget } from "../../../../src/domains/verifications/competition/target.js";
import { pathExists } from "../../../../src/utils/fs.js";

describe("verify competition teardown", () => {
  it("retains verifier artifacts while pruning other scratch paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-verify-teardown-"));

    try {
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
          sharedRootAbsolute: join(root, ".shared"),
          sharedInputsAbsolute: join(root, ".shared/inputs"),
          referenceRepoAbsolute: join(root, ".shared/reference/repo"),
          worktreesToRemove: [],
          candidates: [],
        } satisfies SharedVerificationInputs,
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

      await adapter.finalizeCompetition?.();

      await expect(pathExists(paths.workspacePath)).resolves.toBe(false);
      await expect(pathExists(paths.contextPath)).resolves.toBe(false);
      await expect(pathExists(paths.runtimePath)).resolves.toBe(false);
      await expect(pathExists(paths.sandboxPath)).resolves.toBe(false);
      await expect(pathExists(paths.artifactsPath)).resolves.toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
