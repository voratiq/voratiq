import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { createReduceCompetitionAdapter } from "../../../../src/domain/reduce/competition/adapter.js";
import { readSpecRecords } from "../../../../src/domain/spec/persistence/adapter.js";
import { pathExists } from "../../../../src/utils/fs.js";

jest.mock("../../../../src/domain/spec/persistence/adapter.js", () => ({
  readSpecRecords: jest.fn(),
}));

const readSpecRecordsMock = jest.mocked(readSpecRecords);

describe("reduce competition teardown", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("retains artifacts while pruning reducer scratch state", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-teardown-"));

    try {
      const sourceDir = join(root, "source");
      await mkdir(sourceDir, { recursive: true });
      const specPath = join(sourceDir, "spec.md");
      const dataPath = join(sourceDir, "spec.json");
      await writeFile(specPath, "# Spec\n", "utf8");
      await writeFile(dataPath, '{"title":"Spec"}\n', "utf8");

      readSpecRecordsMock.mockResolvedValue([
        {
          sessionId: "spec-123",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "succeeded",
          baseRevisionSha: "base-sha",
          description: "Draft a spec",
          agents: [
            {
              agentId: "author",
              status: "succeeded",
              outputPath: "source/spec.md",
              dataPath: "source/spec.json",
            },
          ],
        },
      ] as never);

      const adapter = createReduceCompetitionAdapter({
        root,
        reductionId: "reduce-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        runsFilePath: join(root, ".voratiq", "runs", "index.json"),
        verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
        target: { type: "spec", id: "spec-123" },
        environment: {},
      });

      const preparation = await adapter.prepareCandidates([
        {
          id: "reducer",
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
