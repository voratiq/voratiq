import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { verifyAgentProviders } from "../../../src/agents/runtime/auth.js";
import { executeMessageCommand } from "../../../src/commands/message/command.js";
import {
  MessageInvocationContextError,
  MessagePreflightError,
} from "../../../src/commands/message/errors.js";
import {
  finalizeActiveMessage,
  registerActiveMessage,
} from "../../../src/commands/message/lifecycle.js";
import { resolveEffectiveMaxParallel } from "../../../src/commands/shared/max-parallel.js";
import { resolveStageCompetitors } from "../../../src/commands/shared/resolve-stage-competitors.js";
import { generateSessionId } from "../../../src/commands/shared/session-id.js";
import { executeCompetitionWithAdapter } from "../../../src/competition/command-adapter.js";
import { loadAgentCatalogDiagnostics } from "../../../src/configs/agents/loader.js";
import { loadEnvironmentConfig } from "../../../src/configs/environment/loader.js";
import { loadRepoSettings } from "../../../src/configs/settings/loader.js";
import { createMessageCompetitionAdapter } from "../../../src/domain/message/competition/adapter.js";
import type { MessageRecordMutators } from "../../../src/domain/message/model/mutators.js";
import { createMessageRecordMutators } from "../../../src/domain/message/model/mutators.js";
import type { MessageRecord } from "../../../src/domain/message/model/types.js";
import {
  appendMessageRecord,
  flushMessageRecordBuffer,
} from "../../../src/domain/message/persistence/adapter.js";
import { getHeadRevision } from "../../../src/utils/git.js";

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

jest.mock("../../../src/commands/shared/max-parallel.js", () => ({
  resolveEffectiveMaxParallel: jest.fn(),
}));

jest.mock("../../../src/domain/message/competition/adapter.js", () => ({
  createMessageCompetitionAdapter: jest.fn(),
}));

jest.mock("../../../src/competition/command-adapter.js", () => ({
  executeCompetitionWithAdapter: jest.fn(),
}));

jest.mock("../../../src/domain/message/model/mutators.js", () => ({
  createMessageRecordMutators: jest.fn(),
}));

jest.mock("../../../src/domain/message/persistence/adapter.js", () => ({
  appendMessageRecord: jest.fn(),
  flushMessageRecordBuffer: jest.fn(),
}));

jest.mock("../../../src/commands/message/lifecycle.js", () => ({
  registerActiveMessage: jest.fn(),
  finalizeActiveMessage: jest.fn(),
}));

jest.mock("../../../src/utils/git.js", () => ({
  getHeadRevision: jest.fn(),
}));

const verifyAgentProvidersMock = jest.mocked(verifyAgentProviders);
const loadAgentCatalogDiagnosticsMock = jest.mocked(
  loadAgentCatalogDiagnostics,
);
const loadEnvironmentConfigMock = jest.mocked(loadEnvironmentConfig);
const loadRepoSettingsMock = jest.mocked(loadRepoSettings);
const resolveStageCompetitorsMock = jest.mocked(resolveStageCompetitors);
const generateSessionIdMock = jest.mocked(generateSessionId);
const resolveEffectiveMaxParallelMock = jest.mocked(
  resolveEffectiveMaxParallel,
);
const createMessageCompetitionAdapterMock = jest.mocked(
  createMessageCompetitionAdapter,
);
const executeCompetitionWithAdapterMock = jest.mocked(
  executeCompetitionWithAdapter,
);
const createMessageRecordMutatorsMock = jest.mocked(
  createMessageRecordMutators,
);
const appendMessageRecordMock = jest.mocked(appendMessageRecord);
const flushMessageRecordBufferMock = jest.mocked(flushMessageRecordBuffer);
const registerActiveMessageMock = jest.mocked(registerActiveMessage);
const finalizeActiveMessageMock = jest.mocked(finalizeActiveMessage);
const getHeadRevisionMock = jest.mocked(getHeadRevision);

