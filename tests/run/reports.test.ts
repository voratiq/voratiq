import {
  toAgentReport,
  toRunReport,
} from "../../src/domain/run/competition/reports.js";
import type {
  AgentInvocationRecord,
  AgentReport,
} from "../../src/domain/run/model/types.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../support/factories/run-records.js";

describe("report mapping helpers", () => {
  const runId = "123";

  const baseAgentRecord: AgentInvocationRecord = createAgentInvocationRecord({
    agentId: "claude",
    model: "claude-model",
    status: "succeeded",
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString(),
    commitSha: "abc123",
    artifacts: {
      diffAttempted: true,
      diffCaptured: true,
      stdoutCaptured: true,
      stderrCaptured: true,
      summaryCaptured: true,
    },
  });

  it("maps agent report fields and derivations", () => {
    const report = toAgentReport(runId, baseAgentRecord, {
      diffAttempted: true,
      diffCaptured: true,
      diffStatistics: "1 file changed",
      tokenUsageResult: {
        status: "unavailable",
        reason: "chat_not_captured",
        provider: "unknown",
        modelId: baseAgentRecord.model,
      },
    });

    expect(report.agentId).toBe(baseAgentRecord.agentId);
    expect(report.diffStatistics).toBe("1 file changed");
    expect(report.diffAttempted).toBe(true);
    expect(report.diffCaptured).toBe(true);
  });

  it("maps run report fields and validates derived flags", () => {
    const agentReport = toAgentReport(runId, baseAgentRecord, {
      diffAttempted: true,
      diffCaptured: true,
      diffStatistics: "1 file changed",
      tokenUsageResult: {
        status: "unavailable",
        reason: "chat_not_captured",
        provider: "unknown",
        modelId: baseAgentRecord.model,
      },
    });

    const runRecord = createRunRecord({
      runId,
      baseRevisionSha: "abc123",
      spec: { path: "specs/sample.md" },
      createdAt: new Date(0).toISOString(),
      agents: [baseAgentRecord],
      status: "succeeded",
    });

    const runReport = toRunReport(runRecord, [agentReport], false);
    expect(runReport.runId).toBe(runRecord.runId);
    expect(runReport.createdAt).toBe(runRecord.createdAt);
    expect(runReport.startedAt).toBe(runRecord.startedAt);
    expect(runReport.completedAt).toBe(runRecord.completedAt);
    expect(runReport.baseRevisionSha).toBe(runRecord.baseRevisionSha);
    expect(runReport.agents).toHaveLength(1);
    expect(runReport.hadAgentFailure).toBe(false);
    expect(runReport.status).toBe("succeeded");
  });

  it("throws when aggregated flags disagree with derived values", () => {
    const failingAgent: AgentReport = {
      agentId: "codex",
      status: "failed",
      tokenUsageResult: {
        status: "unavailable",
        reason: "chat_not_captured",
        provider: "unknown",
        modelId: "gpt-5",
      },
      runtimeManifestPath:
        ".voratiq/run/sessions/bad/codex/runtime/manifest.json",
      baseDirectory: ".voratiq/run/sessions/bad/codex",
      diffStatistics: undefined,
      assets: {
        stdoutPath: ".voratiq/run/sessions/bad/codex/artifacts/stdout.log",
        stderrPath: ".voratiq/run/sessions/bad/codex/artifacts/stderr.log",
      },
      error: "Agent failed to modify the workspace",
      diffAttempted: false,
      diffCaptured: false,
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(0).toISOString(),
    };

    const runRecord = createRunRecord({
      runId: "bad-run",
      baseRevisionSha: "def456",
      spec: { path: "specs/sample.md" },
      createdAt: new Date(0).toISOString(),
      agents: [],
      status: "succeeded",
    });

    expect(() => toRunReport(runRecord, [failingAgent], false)).toThrow(
      /hadAgentFailure/,
    );
  });

  it("exposes provider-native token usage on run reports", () => {
    const tokenUsage = {
      input_tokens: 210,
      output_tokens: 65,
      cache_read_input_tokens: 41,
      cache_creation_input_tokens: 11,
    } as const;
    const usageRecord: AgentInvocationRecord = {
      ...baseAgentRecord,
      tokenUsage,
    };

    const agentReport = toAgentReport(runId, usageRecord, {
      diffAttempted: true,
      diffCaptured: true,
      diffStatistics: "1 file changed",
      tokenUsage: tokenUsage,
      tokenUsageResult: {
        status: "available",
        provider: "unknown",
        modelId: usageRecord.model,
        tokenUsage,
      },
    });

    const runRecord = createRunRecord({
      runId,
      baseRevisionSha: "abc123",
      spec: { path: "specs/sample.md" },
      createdAt: new Date(0).toISOString(),
      agents: [usageRecord],
      status: "succeeded",
    });

    const runReport = toRunReport(runRecord, [agentReport], false);
    expect(runReport.agents[0]?.tokenUsage).toEqual(tokenUsage);
    expect(runReport.agents[0]?.tokenUsageResult).toEqual({
      status: "available",
      provider: "unknown",
      modelId: usageRecord.model,
      tokenUsage,
    });
  });
});
