import type { AgentPreset } from "../../configs/agents/defaults.js";
import type { CreateWorkspaceResult } from "../../workspace/types.js";
import type { AgentInitSummary } from "../init/types.js";

export interface SyncCommandInput {
  root: string;
}

export interface SyncOrchestrationSummary {
  configPath: string;
  configCreated: boolean;
  configUpdated: boolean;
  skippedCustomized: boolean;
  managed: boolean;
  preset: AgentPreset;
}

export interface SyncCommandResult {
  workspaceBootstrapped: boolean;
  workspaceResult?: CreateWorkspaceResult;
  agentSummary: AgentInitSummary;
  orchestrationSummary: SyncOrchestrationSummary;
}
