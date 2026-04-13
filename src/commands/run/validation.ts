import { verifyAgentProviders } from "../../agents/runtime/auth.js";
import { loadAgentCatalogDiagnostics } from "../../configs/agents/loader.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import {
  EnvironmentConfigParseError,
  MissingEnvironmentConfigError,
} from "../../configs/environment/errors.js";
import {
  DEFAULT_ENVIRONMENT_FILE_DISPLAY,
  loadEnvironmentConfig,
} from "../../configs/environment/loader.js";
import type { EnvironmentConfig } from "../../configs/environment/types.js";
import { loadRepoSettings } from "../../configs/settings/loader.js";
import {
  NoAgentsEnabledError,
  type PreflightIssue,
  RunPreflightError,
} from "../../domain/run/competition/errors.js";
import { RunOptionValidationError } from "../../domain/run/model/errors.js";
import type { RunSpecTarget } from "../../domain/run/model/types.js";
import { toErrorMessage } from "../../utils/errors.js";
import { getHeadRevision } from "../../utils/git.js";
import { WorkspaceMissingEntryError } from "../../workspace/errors.js";
import { resolveEffectiveMaxParallel } from "../shared/max-parallel.js";
import { loadRunSpecInput } from "./spec-provenance.js";

export interface ValidationInput {
  readonly root: string;
  readonly specAbsolutePath: string;
  readonly specDisplayPath?: string;
  readonly specsFilePath?: string;
  readonly resolvedAgentIds?: readonly string[];
  readonly maxParallel?: number;
}

export interface ValidationResult {
  readonly specContent: string;
  readonly specTarget: RunSpecTarget;
  readonly baseRevisionSha: string;
  readonly agents: readonly AgentDefinition[];
  readonly effectiveMaxParallel: number;
  readonly environment: EnvironmentConfig;
}

export interface RunPreflightDiagnosticsInput {
  readonly root: string;
  readonly resolvedAgentIds?: readonly string[];
}

export interface RunPreflightDiagnosticsResult {
  readonly agents: readonly AgentDefinition[];
  readonly issues: readonly PreflightIssue[];
  readonly preProviderIssueCount: number;
  readonly noAgentsEnabled: boolean;
}

/**
 * Validate command parameters, load spec, and prepare execution prerequisites.
 */
export async function validateAndPrepare(
  input: ValidationInput,
): Promise<ValidationResult> {
  const {
    root,
    specAbsolutePath,
    specDisplayPath,
    specsFilePath,
    resolvedAgentIds,
    maxParallel: requestedMaxParallel,
  } = input;

  if (
    requestedMaxParallel !== undefined &&
    (!Number.isInteger(requestedMaxParallel) || requestedMaxParallel <= 0)
  ) {
    throw new RunOptionValidationError(
      "maxParallel",
      "must be a positive integer",
    );
  }

  const { specContent, specTarget } = await loadRunSpecInput({
    root,
    specAbsolutePath,
    specDisplayPath: specDisplayPath ?? specAbsolutePath,
    specsFilePath,
  });

  const baseRevisionSha = await getHeadRevision(root);
  const preflight = await collectRunPreflightDiagnostics({
    root,
    resolvedAgentIds,
  });
  if (preflight.noAgentsEnabled) {
    throw new NoAgentsEnabledError();
  }

  if (preflight.issues.length > 0) {
    throw new RunPreflightError(
      preflight.issues,
      preflight.preProviderIssueCount === 0 ? [] : undefined,
    );
  }
  const agents = preflight.agents;

  const environment = (() => {
    try {
      return loadEnvironmentConfig({ root });
    } catch (error) {
      if (
        error instanceof MissingEnvironmentConfigError ||
        error instanceof EnvironmentConfigParseError
      ) {
        throw new WorkspaceMissingEntryError(DEFAULT_ENVIRONMENT_FILE_DISPLAY);
      }
      throw error;
    }
  })();

  const effectiveMaxParallel = resolveEffectiveMaxParallel({
    competitorCount: agents.length,
    requestedMaxParallel,
  });

  return {
    specContent,
    specTarget,
    baseRevisionSha,
    agents,
    effectiveMaxParallel,
    environment,
  };
}

export async function collectRunPreflightDiagnostics(
  input: RunPreflightDiagnosticsInput,
): Promise<RunPreflightDiagnosticsResult> {
  const { root, resolvedAgentIds } = input;

  const preflightIssues: PreflightIssue[] = [];
  let agents: readonly AgentDefinition[] = [];

  if (resolvedAgentIds) {
    if (resolvedAgentIds.length === 0) {
      return {
        agents: [],
        issues: [],
        preProviderIssueCount: 0,
        noAgentsEnabled: true,
      };
    }

    const selectedAgentIds = new Set(resolvedAgentIds);
    const agentDiagnostics = loadAgentCatalogDiagnostics({ root });
    preflightIssues.push(
      ...agentDiagnostics.issues.filter((issue) =>
        selectedAgentIds.has(issue.agentId),
      ),
    );

    const catalogById = new Map(
      agentDiagnostics.catalog.map((agent) => [agent.id, agent]),
    );
    agents = resolvedAgentIds.flatMap((agentId) => {
      const agent = catalogById.get(agentId);
      return agent ? [agent] : [];
    });
  } else {
    const agentDiagnostics = loadAgentCatalogDiagnostics({ root });
    const enabledAgents = agentDiagnostics.enabledAgents;

    if (enabledAgents.length === 0) {
      return {
        agents: [],
        issues: [],
        preProviderIssueCount: 0,
        noAgentsEnabled: true,
      };
    }

    preflightIssues.push(...agentDiagnostics.issues);
    agents = agentDiagnostics.catalog;
  }

  try {
    loadRepoSettings({ root });
  } catch (error) {
    preflightIssues.push({
      agentId: "settings",
      message: toErrorMessage(error),
    });
  }

  const preProviderIssueCount = preflightIssues.length;
  const providerIssues = await verifyAgentProviders(
    agents.map((agent) => ({
      id: agent.id,
      provider: agent.provider,
    })),
  );
  preflightIssues.push(...providerIssues);

  return {
    agents,
    issues: preflightIssues,
    preProviderIssueCount,
    noAgentsEnabled: false,
  };
}
