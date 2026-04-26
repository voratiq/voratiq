import type { SandboxFailFastInfo } from "../../../../agents/runtime/sandbox.js";
import type { AgentDefinition } from "../../../../configs/agents/types.js";
import type { RunCommandError } from "../../../../domain/run/competition/errors.js";
import {
  type AgentExecutionResult,
  type AgentExecutionState,
  finalizeAgentResult,
} from "../../../../domain/run/competition/reports.js";
import type {
  AgentArtifactState,
  AgentInvocationRecord,
  AgentStatus,
  ExtractedTokenUsage,
  WatchdogMetadata,
} from "../../../../domain/run/model/types.js";
import {
  buildUnavailableTokenUsageResult,
  resolveTokenUsage,
} from "../../../../domain/shared/token-usage.js";
import { normalizeDiffStatistics } from "../../../../utils/diff.js";
import type { TokenUsageResult } from "../../../../workspace/chat/token-usage-result.js";
import type { ChatArtifactFormat } from "../../../../workspace/chat/types.js";
import type { ArtifactCollectionResult } from "./artifacts.js";

export class AgentRunContext {
  public readonly state: AgentExecutionState;

  public status: AgentStatus = "succeeded";
  public commitSha: string | undefined;
  public errorMessage: string | undefined;
  public watchdogMetadata: WatchdogMetadata | undefined;
  private warnings: string[] = [];
  private failFast: SandboxFailFastInfo | undefined;
  private completedAt: string | undefined;
  private startedAt: string;
  private readonly runId: string;
  private readonly agent: AgentDefinition;
  private artifactState: AgentArtifactState;

  constructor(params: {
    agent: AgentDefinition;
    runId: string;
    startedAt: string;
  }) {
    this.agent = params.agent;
    this.runId = params.runId;
    this.startedAt = params.startedAt;
    this.state = {
      diffAttempted: false,
      diffCaptured: false,
      diffStatistics: undefined,
      tokenUsage: undefined,
      tokenUsageResult: buildUnavailableTokenUsageResult({
        provider: params.agent.provider,
        modelId: params.agent.model,
      }),
    };
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
    if (result.warnings && result.warnings.length > 0) {
      this.warnings = [...new Set([...this.warnings, ...result.warnings])];
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

  public markChatArtifact(format: ChatArtifactFormat): void {
    this.artifactState.chatCaptured = true;
    this.artifactState.chatFormat = format;
  }

  public setWatchdogMetadata(metadata: WatchdogMetadata): void {
    this.watchdogMetadata = metadata;
  }

  public setFailFastTriggered(info: SandboxFailFastInfo): void {
    this.failFast = info;
  }

  public setTokenUsageResult(result: TokenUsageResult): void {
    this.state.tokenUsageResult = result;
    this.state.tokenUsage = resolveTokenUsage(result);
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
      diffStatistics: this.state.diffStatistics,
      tokenUsage: this.state.tokenUsage,
      watchdog: this.watchdogMetadata,
      warnings: this.warnings,
      failFast: this.failFast,
    });

    return finalizeAgentResult(this.runId, record, this.state);
  }

  /**
   * Build an early failure record for immediate UI surfacing when watchdog triggers.
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
      diffStatistics: undefined,
      tokenUsage: this.state.tokenUsage,
      watchdog: this.watchdogMetadata,
      warnings: this.warnings,
      failFast: this.failFast,
    });
  }
}

function buildAgentRecord(options: {
  agent: AgentDefinition;
  commitSha: string | undefined;
  completedAt: string;
  errorMessage: string | undefined;
  startedAt: string;
  status: AgentStatus;
  artifacts: AgentArtifactState;
  diffStatistics?: string;
  tokenUsage?: ExtractedTokenUsage;
  watchdog?: WatchdogMetadata;
  warnings?: string[];
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
    diffStatistics,
    tokenUsage,
    watchdog,
    warnings,
    failFast,
  } = options;

  const artifactState =
    Object.keys(artifacts).length > 0 ? artifacts : undefined;
  const normalizedDiffStatistics = normalizeDiffStatistics(diffStatistics);

  const record: AgentInvocationRecord = {
    agentId: agent.id,
    model: agent.model,
    startedAt,
    completedAt,
    status,
    commitSha,
    artifacts: artifactState,
    error: errorMessage,
    tokenUsage,
    watchdog,
    ...(warnings && warnings.length > 0 ? { warnings: [...warnings] } : {}),
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
