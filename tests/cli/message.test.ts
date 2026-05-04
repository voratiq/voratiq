import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { checkPlatformSupport } from "../../src/agents/runtime/sandbox.js";
import { runMessageCommand } from "../../src/cli/message.js";
import { promptForRepositoryLinkIfNeeded } from "../../src/cli/repository-link.js";
import { executeMessageCommand } from "../../src/commands/message/command.js";
import { resolveExtraContextFiles } from "../../src/competition/shared/extra-context.js";
import { resolveInteractiveSessionEnvLineage } from "../../src/domain/interactive/session-env.js";
import {
  ensureSandboxDependencies,
  resolveCliContext,
} from "../../src/preflight/index.js";

jest.mock("../../src/agents/runtime/sandbox.js", () => ({
  checkPlatformSupport: jest.fn(),
}));

jest.mock("../../src/commands/message/command.js", () => ({
  executeMessageCommand: jest.fn(),
}));

jest.mock("../../src/competition/shared/extra-context.js", () => ({
  resolveExtraContextFiles: jest.fn(),
}));

jest.mock("../../src/domain/interactive/session-env.js", () => ({
  resolveInteractiveSessionEnvLineage: jest.fn(),
}));

jest.mock("../../src/preflight/index.js", () => {
  const actual = jest.requireActual<
    typeof import("../../src/preflight/index.js")
  >("../../src/preflight/index.js");
  return {
    ...actual,
    resolveCliContext: jest.fn(),
    ensureSandboxDependencies: jest.fn(),
  };
});

jest.mock("../../src/cli/repository-link.js", () => ({
  promptForRepositoryLinkIfNeeded: jest.fn(),
}));

const checkPlatformSupportMock = jest.mocked(checkPlatformSupport);
const executeMessageCommandMock = jest.mocked(executeMessageCommand);
const resolveExtraContextFilesMock = jest.mocked(resolveExtraContextFiles);
const ensureSandboxDependenciesMock = jest.mocked(ensureSandboxDependencies);
const resolveCliContextMock = jest.mocked(resolveCliContext);
const promptForRepositoryLinkIfNeededMock = jest.mocked(
  promptForRepositoryLinkIfNeeded,
);
const resolveInteractiveSessionEnvLineageMock = jest.mocked(
  resolveInteractiveSessionEnvLineage,
);

describe("voratiq message", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    checkPlatformSupportMock.mockReturnValue(undefined);
    ensureSandboxDependenciesMock.mockReturnValue(undefined);
    promptForRepositoryLinkIfNeededMock.mockResolvedValue(undefined);
    resolveExtraContextFilesMock.mockResolvedValue([]);
    resolveInteractiveSessionEnvLineageMock.mockResolvedValue({
      kind: "ignore",
    });
    resolveCliContextMock.mockResolvedValue({
      root: "/repo",
      workspacePaths: {
        root: "/repo",
        workspaceDir: "/repo/.voratiq",
        runsDir: "/repo/.voratiq/run",
        runsFile: "/repo/.voratiq/run/index.json",
        specsDir: "/repo/.voratiq/spec",
        specsFile: "/repo/.voratiq/spec/index.json",
      },
    });
    executeMessageCommandMock.mockResolvedValue({
      messageId: "message-123",
      record: {
        sessionId: "message-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:03.000Z",
        status: "failed",
        baseRevisionSha: "message-base-sha",
        prompt: "Review this change.",
        recipients: [
          {
            agentId: "alpha",
            status: "failed",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:03.000Z",
            error: "boom",
          },
        ],
        error: "boom",
      },
      recipients: [
        {
          agentId: "alpha",
          status: "failed",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:03.000Z",
          outputPath:
            ".voratiq/message/sessions/message-123/alpha/artifacts/response.md",
          error: "boom",
        },
      ],
      executions: [],
    });
  });

  it("falls back to the canonical message index path when workspacePaths.messagesFile is absent", async () => {
    await runMessageCommand({
      prompt: "Review this change.",
      json: true,
    });

    expect(executeMessageCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        root: "/repo",
        messagesFilePath: "/repo/.voratiq/message/index.json",
      }),
    );
  });

  it("checks repository link prompting after resolving repo context", async () => {
    await runMessageCommand({
      prompt: "Review this change.",
    });

    expect(promptForRepositoryLinkIfNeededMock).toHaveBeenCalledWith({
      root: "/repo",
      json: false,
    });
  });

  it("passes json mode through to repository link prompting", async () => {
    await runMessageCommand({
      prompt: "Review this change.",
      json: true,
    });

    expect(promptForRepositoryLinkIfNeededMock).toHaveBeenCalledWith({
      root: "/repo",
      json: true,
    });
  });

  it("returns output artifacts for json envelope construction", async () => {
    const result = await runMessageCommand({
      prompt: "Review this change.",
      json: true,
    });

    expect(result.outputArtifacts).toEqual([
      {
        agentId: "alpha",
        outputPath:
          ".voratiq/message/sessions/message-123/alpha/artifacts/response.md",
      },
    ]);
  });

  it("forwards the trusted interactive session as target", async () => {
    resolveInteractiveSessionEnvLineageMock.mockResolvedValueOnce({
      kind: "trusted",
      sessionId: "interactive-live",
    });

    await runMessageCommand({
      prompt: "Review this change.",
      json: true,
    });

    expect(executeMessageCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target: {
          kind: "interactive",
          sessionId: "interactive-live",
        },
      }),
    );
  });

  it("passes the current interactive session env value into the lineage guard", async () => {
    const previousSessionId = process.env.VORATIQ_INTERACTIVE_SESSION_ID;
    process.env.VORATIQ_INTERACTIVE_SESSION_ID = "interactive-live";

    try {
      await runMessageCommand({
        prompt: "Review this change.",
        json: true,
      });
    } finally {
      process.env.VORATIQ_INTERACTIVE_SESSION_ID = previousSessionId;
    }

    expect(resolveInteractiveSessionEnvLineageMock).toHaveBeenCalledWith({
      root: "/repo",
      envValue: "interactive-live",
    });
  });

  it("omits target when the env lineage guard returns ignore", async () => {
    resolveInteractiveSessionEnvLineageMock.mockResolvedValueOnce({
      kind: "ignore",
    });

    await runMessageCommand({
      prompt: "Review this change.",
      json: true,
    });

    expect(executeMessageCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target: undefined,
      }),
    );
  });

  it("returns the detail-only transcript body for TTY output", async () => {
    const result = await runMessageCommand({
      prompt: "Review this change.",
      stdout: {
        isTTY: true,
        write: () => true,
      },
    });

    expect(result.body).toContain("Agent: alpha");
    expect(result.body).toContain("Output:");
    expect(result.body).not.toContain("AGENT");
  });
});
