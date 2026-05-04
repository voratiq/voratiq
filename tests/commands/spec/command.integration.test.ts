import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { verifyAgentProviders } from "../../../src/agents/runtime/auth.js";
import { queueAppWorkflowSessionUpload } from "../../../src/app-session/workflow-upload.js";
import { resolveStageCompetitors } from "../../../src/commands/shared/resolve-stage-competitors.js";
import { generateSessionId } from "../../../src/commands/shared/session-id.js";
import { executeSpecCommand } from "../../../src/commands/spec/command.js";
import { SpecPreflightError } from "../../../src/commands/spec/errors.js";
import { executeCompetitionWithAdapter } from "../../../src/competition/command-adapter.js";
import { loadAgentCatalogDiagnostics } from "../../../src/configs/agents/loader.js";
import { loadEnvironmentConfig } from "../../../src/configs/environment/loader.js";
import { loadRepoSettings } from "../../../src/configs/settings/loader.js";
import { subscribePersistedWorkflowRecordEvents } from "../../../src/domain/shared/workflow-record-events.js";
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

jest.mock("../../../src/app-session/workflow-upload.js", () => ({
  queueAppWorkflowSessionUpload: jest.fn(),
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
const queueAppWorkflowSessionUploadMock = jest.mocked(
  queueAppWorkflowSessionUpload,
);

let unsubscribeWorkflowUploadEvents: (() => void) | undefined;

describe("executeSpecCommand integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    unsubscribeWorkflowUploadEvents?.();
    unsubscribeWorkflowUploadEvents = subscribePersistedWorkflowRecordEvents(
      (event) => {
        queueAppWorkflowSessionUploadMock(event);
      },
    );
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
    queueAppWorkflowSessionUploadMock.mockImplementation(() => {});
  });

  afterEach(() => {
    unsubscribeWorkflowUploadEvents?.();
    unsubscribeWorkflowUploadEvents = undefined;
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

  it("attempts hosted upload only after the spec record is persisted", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-spec-upload-"));
    try {
      await createWorkspace(root);

      const draftPath = join(root, "draft.md");
      await writeFile(draftPath, "# Draft Title\n\nDetails.\n", "utf8");

      generateSessionIdMock.mockReturnValue("spec-upload");
      executeCompetitionWithAdapterMock.mockResolvedValue([
        {
          agentId: "alpha",
          outputPath: "draft.md",
          dataPath: "draft.json",
          status: "succeeded",
          tokenUsageResult: { status: "unavailable" },
        },
      ]);

      let recordPersistedAtUploadAttempt = false;
      queueAppWorkflowSessionUploadMock.mockImplementation((input) => {
        if (input.operator !== "spec") {
          return;
        }
        const recordPath = join(
          root,
          ".voratiq",
          "specs",
          "sessions",
          input.record.sessionId,
          "record.json",
        );
        recordPersistedAtUploadAttempt = existsSync(recordPath);
      });

      await executeSpecCommand({
        root,
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        description: "Generate spec",
      });

      expect(queueAppWorkflowSessionUploadMock).toHaveBeenCalled();
      expect(recordPersistedAtUploadAttempt).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the local spec command successful when the hosted upload hook fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-spec-upload-fail-"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await createWorkspace(root);

      const draftPath = join(root, "draft.md");
      await writeFile(draftPath, "# Draft Title\n\nDetails.\n", "utf8");

      generateSessionIdMock.mockReturnValue("spec-upload-fail");
      executeCompetitionWithAdapterMock.mockResolvedValue([
        {
          agentId: "alpha",
          outputPath: "draft.md",
          dataPath: "draft.json",
          status: "succeeded",
          tokenUsageResult: { status: "unavailable" },
        },
      ]);
      queueAppWorkflowSessionUploadMock.mockImplementation(() => {
        throw new Error("upload hook exploded");
      });

      const result = await executeSpecCommand({
        root,
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        description: "Generate spec",
      });

      expect(result.sessionId).toBe("spec-upload-fail");
      await expect(
        readSpecRecords({
          root,
          specsFilePath: join(root, ".voratiq", "specs", "index.json"),
          predicate: (record) => record.sessionId === "spec-upload-fail",
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          sessionId: "spec-upload-fail",
          status: "succeeded",
        }),
      ]);
      expect(warnSpy).toHaveBeenCalledWith(
        "[voratiq] Failed post-persist hook for session spec-upload-fail: upload hook exploded",
      );
    } finally {
      warnSpy.mockRestore();
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
        detailLines: ["- Invalid `settings.yaml`."],
        hintLines: ["Review `settings.yaml` and correct invalid values."],
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
        detailLines: ["- `alpha`: missing binary path"],
      });
      expect(executeCompetitionWithAdapterMock).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
