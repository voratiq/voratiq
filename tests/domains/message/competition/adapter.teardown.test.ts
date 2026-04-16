import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { createMessageCompetitionAdapter } from "../../../../src/domain/message/competition/adapter.js";
import { pathExists } from "../../../../src/utils/fs.js";

describe("message competition teardown", () => {
  it("retains artifacts while pruning recipient scratch state", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-message-teardown-"));

    try {
      const adapter = createMessageCompetitionAdapter({
        root,
        messageId: "message-123",
        prompt: "Review this change.",
        environment: {},
      });

      const preparation = await adapter.prepareCandidates([
        {
          id: "recipient",
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
