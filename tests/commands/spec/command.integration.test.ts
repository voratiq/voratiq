import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { verifyAgentProviders } from "../../../src/agents/runtime/auth.js";
import { resolveStageCompetitors } from "../../../src/commands/shared/resolve-stage-competitors.js";
import { generateSessionId } from "../../../src/commands/shared/session-id.js";
import { executeSpecCommand } from "../../../src/commands/spec/command.js";
import { SpecPreflightError } from "../../../src/commands/spec/errors.js";
import { executeCompetitionWithAdapter } from "../../../src/competition/command-adapter.js";
import { loadAgentCatalogDiagnostics } from "../../../src/configs/agents/loader.js";
import { loadEnvironmentConfig } from "../../../src/configs/environment/loader.js";
import { loadRepoSettings } from "../../../src/configs/settings/loader.js";
import * as specAdapter from "../../../src/domain/spec/competition/adapter.js";
import { readSpecRecords } from "../../../src/domain/spec/persistence/adapter.js";
import { getHeadRevision } from "../../../src/utils/git.js";
import { createWorkspace } from "../../../src/workspace/setup.js";

jest.mock("../../../src/competition/command-adapter.js", () => ({
  executeCompetitionWithAdapter: jest.fn(),
}));

jest.mock("../../../src/agents/runtime/auth.js", () => ({
  verifyAgentProviders: jest.fn(),
}));

jest.mock("../../../src/configs/environment/loader.js", () => ({
  loadEnvironmentConfig: jest.fn(),
}));

jest.mock("../../../src/configs/agents/loader.js", () => {
  const actual = jest.requireActual<
    typeof import("../../../src/configs/agents/loader.js")
  >("../../../src/configs/agents/loader.js");
  return {
    ...actual,
    loadAgentCatalogDiagnostics: jest.fn(),
  };
});

jest.mock("../../../src/configs/settings/loader.js", () => ({
  loadRepoSettings: jest.fn(),
}));

jest.mock("../../../src/commands/shared/resolve-stage-competitors.js", () => ({
  resolveStageCompetitors: jest.fn(),
}));

jest.mock("../../../src/commands/shared/session-id.js", () => ({
  generateSessionId: jest.fn(),
}));

jest.mock("../../../src/utils/git.js", () => ({
  getHeadRevision: jest.fn(),
}));

const executeCompetitionWithAdapterMock = jest.mocked(
  executeCompetitionWithAdapter,
);
const verifyAgentProvidersMock = jest.mocked(verifyAgentProviders);
const loadAgentCatalogDiagnosticsMock = jest.mocked(
  loadAgentCatalogDiagnostics,
);
const loadEnvironmentConfigMock = jest.mocked(loadEnvironmentConfig);
const loadRepoSettingsMock = jest.mocked(loadRepoSettings);
const resolveStageCompetitorsMock = jest.mocked(resolveStageCompetitors);
const generateSessionIdMock = jest.mocked(generateSessionId);
const getHeadRevisionMock = jest.mocked(getHeadRevision);

describe("executeSpecCommand integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verifyAgentProvidersMock.mockResolvedValue([]);
    loadEnvironmentConfigMock.mockReturnValue({});
    loadRepoSettingsMock.mockReturnValue({
      bounded: { codex: { globalConfigPolicy: "ignore" } },
      mcp: { codex: "ask", claude: "ask", gemini: "ask" },
    });
    getHeadRevisionMock.mockResolvedValue("spec-base-sha");
    resolveStageCompetitorsMock.mockReturnValue({
      source: "cli",
      agentIds: ["alpha"],
      competitors: [],
    });
    loadAgentCatalogDiagnosticsMock.mockReturnValue({
      enabledAgents: [
        {
          id: "alpha",
          provider: "codex",
          model: "gpt-5",
          enabled: true,
          binary: "node",
        },
      ],
      catalog: [
        {
          id: "alpha",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
      ],
      issues: [],
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
          outputPath: "draft.md",
          dataPath: "draft.json",
          status: "succeeded",
          tokenUsageResult: { status: "unavailable" },
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
          baseRevisionSha: "spec-base-sha",
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

  it("persists provider-native token usage from generation results", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-spec-usage-record-"));
    try {
      await createWorkspace(root);

      const draftPath = join(root, "draft.md");
      await writeFile(draftPath, "# Draft Title\n\nDetails.\n", "utf8");

      generateSessionIdMock.mockReturnValue("spec-usage");
      executeCompetitionWithAdapterMock.mockResolvedValue([
        {
          agentId: "alpha",
          outputPath: "draft.md",
          dataPath: "draft.json",
          status: "succeeded",
          tokenUsage: {
            input_tokens: 210,
            output_tokens: 65,
            cache_read_input_tokens: 41,
            cache_creation_input_tokens: 11,
          },
          tokenUsageResult: { status: "unavailable" },
        },
      ]);

      await executeSpecCommand({
        root,
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        description: "Generate spec",
      });

      const records = await readSpecRecords({
        root,
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        predicate: (record) => record.sessionId === "spec-usage",
      });

      expect(records).toHaveLength(1);
      expect(records[0]?.sessionId).toBe("spec-usage");
      expect(records[0]?.baseRevisionSha).toBe("spec-base-sha");
      expect(records[0]?.agents[0]?.tokenUsage).toEqual({
        input_tokens: 210,
        output_tokens: 65,
        cache_read_input_tokens: 41,
        cache_creation_input_tokens: 11,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces shared preflight failures before generation starts", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-spec-preflight-"));
    try {
      await createWorkspace(root);
      loadRepoSettingsMock.mockImplementation(() => {
        throw new Error(
          "Invalid settings file at /repo/.voratiq/settings.yaml",
        );
      });

      await expect(
        executeSpecCommand({
          root,
          specsFilePath: join(root, ".voratiq", "specs", "index.json"),
          description: "Generate spec",
        }),
      ).rejects.toBeInstanceOf(SpecPreflightError);

      await expect(
        executeSpecCommand({
          root,
          specsFilePath: join(root, ".voratiq", "specs", "index.json"),
          description: "Generate spec",
        }),
      ).rejects.toMatchObject({
        headline: "Preflight failed. Aborting specification generation.",
        detailLines: [
          "- Invalid settings file at /repo/.voratiq/settings.yaml",
        ],
        hintLines: [
          "Review `.voratiq/settings.yaml` and correct invalid values.",
        ],
      });
      expect(executeCompetitionWithAdapterMock).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces selected agent catalog issues through shared preflight", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-spec-agent-preflight-"));
    try {
      await createWorkspace(root);
      loadAgentCatalogDiagnosticsMock.mockReturnValue({
        enabledAgents: [
          {
            id: "alpha",
            provider: "codex",
            model: "gpt-5",
            enabled: true,
            binary: "",
          },
        ],
        catalog: [],
        issues: [
          {
            agentId: "alpha",
            message: "missing binary path",
          },
        ],
      });

      await expect(
        executeSpecCommand({
          root,
          specsFilePath: join(root, ".voratiq", "specs", "index.json"),
          description: "Generate spec",
        }),
      ).rejects.toMatchObject({
        headline: "Preflight failed. Aborting specification generation.",
        detailLines: ["- alpha: missing binary path"],
      });
      expect(executeCompetitionWithAdapterMock).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
