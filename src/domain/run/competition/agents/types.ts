import type { ResolvedExtraContextFile } from "../../../../competition/shared/extra-context.js";
import type { AgentDefinition } from "../../../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../../../configs/environment/types.js";
import type { AgentExecutionResult } from "../../../../domain/run/competition/reports.js";
import type { AgentInvocationRecord } from "../../../../domain/run/model/types.js";
import { AgentRunContext } from "./run-context.js";
import type { RunAgentWorkspacePaths } from "./workspace.js";

export interface AgentExecutionContext {
  agent: AgentDefinition;
  baseRevisionSha: string;
  runId: string;
  root: string;
  specContent: string;
  extraContextFiles: readonly ResolvedExtraContextFile[];
  environment: EnvironmentConfig;
}

export interface AgentProgressCallbacks {
  onRunning?: (record: AgentInvocationRecord) => Promise<void> | void;
  onCompleted?: (result: AgentExecutionResult) => Promise<void> | void;
  /** Callback for early failure (e.g., watchdog trigger) before process fully exits. */
  onEarlyFailure?: (record: AgentInvocationRecord) => Promise<void> | void;
}

export interface PreparedAgentExecution {
  agent: AgentDefinition;
  agentContext: AgentRunContext;
  workspacePaths: RunAgentWorkspacePaths;
  baseRevisionSha: string;
  root: string;
  runId: string;
  prompt: string;
  environment: EnvironmentConfig;
  progress?: AgentProgressCallbacks;
}

export type AgentPreparationOutcome =
  | { status: "ready"; prepared: PreparedAgentExecution }
  | { status: "failed"; result: AgentExecutionResult };

export interface AgentPreparationResult {
  ready: PreparedAgentExecution[];
  failures: AgentExecutionResult[];
}
