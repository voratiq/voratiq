import type {
  AgentInvocationRecord,
  AgentReport,
  ExtractedTokenUsage,
  RunRecord,
  RunReport,
} from "../../../domains/runs/model/types.js";
import type { TokenUsageResult } from "../../../workspace/chat/token-usage-result.js";
import {
  buildAgentArtifactPaths,
  buildAgentEvalViews,
  getAgentDirectoryPath,
  getAgentManifestPath,
} from "../../../workspace/structure.js";
import { RunReportInvariantError } from "./errors.js";

export interface AgentExecutionState {
  diffAttempted: boolean;
  diffCaptured: boolean;
  diffStatistics?: string;
  tokenUsage?: ExtractedTokenUsage;
  tokenUsageResult: TokenUsageResult;
}

export interface AgentExecutionResult {
  record: AgentInvocationRecord;
  report: AgentReport;
}

export function finalizeAgentResult(
  runId: string,
  record: AgentInvocationRecord,
  derivations: AgentExecutionState,
): AgentExecutionResult {
  return {
    record,
    report: toAgentReport(runId, record, derivations),
  };
}

export function toAgentReport(
  runId: string,
  record: AgentInvocationRecord,
  derivations: AgentExecutionState,
): AgentReport {
  if (!record.evals) {
    throw new RunReportInvariantError(
      `Agent ${record.agentId} is missing evaluation results for status ${record.status}.`,
    );
  }

  if (!record.startedAt || !record.completedAt) {
    throw new RunReportInvariantError(
      `Agent ${record.agentId} is missing lifecycle timestamps for status ${record.status}.`,
    );
  }

  const assets = buildAgentArtifactPaths({
    runId,
    agentId: record.agentId,
    artifacts: record.artifacts,
  });

  return {
    agentId: record.agentId,
    status: record.status,
    tokenUsage: record.tokenUsage ?? derivations.tokenUsage,
    tokenUsageResult: derivations.tokenUsageResult,
    runtimeManifestPath: getAgentManifestPath(runId, record.agentId),
    baseDirectory: getAgentDirectoryPath(runId, record.agentId),
    diffStatistics: derivations.diffStatistics,
    assets,
    evals: buildAgentEvalViews({
      runId,
      agentId: record.agentId,
      evals: record.evals,
    }),
    error: record.error,
    warnings: record.warnings,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    diffAttempted: derivations.diffAttempted,
    diffCaptured: derivations.diffCaptured,
  };
}

export function hasEvalFailures(reports: AgentReport[]): boolean {
  return reports.some((report) =>
    report.evals.some(
      (evaluation) =>
        evaluation.status === "failed" || evaluation.status === "errored",
    ),
  );
}

export function toRunReport(
  record: RunRecord,
  agents: AgentReport[],
  hadAgentFailure: boolean,
  hadEvalFailure: boolean,
): RunReport {
  const derivedAgentFailure = agents.some(
    (agent) => agent.status === "failed" || agent.status === "errored",
  );
  const derivedEvalFailure = hasEvalFailures(agents);

  if (hadAgentFailure !== derivedAgentFailure) {
    throw new RunReportInvariantError(
      `RunReport mismatch: hadAgentFailure (${hadAgentFailure}) does not match derived value (${derivedAgentFailure}).`,
    );
  }

  if (hadEvalFailure !== derivedEvalFailure) {
    throw new RunReportInvariantError(
      `RunReport mismatch: hadEvalFailure (${hadEvalFailure}) does not match derived value (${derivedEvalFailure}).`,
    );
  }

  return {
    runId: record.runId,
    spec: record.spec,
    status: record.status,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    baseRevisionSha: record.baseRevisionSha,
    agents,
    hadAgentFailure: derivedAgentFailure,
    hadEvalFailure: derivedEvalFailure,
  };
}