describe("executeMessageCommand integration", () => {
  let cwdSpy: jest.SpiedFunction<typeof process.cwd>;

  beforeEach(() => {
    jest.clearAllMocks();
    cwdSpy = jest.spyOn(process, "cwd").mockReturnValue("/repo");

    resolveStageCompetitorsMock.mockReturnValue({
      source: "orchestration",
      agentIds: ["alpha"],
      competitors: [],
    });
    loadAgentCatalogDiagnosticsMock.mockReturnValue({
      enabledAgents: [
        {
          id: "alpha",
          provider: "claude",
          model: "claude-3",
          enabled: true,
          binary: "node",
        },
      ],
      catalog: [
        {
          id: "alpha",
          provider: "claude",
          model: "claude-3",
          binary: "node",
          argv: ["index.mjs"],
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
    getHeadRevisionMock.mockResolvedValue("message-base-sha");
    generateSessionIdMock.mockReturnValue("message-xyz");
    resolveEffectiveMaxParallelMock.mockReturnValue(1);
    appendMessageRecordMock.mockResolvedValue(undefined);
    flushMessageRecordBufferMock.mockResolvedValue(undefined);
    createMessageCompetitionAdapterMock.mockReturnValue({} as never);
    executeCompetitionWithAdapterMock.mockResolvedValue([
      {
        agentId: "alpha",
        status: "succeeded",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:05.000Z",
        outputPath:
          ".voratiq/message/sessions/message-xyz/alpha/artifacts/response.md",
        stdoutPath:
          ".voratiq/message/sessions/message-xyz/alpha/artifacts/stdout.log",
        stderrPath:
          ".voratiq/message/sessions/message-xyz/alpha/artifacts/stderr.log",
        tokenUsageResult: {
          status: "unavailable",
          reason: "chat_not_captured",
          provider: "claude",
          modelId: "claude-3",
        },
      },
    ] as never);
    finalizeActiveMessageMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
  });

  it("registers and finalizes the active message lifecycle around execution", async () => {
    const completedRecord: MessageRecord = {
      sessionId: "message-xyz",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:05.000Z",
      status: "succeeded",
      baseRevisionSha: "message-base-sha",
      prompt: "Review this change.",
      recipients: [
        {
          agentId: "alpha",
          status: "succeeded",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:05.000Z",
          outputPath:
            ".voratiq/message/sessions/message-xyz/alpha/artifacts/response.md",
          error: null,
        },
      ],
      error: null,
    };

    const mutators: MessageRecordMutators = {
      recordRecipientQueued: jest.fn(() => Promise.resolve()),
      recordRecipientRunning: jest.fn(() => Promise.resolve()),
      recordRecipientSnapshot: jest.fn(() => Promise.resolve()),
      completeMessage: jest.fn(() => Promise.resolve(completedRecord)),
      readRecord: jest.fn(() => Promise.resolve(completedRecord)),
    };
    createMessageRecordMutatorsMock.mockReturnValue(mutators);

    const result = await executeMessageCommand({
      root: "/repo",
      messagesFilePath: "/repo/.voratiq/message/index.json",
      prompt: "Review this change.",
    });

    expect(registerActiveMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        root: "/repo",
        messagesFilePath: "/repo/.voratiq/message/index.json",
        messageId: "message-xyz",
        teardown: expect.any(Object),
      }),
    );
    const teardown = registerActiveMessageMock.mock.calls[0]?.[0]?.teardown;
    expect(createMessageCompetitionAdapterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        root: "/repo",
        messageId: "message-xyz",
        teardown,
      }),
    );
    expect(finalizeActiveMessageMock).toHaveBeenCalledWith("message-xyz");
    expect(result.messageId).toBe("message-xyz");
    expect(result.record.status).toBe("succeeded");
    expect(appendMessageRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({
          baseRevisionSha: "message-base-sha",
          prompt: "Review this change.",
        }),
      }),
    );
  });

  it("surfaces shared preflight failures before message execution starts", async () => {
    loadRepoSettingsMock.mockImplementation(() => {
      throw new Error("Invalid settings file at /repo/.voratiq/settings.yaml");
    });

    await expect(
      executeMessageCommand({
        root: "/repo",
        messagesFilePath: "/repo/.voratiq/message/index.json",
        prompt: "Review this change.",
      }),
    ).rejects.toBeInstanceOf(MessagePreflightError);

    await expect(
      executeMessageCommand({
        root: "/repo",
        messagesFilePath: "/repo/.voratiq/message/index.json",
        prompt: "Review this change.",
      }),
    ).rejects.toMatchObject({
      headline: "Preflight failed. Aborting message.",
      detailLines: ["- Invalid settings file at /repo/.voratiq/settings.yaml"],
      hintLines: [
        "Review `.voratiq/settings.yaml` and correct invalid values.",
      ],
    });
    expect(executeCompetitionWithAdapterMock).not.toHaveBeenCalled();
  });

  it("persists an interactive target from sourceInteractiveSessionId", async () => {
    const completedRecord: MessageRecord = {
      sessionId: "message-xyz",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:05.000Z",
      status: "succeeded",
      baseRevisionSha: "message-base-sha",
      prompt: "Review this change.",
      target: {
        kind: "interactive",
        sessionId: "interactive-123",
      },
      sourceInteractiveSessionId: "interactive-123",
      recipients: [
        {
          agentId: "alpha",
          status: "succeeded",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:05.000Z",
          outputPath:
            ".voratiq/message/sessions/message-xyz/alpha/artifacts/response.md",
          error: null,
        },
      ],
      error: null,
    };

    const mutators: MessageRecordMutators = {
      recordRecipientQueued: jest.fn(() => Promise.resolve()),
      recordRecipientRunning: jest.fn(() => Promise.resolve()),
      recordRecipientSnapshot: jest.fn(() => Promise.resolve()),
      completeMessage: jest.fn(() => Promise.resolve(completedRecord)),
      readRecord: jest.fn(() => Promise.resolve(completedRecord)),
    };
    createMessageRecordMutatorsMock.mockReturnValue(mutators);

    await executeMessageCommand({
      root: "/repo",
      messagesFilePath: "/repo/.voratiq/message/index.json",
      prompt: "Review this change.",
      sourceInteractiveSessionId: "interactive-123",
    });

    expect(appendMessageRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({
          sourceInteractiveSessionId: "interactive-123",
          target: {
            kind: "interactive",
            sessionId: "interactive-123",
          },
        }),
      }),
    );
  });

  it("persists explicit non-interactive targets when provided", async () => {
    const completedRecord: MessageRecord = {
      sessionId: "message-xyz",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:05.000Z",
      status: "succeeded",
      baseRevisionSha: "message-base-sha",
      prompt: "Review this change.",
      target: {
        kind: "run",
        sessionId: "run-123",
      },
      sourceInteractiveSessionId: "interactive-123",
      recipients: [
        {
          agentId: "alpha",
          status: "succeeded",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:05.000Z",
          outputPath:
            ".voratiq/message/sessions/message-xyz/alpha/artifacts/response.md",
          error: null,
        },
      ],
      error: null,
    };

    const mutators: MessageRecordMutators = {
      recordRecipientQueued: jest.fn(() => Promise.resolve()),
      recordRecipientRunning: jest.fn(() => Promise.resolve()),
      recordRecipientSnapshot: jest.fn(() => Promise.resolve()),
      completeMessage: jest.fn(() => Promise.resolve(completedRecord)),
      readRecord: jest.fn(() => Promise.resolve(completedRecord)),
    };
    createMessageRecordMutatorsMock.mockReturnValue(mutators);

    await executeMessageCommand({
      root: "/repo",
      messagesFilePath: "/repo/.voratiq/message/index.json",
      prompt: "Review this change.",
      sourceInteractiveSessionId: "interactive-123",
      target: {
        kind: "run",
        sessionId: "run-123",
      },
    });

    expect(appendMessageRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({
          sourceInteractiveSessionId: "interactive-123",
          target: {
            kind: "run",
            sessionId: "run-123",
          },
        }),
      }),
    );
  });

  it("persists lane-level targets when an upstream agent lane is provided", async () => {
    const completedRecord: MessageRecord = {
      sessionId: "message-xyz",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:05.000Z",
      status: "succeeded",
      baseRevisionSha: "message-base-sha",
      prompt: "Review this change.",
      target: {
        kind: "run",
        sessionId: "run-123",
        agentId: "gpt-5-4-high",
      },
      recipients: [
        {
          agentId: "alpha",
          status: "succeeded",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:05.000Z",
          outputPath:
            ".voratiq/message/sessions/message-xyz/alpha/artifacts/response.md",
          error: null,
        },
      ],
      error: null,
    };

    const mutators: MessageRecordMutators = {
      recordRecipientQueued: jest.fn(() => Promise.resolve()),
      recordRecipientRunning: jest.fn(() => Promise.resolve()),
      recordRecipientSnapshot: jest.fn(() => Promise.resolve()),
      completeMessage: jest.fn(() => Promise.resolve(completedRecord)),
      readRecord: jest.fn(() => Promise.resolve(completedRecord)),
    };
    createMessageRecordMutatorsMock.mockReturnValue(mutators);

    await executeMessageCommand({
      root: "/repo",
      messagesFilePath: "/repo/.voratiq/message/index.json",
      prompt: "Review this change.",
      target: {
        kind: "run",
        sessionId: "run-123",
        agentId: "gpt-5-4-high",
      },
    });

    expect(appendMessageRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({
          target: {
            kind: "run",
            sessionId: "run-123",
            agentId: "gpt-5-4-high",
          },
        }),
      }),
    );
  });

  it.each([
    "/repo/.voratiq/spec/sessions/spec-123/agent-a/workspace",
    "/repo/.voratiq/run/sessions/run-123/agent-a/workspace",
    "/repo/.voratiq/reduce/sessions/reduce-123/agent-a/workspace",
    "/repo/.voratiq/verify/sessions/verify-123/agent-a/workspace",
    "/repo/.voratiq/message/sessions/message-123/agent-a/workspace",
  ])(
    "rejects execution from inside a batch agent workspace: %s",
    async (cwd) => {
      cwdSpy.mockReturnValue(cwd);

      try {
        await expect(
          executeMessageCommand({
            root: "/repo",
            messagesFilePath: "/repo/.voratiq/message/index.json",
            prompt: "Review this change.",
          }),
        ).rejects.toBeInstanceOf(MessageInvocationContextError);
      } finally {
        cwdSpy.mockReturnValue("/repo");
      }

      expect(resolveStageCompetitorsMock).not.toHaveBeenCalled();
    },
  );
});
