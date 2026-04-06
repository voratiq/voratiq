import { describe, expect, it } from "@jest/globals";

import {
  deriveMessageStatusFromRecipients,
  messageRecordSchema,
} from "../../../../src/domain/message/model/types.js";

describe("deriveMessageStatusFromRecipients", () => {
  it("returns succeeded when at least one recipient succeeds", () => {
    expect(
      deriveMessageStatusFromRecipients(["failed", "succeeded", "aborted"]),
    ).toBe("succeeded");
  });

  it("returns failed when no recipients succeed", () => {
    expect(deriveMessageStatusFromRecipients(["failed", "aborted"])).toBe(
      "failed",
    );
  });
});

describe("messageRecordSchema", () => {
  it("rejects succeeded recipients without an outputPath", () => {
    expect(() =>
      messageRecordSchema.parse({
        sessionId: "message-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:03.000Z",
        status: "succeeded",
        baseRevisionSha: "abc123",
        prompt: "Review this change.",
        recipients: [
          {
            agentId: "agent-a",
            status: "succeeded",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:03.000Z",
          },
        ],
        error: null,
      }),
    ).toThrow("succeeded message recipients must persist `outputPath`");
  });
});
