import type { SandboxFailFastInfo } from "../../../agents/runtime/sandbox.js";
import type { AgentDefinition } from "../../../configs/agents/types.js";
import type {
  AgentEvalResult,
  EvalDefinition,
} from "../../../configs/evals/types.js";
import type {
  AgentArtifactState,
  AgentEvalSnapshot,
  AgentInvocationRecord,
  AgentStatus,
  WatchdogMetadata,
} from "../../../runs/records/types.js";
import { normalizeDiffStatistics } from "../../../utils/diff.js";
import type { ChatArtifactFormat } from "../../../workspace/chat/types.js";
import type { RunCommandError } from "../errors.js";
import {
  type AgentExecutionResult,
  type AgentExecutionState,
  finalizeAgentResult,
} from "../reports.js";
import type { ArtifactCollectionResult } from "./artifacts.js";

export class AgentRunContext {
  public readonly state: AgentExecutionState = {
    diffAttempted: false,
    diffCaptured: false,
    diffStatistics: undefined,
  };

  public status: AgentStatus = "succeeded";
  public commitSha: string | undefined;
  public evalResults: AgentEvalResult[];
  public errorMessage: string | undefined;
  public watchdogMetadata: WatchdogMetadata | undefined;
  private failFast: SandboxFailFastInfo | undefined;
  private completedAt: string | undefined;
  private startedAt: string;
  private readonly evalPlan: readonly EvalDefinition[];
  private readonly runId: string;
  private readonly agent: AgentDefinition;
  private artifactState: AgentArtifactState;
  private evalWarnings: string[] = [];

  constructor(params: {
    agent: AgentDefinition;
    runId: string;
    startedAt: string;
    evalPlan: readonly EvalDefinition[];
  }) {
    this.agent = params.agent;
    this.runId = params.runId;
    this.startedAt = params.startedAt;
    this.evalPlan = params.evalPlan;
    this.evalResults = buildDefaultEvalResults(this.evalPlan);
    this.artifactState = {
      diffAttempted: false,
      diffCaptured: false,
      stdoutCaptured: true,
      stderrCaptured: true,
    };
  }

  public markFailure(error: RunCommandError): void {
    this.status = "failed";
    this.errorMessage = error.messageForDisplay();
  }

  public async failWith(error: RunCommandError): Promise<AgentExecutionResult> {
    this.markFailure(error);
    this.setCompleted();
    await Promise.resolve();
    return this.finalize();
  }

  public isFailed(): boolean {
    return this.status === "failed";
  }

  public setCompleted(): void {
    if (!this.completedAt) {
      this.completedAt = new Date().toISOString();
    }
  }

  public markStarted(): void {
    this.startedAt = new Date().toISOString();
  }

  public getStartedAt(): string | undefined {
    return this.startedAt;
  }

  public applyArtifacts(result: ArtifactCollectionResult): void {
    if (result.summaryCaptured) {
      this.artifactState.summaryCaptured = true;
    }
    if (result.diffAttempted) {
      this.artifactState.diffAttempted = true;
    }
    if (result.diffCaptured) {
      this.artifactState.diffCaptured = true;
    }
    if (result.commitSha) {
      this.commitSha = result.commitSha;
    }
    const normalizedDiff = normalizeDiffStatistics(result.diffStatistics);
    if (normalizedDiff) {
      this.state.diffStatistics = normalizedDiff;
    }
    this.state.diffAttempted ||= result.diffAttempted;
    this.state.diffCaptured ||= result.diffCaptured;
  }

  public applyEvaluations(results: AgentEvalResult[]): void {
    const defaults = buildDefaultEvalResults(this.evalPlan);
    const bySlug = new Map(
      results.map((evaluation) => [evaluation.slug, evaluation]),
    );
    this.evalResults = defaults.map((fallback) => {
      const evaluation = bySlug.get(fallback.slug);
      return evaluation ?? fallback;
    });
    if (this.status === "failed") {
      return;
    }

    const hasErrored = this.evalResults.some((evaluation) => {
      return evaluation.status === "errored";
    });
    const hasFailed = this.evalResults.some(
      (evaluation) => evaluation.status === "failed",
    );

    if (hasErrored) {
      this.status = "errored";
      if (!this.errorMessage) {
        const erroredEval = this.evalResults.find(
          (evaluation) => evaluation.status === "errored" && evaluation.error,
        );
        if (erroredEval?.error) {
          this.errorMessage = erroredEval.error;
        }
      }
      return;
    }

    if (hasFailed) {
      this.status = "failed";
    }
  }

