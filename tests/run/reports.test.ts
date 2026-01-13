import { toAgentReport, toRunReport } from "../../src/commands/run/reports.js";
import type {
  AgentInvocationRecord,
  AgentReport,
} from "../../src/runs/records/types.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../support/factories/run-records.js";

describe("report mapping helpers", () => {
  const baseEvalResults = [
    {
      slug: "format" as const,
      status: "succeeded" as const,
      exitCode: 0,
      command: "npm run format:check",
      hasLog: true,
    },
    {
      slug: "lint" as const,
      status: "succeeded" as const,
      exitCode: 0,
      command: "npm run lint",
      hasLog: true,
    },
    {
      slug: "typecheck" as const,
      status: "succeeded" as const,
      exitCode: 0,
      command: "npx tsc --noEmit",
      hasLog: true,
    },
    {
      slug: "tests" as const,
      status: "succeeded" as const,
      exitCode: 0,
      command: "npm test",
      hasLog: true,
    },
  ];

  const runId = "123";

  const baseAgentRecord: AgentInvocationRecord = createAgentInvocationRecord({
    agentId: "claude",
    model: "claude-model",
    status: "succeeded",
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString(),
    commitSha: "abc123",
    evals: baseEvalResults,
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
    });

    expect(report.agentId).toBe(baseAgentRecord.agentId);
    expect(report.diffStatistics).toBe("1 file changed");
    expect(report.diffAttempted).toBe(true);
    expect(report.diffCaptured).toBe(true);
    expect(report.evals).toHaveLength(baseEvalResults.length);
    expect(report.evals[0]?.logPath).toBe(
      `.voratiq/runs/sessions/${runId}/claude/evals/${baseEvalResults[0]?.slug}.log`,
    );
  });

  it("maps run report fields and validates derived flags", () => {
    const agentReport = toAgentReport(runId, baseAgentRecord, {
      diffAttempted: true,
      diffCaptured: true,
      diffStatistics: "1 file changed",
    });

    const runRecord = createRunRecord({
      runId,
      baseRevisionSha: "abc123",
      spec: { path: "specs/sample.md" },
      createdAt: new Date(0).toISOString(),
      agents: [baseAgentRecord],
      status: "succeeded",
    });

    const runReport = toRunReport(runRecord, [agentReport], false, false);
    expect(runReport.runId).toBe(runRecord.runId);
    expect(runReport.createdAt).toBe(runRecord.createdAt);
    expect(runReport.baseRevisionSha).toBe(runRecord.baseRevisionSha);
    expect(runReport.agents).toHaveLength(1);
    expect(runReport.hadAgentFailure).toBe(false);
    expect(runReport.hadEvalFailure).toBe(false);
    expect(runReport.status).toBe("succeeded");
  });

  it("throws when aggregated flags disagree with derived values", () => {
    const failingAgent: AgentReport = {
      agentId: "codex",
      status: "failed",
      runtimeManifestPath:
        ".voratiq/runs/sessions/bad/codex/runtime/manifest.json",
      baseDirectory: ".voratiq/runs/sessions/bad/codex",
      diffStatistics: undefined,
      assets: {
        stdoutPath: ".voratiq/runs/sessions/bad/codex/artifacts/stdout.log",
        stderrPath: ".voratiq/runs/sessions/bad/codex/artifacts/stderr.log",
      },
      evals: baseEvalResults.map((evaluation) => ({
        ...evaluation,
        hasLog: false,
      })),
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

    expect(() => toRunReport(runRecord, [failingAgent], false, false)).toThrow(
      /hadAgentFailure/,
    );
  });

  it("tracks eval failure independently from execution status", () => {
    const failingRunId = "tests-failed-run";
    const evalFailedRecord: AgentInvocationRecord = {
      ...baseAgentRecord,
      status: "succeeded",
      evals: baseEvalResults.map((evaluation) =>
        evaluation.slug === "lint"
          ? {
              ...evaluation,
              status: "failed" as const,
              exitCode: 1,
            }
          : evaluation,
      ),
    };

    const agentReport = toAgentReport(failingRunId, evalFailedRecord, {
      diffAttempted: true,
      diffCaptured: true,
      diffStatistics: "1 file changed",
    });

    const runRecord = createRunRecord({
      runId: failingRunId,
      baseRevisionSha: "abc123",
      spec: { path: "specs/sample.md" },
      createdAt: new Date(0).toISOString(),
      agents: [evalFailedRecord],
      status: "succeeded",
    });

    const runReport = toRunReport(runRecord, [agentReport], false, true);
    expect(runReport.hadEvalFailure).toBe(true);
    expect(runReport.hadAgentFailure).toBe(false);
    expect(runReport.status).toBe("succeeded");
  });
});
