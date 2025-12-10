import type { AgentDefinition } from "../../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../../configs/environment/types.js";
import type { EvalDefinition } from "../../../configs/evals/types.js";
import type { AgentInvocationRecord } from "../../../records/types.js";
import type { AgentWorkspacePaths } from "../../../workspace/layout.js";
import type { AgentExecutionResult } from "../reports.js";
import type { StagedAuthContext } from "./auth-stage.js";
import { AgentRunContext } from "./run-context.js";

export interface AgentExecutionContext {
  agent: AgentDefinition;
  baseRevisionSha: string;
  runId: string;
  root: string;
  evalPlan: readonly EvalDefinition[];
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
  workspacePaths: AgentWorkspacePaths;
  runtimeManifestPath: string;
  baseRevisionSha: string;
  root: string;
  runId: string;
  evalPlan: readonly EvalDefinition[];
  environment: EnvironmentConfig;
  manifestEnv: Record<string, string>;
  progress?: AgentProgressCallbacks;
  authContext?: StagedAuthContext;
}

export type AgentPreparationOutcome =
  | { status: "ready"; prepared: PreparedAgentExecution }
  | { status: "failed"; result: AgentExecutionResult };

export interface AgentPreparationResult {
  ready: PreparedAgentExecution[];
  failures: AgentExecutionResult[];
}
