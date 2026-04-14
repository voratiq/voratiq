import type { PreflightIssue } from "../competition/shared/preflight.js";
import type { AgentDefinition } from "../configs/agents/types.js";
import type { EnvironmentConfig } from "../configs/environment/types.js";
import {
  collectConfiguredAgentReadiness,
  collectResolvedAgentReadiness,
} from "./agents.js";
import { loadOperatorEnvironment } from "./environment.js";

export interface PrepareConfiguredOperatorReadinessInput {
  readonly root: string;
  readonly resolvedAgentIds?: readonly string[];
  readonly includeSettings?: boolean;
  readonly includeEnvironment?: boolean;
  readonly environmentErrorMode?: "raw" | "workspace-missing";
}

export interface PreparedConfiguredOperatorReadiness {
  readonly agents: readonly AgentDefinition[];
  readonly issues: readonly PreflightIssue[];
  readonly preProviderIssueCount: number;
  readonly noAgentsEnabled: boolean;
  readonly environment?: EnvironmentConfig;
}

export interface PrepareResolvedOperatorReadinessInput {
  readonly root: string;
  readonly agents: readonly AgentDefinition[];
  readonly includeSettings?: boolean;
  readonly includeEnvironment?: boolean;
  readonly environmentErrorMode?: "raw" | "workspace-missing";
}

export interface PreparedResolvedOperatorReadiness {
  readonly agents: readonly AgentDefinition[];
  readonly issues: readonly PreflightIssue[];
  readonly preProviderIssueCount: number;
  readonly environment?: EnvironmentConfig;
}

export async function prepareConfiguredOperatorReadiness(
  input: PrepareConfiguredOperatorReadinessInput,
): Promise<PreparedConfiguredOperatorReadiness> {
  const {
    root,
    resolvedAgentIds,
    includeSettings = true,
    includeEnvironment = false,
    environmentErrorMode = "raw",
  } = input;

  const readiness = await collectConfiguredAgentReadiness({
    root,
    resolvedAgentIds,
    includeSettings,
  });
  const environment = includeEnvironment
    ? loadOperatorEnvironment({
        root,
        errorMode: environmentErrorMode,
      })
    : undefined;

  return {
    ...readiness,
    ...(environment ? { environment } : {}),
  };
}

export async function prepareResolvedOperatorReadiness(
  input: PrepareResolvedOperatorReadinessInput,
): Promise<PreparedResolvedOperatorReadiness> {
  const {
    root,
    agents,
    includeSettings = true,
    includeEnvironment = false,
    environmentErrorMode = "raw",
  } = input;

  const readiness = await collectResolvedAgentReadiness({
    root,
    agents,
    includeSettings,
  });
  const environment = includeEnvironment
    ? loadOperatorEnvironment({
        root,
        errorMode: environmentErrorMode,
      })
    : undefined;

  return {
    agents,
    issues: readiness.issues,
    preProviderIssueCount: readiness.preProviderIssueCount,
    ...(environment ? { environment } : {}),
  };
}
