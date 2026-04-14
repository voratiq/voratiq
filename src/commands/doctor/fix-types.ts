import type { EnvironmentConfig } from "../../configs/environment/types.js";
import type {
  ConfirmationOptions,
  PromptOptions,
} from "../../render/interactions/confirmation.js";
import type { AgentPreset } from "../../workspace/templates.js";
import type { CreateWorkspaceResult } from "../../workspace/types.js";

export interface DoctorBootstrapInput {
  root: string;
  preset: AgentPreset;
  presetProvided?: boolean;
  onPresetResolved?: (preset: AgentPreset) => void;
  assumeYes?: boolean;
  interactive: boolean;
  confirm?: DoctorConfirmationHandler;
  prompt?: DoctorPromptHandler;
}

export interface DoctorBootstrapResult {
  mode: "bootstrap" | "repair";
  preset: AgentPreset;
  workspaceResult: CreateWorkspaceResult;
  agentSummary: AgentInitSummary;
  orchestrationSummary: OrchestrationInitSummary;
  environmentSummary: EnvironmentInitSummary;
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
  managed: boolean;
}

export interface DetectedProviderSummary {
  provider: string;
  binary: string;
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
  configUpdated?: boolean;
}

export type DoctorConfirmationHandler = (
  options: ConfirmationOptions,
) => Promise<boolean>;

export type DoctorPromptHandler = (options: PromptOptions) => Promise<string>;

export interface DoctorBootstrapConfigureOptions {
  interactive: boolean;
  assumeYes?: boolean;
  confirm?: DoctorConfirmationHandler;
  prompt?: DoctorPromptHandler;
}

export interface DoctorReconcileInput {
  root: string;
}

export interface DoctorReconcileOrchestrationSummary {
  configPath: string;
  configCreated: boolean;
  configUpdated: boolean;
  skippedCustomized: boolean;
  managed: boolean;
  preset: AgentPreset;
}

export interface DoctorReconcileResult {
  workspaceBootstrapped: boolean;
  workspaceResult?: CreateWorkspaceResult;
  agentSummary: AgentInitSummary;
  environmentSummary: EnvironmentInitSummary;
  orchestrationSummary: DoctorReconcileOrchestrationSummary;
}
