import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { createMessageRecordMutators } from "../../../../src/domain/message/model/mutators.js";
import type { MessageRecord } from "../../../../src/domain/message/model/types.js";
import { rewriteMessageRecord } from "../../../../src/domain/message/persistence/adapter.js";

jest.mock("../../../../src/domain/message/persistence/adapter.js", () => ({
  rewriteMessageRecord: jest.fn(),
}));

const rewriteMessageRecordMock = jest.mocked(rewriteMessageRecord);

describe("createMessageRecordMutators", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("retains outputPath once a recipient has reported it", async () => {
    const messageId = "message-123";
    let currentRecord: MessageRecord = {
      sessionId: messageId,
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "running",
      baseRevisionSha: "abc123",
      prompt: "Review this change.",
      recipients: [],
      error: null,
    };

    rewriteMessageRecordMock.mockImplementation(({ mutate }) => {
      currentRecord = mutate(currentRecord);
      return Promise.resolve(currentRecord);
    });

    const mutators = createMessageRecordMutators({
      root: "/repo",
      messagesFilePath: "/repo/.voratiq/message/index.json",
      messageId,
    });

    await mutators.recordRecipientSnapshot({
      agentId: "agent-a",
      status: "succeeded",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:03.000Z",
      outputPath:
        ".voratiq/message/sessions/message-123/agent-a/artifacts/response.md",
    });

    await mutators.recordRecipientSnapshot({
      agentId: "agent-a",
      status: "succeeded",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:03.000Z",
      error: null,
    });

    expect(currentRecord.recipients[0]?.outputPath).toBe(
      ".voratiq/message/sessions/message-123/agent-a/artifacts/response.md",
    );
  });

  it("does not downgrade terminal recipients when late running updates arrive", async () => {
    const messageId = "message-456";
    let currentRecord: MessageRecord = {
      sessionId: messageId,
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "running",
      baseRevisionSha: "abc123",
      prompt: "Review this change.",
      recipients: [
        {
          agentId: "agent-a",
          status: "succeeded",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:03.000Z",
          outputPath:
            ".voratiq/message/sessions/message-456/agent-a/artifacts/response.md",
        },
      ],
      error: null,
    };

    rewriteMessageRecordMock.mockImplementation(({ mutate }) => {
      currentRecord = mutate(currentRecord);
      return Promise.resolve(currentRecord);
    });

    const mutators = createMessageRecordMutators({
      root: "/repo",
      messagesFilePath: "/repo/.voratiq/message/index.json",
      messageId,
    });

    await mutators.recordRecipientRunning({
      agentId: "agent-a",
      status: "running",
      startedAt: "2026-01-01T00:00:04.000Z",
    });

    expect(currentRecord.recipients[0]).toEqual({
      agentId: "agent-a",
      status: "succeeded",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:03.000Z",
      outputPath:
        ".voratiq/message/sessions/message-456/agent-a/artifacts/response.md",
    });
  });

  it("does not overwrite an already-terminal message session", async () => {
    const messageId = "message-789";
    let currentRecord: MessageRecord = {
      sessionId: messageId,
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:05.000Z",
      status: "aborted",
      baseRevisionSha: "abc123",
      prompt: "Review this change.",
      recipients: [
        {
          agentId: "agent-a",
          status: "aborted",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:05.000Z",
          error: "aborted",
        },
      ],
      error: "aborted",
    };

    rewriteMessageRecordMock.mockImplementation(({ mutate }) => {
      currentRecord = mutate(currentRecord);
      return Promise.resolve(currentRecord);
    });

    const mutators = createMessageRecordMutators({
      root: "/repo",
      messagesFilePath: "/repo/.voratiq/message/index.json",
      messageId,
    });

    const result = await mutators.completeMessage({
      status: "failed",
      error: "boom",
    });

    expect(result).toEqual(currentRecord);
    expect(currentRecord.status).toBe("aborted");
    expect(currentRecord.error).toBe("aborted");
  });
});
