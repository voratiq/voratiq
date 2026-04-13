import { verifyAgentProviders } from "../agents/runtime/auth.js";
import type { PreflightIssue } from "../competition/shared/preflight.js";
import { loadAgentCatalogDiagnostics } from "../configs/agents/loader.js";
import type { AgentDefinition } from "../configs/agents/types.js";
import { collectSettingsPreflightIssues } from "./settings.js";

export interface CollectConfiguredAgentReadinessInput {
  readonly root: string;
  readonly resolvedAgentIds?: readonly string[];
  readonly includeSettings?: boolean;
}

export interface ConfiguredAgentReadinessResult {
  readonly agents: readonly AgentDefinition[];
  readonly issues: readonly PreflightIssue[];
  readonly preProviderIssueCount: number;
  readonly noAgentsEnabled: boolean;
}

export interface CollectResolvedAgentReadinessInput {
  readonly root: string;
  readonly agents: readonly AgentDefinition[];
  readonly includeSettings?: boolean;
}

export interface ResolvedAgentReadinessResult {
  readonly issues: readonly PreflightIssue[];
  readonly preProviderIssueCount: number;
}

export async function collectConfiguredAgentReadiness(
  input: CollectConfiguredAgentReadinessInput,
): Promise<ConfiguredAgentReadinessResult> {
  const { root, resolvedAgentIds, includeSettings = true } = input;
  const catalogDiagnostics = loadAgentCatalogDiagnostics({ root });
  const settingsIssues = includeSettings
    ? [...collectSettingsPreflightIssues(root)]
    : [];

  if (resolvedAgentIds) {
    if (resolvedAgentIds.length === 0) {
      return {
        agents: [],
        issues: settingsIssues,
        preProviderIssueCount: settingsIssues.length,
        noAgentsEnabled: true,
      };
    }

    const selectedAgentIds = new Set(resolvedAgentIds);
    const catalogById = new Map(
      catalogDiagnostics.catalog.map((agent) => [agent.id, agent]),
    );
    const agents = resolvedAgentIds.flatMap((agentId) => {
      const agent = catalogById.get(agentId);
      return agent ? [agent] : [];
    });
    const catalogIssues = catalogDiagnostics.issues.filter((issue) =>
      selectedAgentIds.has(issue.agentId),
    );

    const readiness = await collectResolvedAgentReadiness({
      root,
      agents,
      includeSettings,
    });

    return {
      agents,
      issues: [...catalogIssues, ...readiness.issues],
      preProviderIssueCount:
        catalogIssues.length + readiness.preProviderIssueCount,
      noAgentsEnabled: false,
    };
  }

  if (catalogDiagnostics.enabledAgents.length === 0) {
    return {
      agents: [],
      issues: settingsIssues,
      preProviderIssueCount: settingsIssues.length,
      noAgentsEnabled: true,
    };
  }

  const readiness = await collectResolvedAgentReadiness({
    root,
    agents: catalogDiagnostics.catalog,
    includeSettings,
  });

  return {
    agents: catalogDiagnostics.catalog,
    issues: [...catalogDiagnostics.issues, ...readiness.issues],
    preProviderIssueCount:
      catalogDiagnostics.issues.length + readiness.preProviderIssueCount,
    noAgentsEnabled: false,
  };
}

export async function collectResolvedAgentReadiness(
  input: CollectResolvedAgentReadinessInput,
): Promise<ResolvedAgentReadinessResult> {
  const { root, agents, includeSettings = true } = input;
  const preProviderIssues = includeSettings
    ? [...collectSettingsPreflightIssues(root)]
    : [];
  const providerIssues = await verifyAgentProviders(
    agents.map((agent) => ({
      id: agent.id,
      provider: agent.provider,
    })),
  );

  return {
    issues: [...preProviderIssues, ...providerIssues],
    preProviderIssueCount: preProviderIssues.length,
  };
}
