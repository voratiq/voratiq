import { reductionRecordSchema } from "../../../src/domain/reduce/model/types.js";
import { runRecordSchema } from "../../../src/domain/run/model/types.js";
import { specRecordSchema } from "../../../src/domain/spec/model/types.js";
import { verificationRecordSchema } from "../../../src/domain/verify/model/types.js";

describe("shared record path validation", () => {
  it("rejects the same invalid repo-relative path across spec, run, verification, and reduction records", () => {
    const invalidPath = "../outside";

    const specResult = specRecordSchema.safeParse({
      sessionId: "spec-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
      status: "succeeded",
      baseRevisionSha: "abc123",
      description: "Spec",
      agents: [
        {
          agentId: "agent-1",
          status: "succeeded",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z",
          outputPath: invalidPath,
          dataPath: invalidPath,
        },
      ],
    });

    const runResult = runRecordSchema.safeParse({
      runId: "run-123",
      baseRevisionSha: "abc123",
      rootPath: invalidPath,
      spec: { path: invalidPath },
      status: "succeeded",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
      agents: [
        {
          agentId: "agent-1",
          model: "model-v1",
          status: "succeeded",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z",
        },
      ],
    });

    const verificationResult = verificationRecordSchema.safeParse({
      sessionId: "verify-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
      status: "succeeded",
      target: { kind: "spec", sessionId: "spec-123", specPath: invalidPath },
      methods: [],
    });

    const reductionResult = reductionRecordSchema.safeParse({
      sessionId: "reduction-123",
      target: { type: "run", id: "run-123" },
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
      status: "succeeded",
      reducers: [
        {
          agentId: "reducer-1",
          status: "succeeded",
          outputPath: invalidPath,
          dataPath: invalidPath,
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z",
        },
      ],
    });

    const expectedMessage =
      "Path \"../outside\" must be repo-relative, use forward slashes, and omit '.' or '..' segments.";

    expect(specResult.success).toBe(false);
    expect(runResult.success).toBe(false);
    expect(verificationResult.success).toBe(false);
    expect(reductionResult.success).toBe(false);

    const specIssueMessages =
      specResult.error?.issues.map((i) => i.message) ?? [];
    expect(specIssueMessages).toContain(expectedMessage);
    expect(runResult.error?.issues[0]?.message).toBe(expectedMessage);
    expect(runResult.error?.issues[1]?.message).toBe(expectedMessage);
    expect(verificationResult.error?.issues[0]?.message).toBe(expectedMessage);
    expect(reductionResult.error?.issues[0]?.message).toBe(expectedMessage);
    expect(reductionResult.error?.issues[1]?.message).toBe(expectedMessage);
  });
});
