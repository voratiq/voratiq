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
  const baseRecord = {
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
        outputPath:
          ".voratiq/message/sessions/message-123/agent-a/artifacts/response.md",
      },
    ],
    error: null,
  } as const;

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

  it("accepts records without a persisted target", () => {
    const parsed = messageRecordSchema.parse(baseRecord);
    expect(parsed.target).toBeUndefined();
  });

  it.each(["interactive", "run", "spec", "reduce", "verify"] as const)(
    "accepts `%s` as a persisted message target kind",
    (kind) => {
      const parsed = messageRecordSchema.parse({
        ...baseRecord,
        target: {
          kind,
          sessionId: `${kind}-123`,
        },
      });

      expect(parsed.target).toEqual({
        kind,
        sessionId: `${kind}-123`,
      });
    },
  );

  it("accepts persisted run lane targets with an agent id", () => {
    const parsed = messageRecordSchema.parse({
      ...baseRecord,
      target: {
        kind: "run",
        sessionId: "run-123",
        agentId: "gpt-5-4-high",
      },
    });

    expect(parsed.target).toEqual({
      kind: "run",
      sessionId: "run-123",
      agentId: "gpt-5-4-high",
    });
  });

  it("rejects interactive targets with a lane agent id", () => {
    expect(() =>
      messageRecordSchema.parse({
        ...baseRecord,
        target: {
          kind: "interactive",
          sessionId: "interactive-123",
          agentId: "gpt-5-4-high",
        },
      }),
    ).toThrow(
      "interactive message targets must not persist an `agentId` lane reference",
    );
  });

  it("rejects unsupported message target kinds", () => {
    expect(() =>
      messageRecordSchema.parse({
        ...baseRecord,
        target: {
          kind: "message",
          sessionId: "message-123",
        },
      }),
    ).toThrow();
  });
});
