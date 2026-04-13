import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { verifyAgentProviders } from "../../../src/agents/runtime/auth.js";
import { resolveStageCompetitors } from "../../../src/commands/shared/resolve-stage-competitors.js";
import { executeVerifyCommand } from "../../../src/commands/verify/command.js";
import { VerifyPreflightError } from "../../../src/commands/verify/errors.js";
import { resolveVerifyTarget } from "../../../src/commands/verify/targets.js";
import { loadAgentCatalogDiagnostics } from "../../../src/configs/agents/loader.js";
import { loadEnvironmentConfig } from "../../../src/configs/environment/loader.js";
import { loadRepoSettings } from "../../../src/configs/settings/loader.js";
import { loadVerificationConfig } from "../../../src/configs/verification/loader.js";
import { appendVerificationRecord } from "../../../src/domain/verify/persistence/adapter.js";

jest.mock("../../../src/agents/runtime/auth.js", () => ({
  verifyAgentProviders: jest.fn(),
}));

jest.mock("../../../src/commands/shared/resolve-stage-competitors.js", () => ({
  resolveStageCompetitors: jest.fn(),
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

jest.mock("../../../src/configs/environment/loader.js", () => ({
  loadEnvironmentConfig: jest.fn(),
}));

jest.mock("../../../src/configs/settings/loader.js", () => ({
  loadRepoSettings: jest.fn(),
}));

jest.mock("../../../src/configs/verification/loader.js", () => ({
  loadVerificationConfig: jest.fn(),
}));

jest.mock("../../../src/commands/verify/targets.js", () => ({
  resolveVerifyTarget: jest.fn(),
}));

jest.mock("../../../src/domain/verify/persistence/adapter.js", () => ({
  appendVerificationRecord: jest.fn(),
  flushVerificationRecordBuffer: jest.fn(),
}));

const verifyAgentProvidersMock = jest.mocked(verifyAgentProviders);
const resolveStageCompetitorsMock = jest.mocked(resolveStageCompetitors);
const loadAgentCatalogDiagnosticsMock = jest.mocked(
  loadAgentCatalogDiagnostics,
);
const loadEnvironmentConfigMock = jest.mocked(loadEnvironmentConfig);
const loadRepoSettingsMock = jest.mocked(loadRepoSettings);
const loadVerificationConfigMock = jest.mocked(loadVerificationConfig);
const appendVerificationRecordMock = jest.mocked(appendVerificationRecord);
const resolveVerifyTargetMock = jest.mocked(resolveVerifyTarget);

describe("executeVerifyCommand preflight", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveVerifyTargetMock.mockResolvedValue({
      baseRevisionSha: "base-sha",
      competitiveCandidates: [],
      target: {
        kind: "run",
        sessionId: "run-123",
        candidateIds: ["candidate-a"],
      },
      runRecord: {
        runId: "run-123",
        status: "succeeded",
        baseRevisionSha: "base-sha",
        agents: [],
      },
    } as never);
    loadVerificationConfigMock.mockReturnValue({ selectors: {} } as never);
    resolveStageCompetitorsMock.mockReturnValue({
      source: "orchestration",
      agentIds: ["verifier-a"],
      competitors: [],
    });
    loadAgentCatalogDiagnosticsMock.mockReturnValue({
      enabledAgents: [
        {
          id: "verifier-a",
          provider: "codex",
          model: "gpt-5",
          enabled: true,
          binary: "node",
        },
      ],
      catalog: [
        {
          id: "verifier-a",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
      ],
      issues: [],
    });
    verifyAgentProvidersMock.mockResolvedValue([]);
    loadRepoSettingsMock.mockReturnValue({
      bounded: { codex: { globalConfigPolicy: "ignore" } },
      mcp: { codex: "ask", claude: "ask", gemini: "ask" },
    });
    loadEnvironmentConfigMock.mockReturnValue({});
    appendVerificationRecordMock.mockResolvedValue(undefined);
  });

  it("surfaces settings failures as verify preflight errors", async () => {
    loadRepoSettingsMock.mockImplementation(() => {
      throw new Error("Invalid settings file at /repo/.voratiq/settings.yaml");
    });

    await expect(
      executeVerifyCommand({
        root: "/repo",
        specsFilePath: "/repo/.voratiq/spec/index.json",
        runsFilePath: "/repo/.voratiq/run/index.json",
        reductionsFilePath: "/repo/.voratiq/reduce/index.json",
        messagesFilePath: "/repo/.voratiq/message/index.json",
        verificationsFilePath: "/repo/.voratiq/verify/index.json",
        target: { kind: "run", sessionId: "run-123" },
      }),
    ).rejects.toBeInstanceOf(VerifyPreflightError);

    await expect(
      executeVerifyCommand({
        root: "/repo",
        specsFilePath: "/repo/.voratiq/spec/index.json",
        runsFilePath: "/repo/.voratiq/run/index.json",
        reductionsFilePath: "/repo/.voratiq/reduce/index.json",
        messagesFilePath: "/repo/.voratiq/message/index.json",
        verificationsFilePath: "/repo/.voratiq/verify/index.json",
        target: { kind: "run", sessionId: "run-123" },
      }),
    ).rejects.toMatchObject({
      headline: "Preflight failed. Aborting verification.",
      detailLines: ["- Invalid settings file at /repo/.voratiq/settings.yaml"],
      hintLines: [
        "Review `.voratiq/settings.yaml` and correct invalid values.",
      ],
    });
    expect(appendVerificationRecordMock).not.toHaveBeenCalled();
  });

  it("preserves agent ids in provider preflight failures", async () => {
    verifyAgentProvidersMock.mockResolvedValue([
      {
        agentId: "verifier-a",
        message: "token expired",
      },
    ]);

    await expect(
      executeVerifyCommand({
        root: "/repo",
        specsFilePath: "/repo/.voratiq/spec/index.json",
        runsFilePath: "/repo/.voratiq/run/index.json",
        reductionsFilePath: "/repo/.voratiq/reduce/index.json",
        messagesFilePath: "/repo/.voratiq/message/index.json",
        verificationsFilePath: "/repo/.voratiq/verify/index.json",
        target: { kind: "run", sessionId: "run-123" },
      }),
    ).rejects.toMatchObject({
      detailLines: ["- verifier-a: token expired"],
      hintLines: [],
    });
  });
});
