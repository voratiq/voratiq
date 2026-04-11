import {
  formatTargetDisplay,
  formatTargetTablePreview,
  normalizeListSession,
  normalizeListTarget,
  TARGET_TABLE_PREVIEW_LENGTH,
} from "../../../src/commands/list/normalization.js";
import type { InteractiveSessionRecord } from "../../../src/domain/interactive/model/types.js";
import type { MessageRecord } from "../../../src/domain/message/model/types.js";
import type { ReductionRecord } from "../../../src/domain/reduce/model/types.js";
import type { RunRecord } from "../../../src/domain/run/model/types.js";
import type { SpecRecord } from "../../../src/domain/spec/model/types.js";
import type { VerificationRecord } from "../../../src/domain/verify/model/types.js";
import { createRunRecord } from "../../support/factories/run-records.js";

describe("list target normalization", () => {
  it("keeps spec sessions as no-target baselines", () => {
    const record: SpecRecord = {
      sessionId: "spec-123",
      createdAt: "2026-03-01T00:00:00.000Z",
      startedAt: "2026-03-01T00:00:00.000Z",
      completedAt: "2026-03-01T00:01:00.000Z",
      status: "succeeded",
      description: "Generate task spec",
      agents: [],
      error: null,
    };

    const session = normalizeListSession("spec", record);

    expect(session.target).toBeUndefined();
  });

  it("keeps interactive sessions as root-like no-target baselines", () => {
    const record: InteractiveSessionRecord = {
      sessionId: "interactive-123",
      createdAt: "2026-03-01T00:00:00.000Z",
      status: "succeeded",
      agentId: "agent-a",
      toolAttachmentStatus: "attached",
    };

    const session = normalizeListSession("interactive", record);
    const target = normalizeListTarget("interactive", record);

    expect(session).toEqual({
      operator: "interactive",
      sessionId: "interactive-123",
      status: "succeeded",
      createdAt: "2026-03-01T00:00:00.000Z",
      target: undefined,
    });
    expect(target).toBeUndefined();
  });

  it("normalizes run target lineage with the required fallback matrix", () => {
    const fromSpecSession: RunRecord = createRunRecord({
      runId: "run-spec-target",
      spec: {
        path: ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.md",
        target: {
          kind: "spec",
          sessionId: "spec-123",
        },
      },
    });
    const fromExplicitFileTarget: RunRecord = createRunRecord({
      runId: "run-file-target",
      spec: {
        path: "specs/manual.md",
        target: {
          kind: "file",
        },
      },
    });
    const fromLegacyPathOnly: RunRecord = createRunRecord({
      runId: "run-legacy",
      spec: {
        path: "specs/legacy.md",
      },
    });

    const specTarget = normalizeListTarget("run", fromSpecSession);
    const explicitFileTarget = normalizeListTarget(
      "run",
      fromExplicitFileTarget,
    );
    const legacyFileTarget = normalizeListTarget("run", fromLegacyPathOnly);

    expect(specTarget).toEqual({
      kind: "spec",
      sessionId: "spec-123",
    });
    expect(explicitFileTarget).toEqual({
      kind: "file",
      path: "specs/manual.md",
    });
    expect(legacyFileTarget).toEqual({
      kind: "file",
      path: "specs/legacy.md",
    });

    expect(specTarget ? formatTargetDisplay(specTarget) : null).toBe(
      "spec:spec-123",
    );
    expect(
      explicitFileTarget ? formatTargetDisplay(explicitFileTarget) : null,
    ).toBe("file:specs/manual.md");
    expect(
      legacyFileTarget ? formatTargetDisplay(legacyFileTarget) : null,
    ).toBe("file:specs/legacy.md");
  });

  it("normalizes reduce targets to session refs", () => {
    const record = {
      sessionId: "reduce-123",
      createdAt: "2026-03-01T00:00:00.000Z",
      status: "succeeded",
      target: {
        type: "run",
        id: "run-123",
      },
    } as unknown as ReductionRecord;

    const target = normalizeListTarget("reduce", record);

    expect(target).toEqual({
      kind: "run",
      sessionId: "run-123",
    });
    expect(target ? formatTargetDisplay(target) : null).toBe("run:run-123");
  });

  it("normalizes message targets to session refs when persisted", () => {
    const record = {
      sessionId: "message-123",
      createdAt: "2026-03-01T00:00:00.000Z",
      startedAt: "2026-03-01T00:00:00.000Z",
      completedAt: "2026-03-01T00:00:03.000Z",
      status: "succeeded",
      prompt: "Review this change.",
      target: {
        kind: "interactive",
        sessionId: "interactive-123",
      },
      recipients: [
        {
          agentId: "agent-a",
          status: "succeeded",
          startedAt: "2026-03-01T00:00:00.000Z",
          completedAt: "2026-03-01T00:00:03.000Z",
          outputPath:
            ".voratiq/message/sessions/message-123/agent-a/artifacts/response.md",
          error: null,
        },
      ],
      error: null,
    } as MessageRecord;

    const target = normalizeListTarget("message", record);

    expect(target).toEqual({
      kind: "interactive",
      sessionId: "interactive-123",
    });
    expect(target ? formatTargetDisplay(target) : null).toBe(
      "interactive:interactive-123",
    );
  });

  it("normalizes non-interactive message session targets", () => {
    const record = {
      sessionId: "message-456",
      createdAt: "2026-03-01T00:00:00.000Z",
      startedAt: "2026-03-01T00:00:00.000Z",
      completedAt: "2026-03-01T00:00:03.000Z",
      status: "succeeded",
      prompt: "Review this change.",
      target: {
        kind: "run",
        sessionId: "run-123",
      },
      recipients: [
        {
          agentId: "agent-a",
          status: "succeeded",
          startedAt: "2026-03-01T00:00:00.000Z",
          completedAt: "2026-03-01T00:00:03.000Z",
          outputPath:
            ".voratiq/message/sessions/message-456/agent-a/artifacts/response.md",
          error: null,
        },
      ],
      error: null,
    } as MessageRecord;

    const target = normalizeListTarget("message", record);

    expect(target).toEqual({
      kind: "run",
      sessionId: "run-123",
    });
    expect(target ? formatTargetDisplay(target) : null).toBe("run:run-123");
  });

  it("normalizes non-interactive message lane targets", () => {
    const record = {
      sessionId: "message-789",
      createdAt: "2026-03-01T00:00:00.000Z",
      startedAt: "2026-03-01T00:00:00.000Z",
      completedAt: "2026-03-01T00:00:03.000Z",
      status: "succeeded",
      prompt: "Review this change.",
      target: {
        kind: "run",
        sessionId: "run-123",
        agentId: "gpt-5-4-high",
      },
      recipients: [
        {
          agentId: "agent-a",
          status: "succeeded",
          startedAt: "2026-03-01T00:00:00.000Z",
          completedAt: "2026-03-01T00:00:03.000Z",
          outputPath:
            ".voratiq/message/sessions/message-789/agent-a/artifacts/response.md",
          error: null,
        },
      ],
      error: null,
    } as MessageRecord;

    const target = normalizeListTarget("message", record);

    expect(target).toEqual({
      kind: "run",
      sessionId: "run-123",
      agentId: "gpt-5-4-high",
    });
    expect(target ? formatTargetDisplay(target) : null).toBe(
      "run:run-123:gpt-5-4-high",
    );
  });

  it("keeps messages without persisted targets as no-target baselines", () => {
    const record = {
      sessionId: "message-no-target",
      createdAt: "2026-03-01T00:00:00.000Z",
      startedAt: "2026-03-01T00:00:00.000Z",
      completedAt: "2026-03-01T00:00:03.000Z",
      status: "succeeded",
      sourceInteractiveSessionId: "interactive-legacy",
      prompt: "Review this change.",
      recipients: [
        {
          agentId: "agent-a",
          status: "succeeded",
          startedAt: "2026-03-01T00:00:00.000Z",
          completedAt: "2026-03-01T00:00:03.000Z",
          outputPath:
            ".voratiq/message/sessions/message-no-target/agent-a/artifacts/response.md",
          error: null,
        },
      ],
      error: null,
    } as MessageRecord;

    const target = normalizeListTarget("message", record);

    expect(target).toBeUndefined();
  });

  it("normalizes verify targets to session refs", () => {
    const record = {
      sessionId: "verify-123",
      createdAt: "2026-03-01T00:00:00.000Z",
      status: "succeeded",
      target: {
        kind: "message",
        sessionId: "message-123",
      },
    } as unknown as VerificationRecord;

    const target = normalizeListTarget("verify", record);

    expect(target).toEqual({
      kind: "message",
      sessionId: "message-123",
    });
    expect(target ? formatTargetDisplay(target) : null).toBe(
      "message:message-123",
    );
  });

  it("builds 32-character middle-elided table previews with stable prefix and suffix", () => {
    const filePreview = formatTargetTablePreview({
      kind: "file",
      path: ".voratiq/spec/sessions/20260327-043019-uatir/gpt-5-4-high/artifacts/clean-up-stale-review-terminology-in-auto-verify-test-surface.md",
    });

    expect(filePreview.length).toBe(TARGET_TABLE_PREVIEW_LENGTH);
    expect(filePreview.startsWith("file:")).toBe(true);
    expect(filePreview.includes("...")).toBe(true);
    expect(filePreview.endsWith("surface.md")).toBe(true);

    const sessionPreview = formatTargetTablePreview({
      kind: "spec",
      sessionId: "20260327-043019-uatir-very-long-session-id",
    });

    expect(sessionPreview.length).toBe(TARGET_TABLE_PREVIEW_LENGTH);
    expect(sessionPreview.startsWith("spec:")).toBe(true);
    expect(sessionPreview.includes("...")).toBe(true);
    expect(sessionPreview.endsWith("ong-session-id")).toBe(true);
  });
});
