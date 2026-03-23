import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { createSpecCompetitionAdapter } from "../../../../src/domains/specs/competition/adapter.js";
import { pathExists } from "../../../../src/utils/fs.js";

describe("spec competition teardown", () => {
  it("retains artifacts while pruning scratch workspace state", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-spec-teardown-"));

    try {
      const adapter = createSpecCompetitionAdapter({
        root,
        sessionId: "spec-123",
        description: "Draft a spec",
        environment: {},
      });

      const preparation = await adapter.prepareCandidates([
        {
          id: "author",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
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
