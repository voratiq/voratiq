import { readFile } from "node:fs/promises";

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
import {
  buildEvalDefinitions,
  loadEvalConfig,
} from "../../configs/evals/loader.js";
import type { EvalDefinition } from "../../configs/evals/types.js";
import { loadRepoSettings } from "../../configs/settings/loader.js";
import { RunOptionValidationError } from "../../runs/records/errors.js";
import { toErrorMessage } from "../../utils/errors.js";
import { getHeadRevision } from "../../utils/git.js";
import { WorkspaceMissingEntryError } from "../../workspace/errors.js";
import { resolveEffectiveMaxParallel } from "../shared/max-parallel.js";
import {
  NoAgentsEnabledError,
  type PreflightIssue,
  RunPreflightError,
} from "./errors.js";

export interface ValidationInput {
  readonly root: string;
  readonly specAbsolutePath: string;
  readonly resolvedAgentIds?: readonly string[];
  readonly maxParallel?: number;
}

export interface ValidationResult {
  readonly specContent: string;
  readonly baseRevisionSha: string;
  readonly agents: readonly AgentDefinition[];
  readonly evalPlan: readonly EvalDefinition[];
  readonly effectiveMaxParallel: number;
  readonly environment: EnvironmentConfig;
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

  const specContent = await readFile(specAbsolutePath, "utf8");

  const baseRevisionSha = await getHeadRevision(root);
  const preflightIssues: PreflightIssue[] = [];
  let agents: readonly AgentDefinition[];
  if (resolvedAgentIds) {
    if (resolvedAgentIds.length === 0) {
      throw new NoAgentsEnabledError();
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
      throw new NoAgentsEnabledError();
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

  const providerIssues = await verifyAgentProviders(
    agents.map((agent) => ({
      id: agent.id,
      provider: agent.provider,
    })),
  );

  preflightIssues.push(...providerIssues);
  if (preflightIssues.length > 0) {
    throw new RunPreflightError(preflightIssues);
  }

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

  const evalConfig = loadEvalConfig({ root });
  const evalPlan = buildEvalDefinitions(evalConfig);

  const effectiveMaxParallel = resolveEffectiveMaxParallel({
    competitorCount: agents.length,
    requestedMaxParallel,
  });

  return {
    specContent,
    baseRevisionSha,
    agents,
    evalPlan,
    effectiveMaxParallel,
    environment,
  };
}
