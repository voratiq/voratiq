import { mkdir, mkdtemp, rm } from "node:fs/promises";
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

import {
  clearActiveMessage,
  finalizeActiveMessage,
  MESSAGE_ABORT_DETAIL,
  MESSAGE_FAILURE_DETAIL,
  registerActiveMessage,
  terminateActiveMessage,
} from "../../../src/commands/message/lifecycle.js";
import { createTeardownController } from "../../../src/competition/shared/teardown.js";
import type { MessageRecord } from "../../../src/domain/message/model/types.js";
import {
  flushMessageRecordBuffer,
  readMessageRecords,
  rewriteMessageRecord,
} from "../../../src/domain/message/persistence/adapter.js";
import { pathExists } from "../../../src/utils/fs.js";

jest.mock("../../../src/domain/message/persistence/adapter.js", () => ({
  readMessageRecords: jest.fn(),
  rewriteMessageRecord: jest.fn(),
  flushMessageRecordBuffer: jest.fn(),
}));

const readMessageRecordsMock = jest.mocked(readMessageRecords);
const rewriteMessageRecordMock = jest.mocked(rewriteMessageRecord);
const flushMessageRecordBufferMock = jest.mocked(flushMessageRecordBuffer);

describe("message lifecycle", () => {
  const MESSAGE_ID = "message-123";
  const tempRoots: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    flushMessageRecordBufferMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearActiveMessage(MESSAGE_ID);
    return Promise.all(
      tempRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    ).then(() => undefined);
  });

  it("marks queued and running recipients as aborted and flushes the record", async () => {
    const teardown = createTeardownController(`message \`${MESSAGE_ID}\``);
    const cleanup = jest.fn(() => Promise.resolve());
    teardown.addAction({
      key: `message-cleanup:${MESSAGE_ID}`,
      label: "message cleanup",
      cleanup,
    });

    registerActiveMessage({
      root: "/repo",
      messagesFilePath: "/repo/.voratiq/message/index.json",
      messageId: MESSAGE_ID,
      teardown,
    });

    const existingRecord: MessageRecord = {
      sessionId: MESSAGE_ID,
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:05.000Z",
      status: "running",
      prompt: "Review this change.",
      recipients: [
        {
          agentId: "agent-a",
          status: "queued",
        },
        {
          agentId: "agent-b",
          status: "running",
          startedAt: "2026-01-01T00:00:06.000Z",
        },
        {
          agentId: "agent-c",
          status: "succeeded",
          startedAt: "2026-01-01T00:00:06.000Z",
          completedAt: "2026-01-01T00:00:30.000Z",
          outputPath:
            ".voratiq/message/sessions/message-123/agent-c/artifacts/response.md",
        },
      ],
      error: null,
    };

    readMessageRecordsMock.mockResolvedValue([existingRecord]);

    let mutatedRecord: MessageRecord | undefined;
    rewriteMessageRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(existingRecord);
      return Promise.resolve(mutatedRecord);
    });

    await terminateActiveMessage("aborted");

    expect(readMessageRecordsMock).toHaveBeenCalledTimes(1);
    expect(rewriteMessageRecordMock).toHaveBeenCalledTimes(1);
    expect(flushMessageRecordBufferMock).toHaveBeenCalledWith({
      messagesFilePath: "/repo/.voratiq/message/index.json",
      sessionId: MESSAGE_ID,
    });
    expect(cleanup).toHaveBeenCalledTimes(1);

    expect(mutatedRecord?.status).toBe("aborted");
    expect(mutatedRecord?.error).toBe(MESSAGE_ABORT_DETAIL);
    expect(mutatedRecord?.completedAt).toEqual(expect.any(String));
    expect(mutatedRecord?.recipients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "agent-a",
          status: "aborted",
          error: MESSAGE_ABORT_DETAIL,
          completedAt: expect.any(String),
        }),
        expect.objectContaining({
          agentId: "agent-b",
          status: "aborted",
          error: MESSAGE_ABORT_DETAIL,
          completedAt: expect.any(String),
        }),
        expect.objectContaining({
          agentId: "agent-c",
          status: "succeeded",
        }),
      ]),
    );
  });

  it("marks queued and running recipients as failed when teardown follows an error", async () => {
    registerActiveMessage({
      root: "/repo",
      messagesFilePath: "/repo/.voratiq/message/index.json",
      messageId: MESSAGE_ID,
    });

    const existingRecord: MessageRecord = {
      sessionId: MESSAGE_ID,
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:05.000Z",
      status: "running",
      prompt: "Review this change.",
      recipients: [
        {
          agentId: "agent-a",
          status: "running",
          startedAt: "2026-01-01T00:00:06.000Z",
        },
      ],
      error: null,
    };

    readMessageRecordsMock.mockResolvedValue([existingRecord]);

    let mutatedRecord: MessageRecord | undefined;
    rewriteMessageRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(existingRecord);
      return Promise.resolve(mutatedRecord);
    });

    await terminateActiveMessage("failed");

    expect(mutatedRecord?.status).toBe("failed");
    expect(mutatedRecord?.error).toBe(MESSAGE_FAILURE_DETAIL);
    expect(mutatedRecord?.recipients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "agent-a",
          status: "failed",
          error: MESSAGE_FAILURE_DETAIL,
        }),
      ]),
    );
  });

  it("is a no-op when no active message is registered", async () => {
    await terminateActiveMessage("failed");

    expect(readMessageRecordsMock).not.toHaveBeenCalled();
    expect(rewriteMessageRecordMock).not.toHaveBeenCalled();
    expect(flushMessageRecordBufferMock).not.toHaveBeenCalled();
  });

  it("prunes message scratch state while retaining artifacts on finalization", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-message-finalize-"));
    tempRoots.push(root);

    const agentRoot = join(
      root,
      ".voratiq",
      "message",
      "sessions",
      MESSAGE_ID,
      "agent-a",
    );
    const workspacePath = join(agentRoot, "workspace");
    const artifactsPath = join(agentRoot, "artifacts");
    const contextPath = join(agentRoot, "context");
    const runtimePath = join(agentRoot, "runtime");
    const sandboxPath = join(agentRoot, "sandbox");

    await mkdir(workspacePath, { recursive: true });
    await mkdir(artifactsPath, { recursive: true });
    await mkdir(contextPath, { recursive: true });
    await mkdir(runtimePath, { recursive: true });
    await mkdir(sandboxPath, { recursive: true });

    const teardown = createTeardownController(`message \`${MESSAGE_ID}\``);
    teardown.addPath(workspacePath, "agent workspace");
    teardown.addPath(contextPath, "agent context");
    teardown.addPath(runtimePath, "agent runtime");
    teardown.addPath(sandboxPath, "agent sandbox");

    registerActiveMessage({
      root,
      messagesFilePath: join(root, ".voratiq", "message", "index.json"),
      messageId: MESSAGE_ID,
      teardown,
    });

    await finalizeActiveMessage(MESSAGE_ID);

    await expect(pathExists(workspacePath)).resolves.toBe(false);
    await expect(pathExists(contextPath)).resolves.toBe(false);
    await expect(pathExists(runtimePath)).resolves.toBe(false);
    await expect(pathExists(sandboxPath)).resolves.toBe(false);
    await expect(pathExists(artifactsPath)).resolves.toBe(true);
  });
});
