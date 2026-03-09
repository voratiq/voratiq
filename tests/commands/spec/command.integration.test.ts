import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { resolveStageCompetitors } from "../../../src/commands/shared/resolve-stage-competitors.js";
import { generateSessionId } from "../../../src/commands/shared/session-id.js";
import { executeSpecCommand } from "../../../src/commands/spec/command.js";
import * as specAdapter from "../../../src/commands/spec/competition-adapter.js";
import { executeCompetitionWithAdapter } from "../../../src/competition/command-adapter.js";
import { loadEnvironmentConfig } from "../../../src/configs/environment/loader.js";
import { readSpecRecords } from "../../../src/specs/records/persistence.js";
import { createWorkspace } from "../../../src/workspace/setup.js";

jest.mock("../../../src/competition/command-adapter.js", () => ({
  executeCompetitionWithAdapter: jest.fn(),
}));

jest.mock("../../../src/configs/environment/loader.js", () => ({
  loadEnvironmentConfig: jest.fn(),
}));

jest.mock("../../../src/commands/shared/resolve-stage-competitors.js", () => ({
  resolveStageCompetitors: jest.fn(),
}));

jest.mock("../../../src/commands/shared/session-id.js", () => ({
  generateSessionId: jest.fn(),
}));

const executeCompetitionWithAdapterMock = jest.mocked(
  executeCompetitionWithAdapter,
);
const loadEnvironmentConfigMock = jest.mocked(loadEnvironmentConfig);
const resolveStageCompetitorsMock = jest.mocked(resolveStageCompetitors);
const generateSessionIdMock = jest.mocked(generateSessionId);

describe("executeSpecCommand integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadEnvironmentConfigMock.mockReturnValue({});
    resolveStageCompetitorsMock.mockReturnValue({
      source: "cli",
      agentIds: ["alpha"],
      competitors: [
        {
          id: "alpha",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
      ],
    });
  });

  it("passes staged extra-context references into the spec adapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-spec-extra-context-"));
    try {
      await createWorkspace(root);

      const draftPath = join(root, "draft.md");
      await writeFile(draftPath, "# Draft Title\n\nDetails.\n", "utf8");

      generateSessionIdMock.mockReturnValue("spec-123");

      const createAdapterSpy = jest.spyOn(
        specAdapter,
        "createSpecCompetitionAdapter",
      );

      executeCompetitionWithAdapterMock.mockResolvedValue([
        {
          agentId: "alpha",
          specPath: "draft.md",
          status: "generated",
        },
      ]);

      const extraContextFiles = [
        {
          absolutePath: "/repo/notes/a.md",
          displayPath: "notes/a.md",
          stagedRelativePath: "../context/a.md",
        },
      ];

      const result = await executeSpecCommand({
        root,
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        description: "Generate spec",
        extraContextFiles,
      });

      expect(createAdapterSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          extraContextFiles,
        }),
      );
      expect(result.sessionId).toBe("spec-123");
      await expect(
        readSpecRecords({
          root,
          specsFilePath: join(root, ".voratiq", "specs", "index.json"),
          predicate: (record) => record.sessionId === "spec-123",
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          sessionId: "spec-123",
          extraContext: ["../context/a.md"],
          extraContextMetadata: [
            {
              stagedPath: "../context/a.md",
              sourcePath: "notes/a.md",
            },
          ],
        }),
      ]);

      createAdapterSpy.mockRestore();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
