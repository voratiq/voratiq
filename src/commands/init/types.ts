import type { EnvironmentConfig } from "../../configs/environment/types.js";
import type { EvalSlug } from "../../configs/evals/types.js";
import type {
  ConfirmationOptions,
  PromptOptions,
} from "../../render/interactions/confirmation.js";
import type { AgentPreset } from "../../workspace/templates.js";
import type { CreateWorkspaceResult } from "../../workspace/types.js";

export interface InitCommandInput {
  root: string;
  preset: AgentPreset;
  presetProvided?: boolean;
  onPresetResolved?: (preset: AgentPreset) => void;
  assumeYes?: boolean;
  interactive: boolean;
  confirm?: InitConfirmationHandler;
  prompt?: InitPromptHandler;
}

export interface InitCommandResult {
  preset: AgentPreset;
  workspaceResult: CreateWorkspaceResult;
  agentSummary: AgentInitSummary;
  orchestrationSummary: OrchestrationInitSummary;
  environmentSummary: EnvironmentInitSummary;
  evalSummary: EvalInitSummary;
  sandboxSummary: SandboxInitSummary;
}

export interface AgentInitSummary {
  configPath: string;
  enabledAgents: string[];
  agentCount: number;
  zeroDetections: boolean;
  detectedProviders: DetectedProviderSummary[];
  providerEnablementPrompted: boolean;
  configCreated: boolean;
  configUpdated: boolean;
}

export interface DetectedProviderSummary {
  provider: string;
  binary: string;
}

export interface EvalInitSummary {
  configPath: string;
  configuredEvals: EvalSlug[];
  configCreated: boolean;
  configUpdated: boolean;
}

export interface EnvironmentInitSummary {
  configPath: string;
  detectedEntries: string[];
  configCreated: boolean;
  configUpdated: boolean;
  config: EnvironmentConfig;
}

export interface SandboxInitSummary {
  configPath: string;
  configCreated: boolean;
}

export interface OrchestrationInitSummary {
  configPath: string;
  configCreated: boolean;
}

export type InitConfirmationHandler = (
  options: ConfirmationOptions,
) => Promise<boolean>;

export type InitPromptHandler = (options: PromptOptions) => Promise<string>;

export interface InitConfigureOptions {
  interactive: boolean;
  assumeYes?: boolean;
  confirm?: InitConfirmationHandler;
  prompt?: InitPromptHandler;
}