  public markChatArtifact(format: ChatArtifactFormat): void {
    this.artifactState.chatCaptured = true;
    this.artifactState.chatFormat = format;
  }

  public recordEvalWarnings(warnings: readonly string[]): void {
    this.evalWarnings.push(...warnings);
  }

  public setWatchdogMetadata(metadata: WatchdogMetadata): void {
    this.watchdogMetadata = metadata;
  }

  public setFailFastTriggered(info: SandboxFailFastInfo): void {
    this.failFast = info;
  }

  public finalize(): AgentExecutionResult {
    this.setCompleted();
    const record = buildAgentRecord({
      agent: this.agent,
      commitSha: this.commitSha,
      completedAt: this.completedAt ?? new Date().toISOString(),
      errorMessage: this.errorMessage,
      startedAt: this.startedAt,
      status: this.status,
      artifacts: this.artifactState,
      evalResults: this.evalResults,
      warnings: this.evalWarnings,
      diffStatistics: this.state.diffStatistics,
      watchdog: this.watchdogMetadata,
      failFast: this.failFast,
    });

    return finalizeAgentResult(this.runId, record, this.state);
  }

  /**
   * Build an early failure record for immediate UI surfacing when watchdog triggers.
   * Includes placeholder evals so the record satisfies agentInvocationRecordSchema.
   */
  public buildEarlyFailureRecord(errorMessage: string): AgentInvocationRecord {
    return buildAgentRecord({
      agent: this.agent,
      commitSha: undefined,
      completedAt: new Date().toISOString(),
      errorMessage,
      startedAt: this.startedAt,
      status: "failed",
      artifacts: this.artifactState,
      evalResults: this.evalResults,
      warnings: this.evalWarnings,
      diffStatistics: undefined,
      watchdog: this.watchdogMetadata,
      failFast: this.failFast,
    });
  }
}

export function buildDefaultEvalResults(
  definitions: readonly EvalDefinition[],
): AgentEvalResult[] {
  return definitions.map(({ slug, command }) => ({
    slug,
    command,
    status: "skipped" as const,
  }));
}

function buildAgentRecord(options: {
  agent: AgentDefinition;
  commitSha: string | undefined;
  completedAt: string;
  errorMessage: string | undefined;
  startedAt: string;
  status: AgentStatus;
  artifacts: AgentArtifactState;
  evalResults: AgentEvalResult[];
  warnings: readonly string[];
  diffStatistics?: string;
  watchdog?: WatchdogMetadata;
  failFast?: SandboxFailFastInfo;
}): AgentInvocationRecord {
  const {
    agent,
    commitSha,
    completedAt,
    errorMessage,
    startedAt,
    status,
    artifacts,
    evalResults,
    warnings,
    diffStatistics,
    watchdog,
    failFast,
  } = options;

  const snapshots = toEvalSnapshots(evalResults);
  const artifactState =
    Object.keys(artifacts).length > 0 ? artifacts : undefined;
  const normalizedWarnings =
    warnings.length > 0 ? Array.from(new Set(warnings)) : undefined;
  const normalizedDiffStatistics = normalizeDiffStatistics(diffStatistics);

  const record: AgentInvocationRecord = {
    agentId: agent.id,
    model: agent.model,
    startedAt,
    completedAt,
    status,
    commitSha,
    artifacts: artifactState,
    evals: snapshots,
    error: errorMessage,
    warnings: normalizedWarnings,
    watchdog,
    ...(failFast
      ? {
          failFastTriggered: true,
          failFastTarget: failFast.target,
          failFastOperation: failFast.operation,
        }
      : {}),
  };

  if (normalizedDiffStatistics) {
    record.diffStatistics = normalizedDiffStatistics;
  }

  return record;
}

function toEvalSnapshots(results: AgentEvalResult[]): AgentEvalSnapshot[] {
  return results.map((evaluation) => ({
    slug: evaluation.slug,
    status: evaluation.status,
    command: evaluation.command,
    exitCode: evaluation.exitCode,
    hasLog: evaluation.logPath !== undefined,
    error: evaluation.error,
  }));
}
