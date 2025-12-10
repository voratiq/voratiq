import { readFile } from "node:fs/promises";

import { loadAgentCatalog } from "../../configs/agents/loader.js";
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
import { RunOptionValidationError } from "../../records/errors.js";
import { getHeadRevision } from "../../utils/git.js";
import { WorkspaceMissingEntryError } from "../../workspace/errors.js";
import { verifyAgentProviders } from "./agents/auth-stage.js";
import { NoAgentsEnabledError } from "./errors.js";
import { buildAgentPrompt } from "./prompts.js";

export interface ValidationInput {
  readonly root: string;
  readonly specAbsolutePath: string;
  readonly maxParallel?: number;
}

export interface ValidationResult {
  readonly prompt: string;
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
  const { root, specAbsolutePath, maxParallel: requestedMaxParallel } = input;

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
  const prompt = buildAgentPrompt({ specContent });

  const baseRevisionSha = await getHeadRevision(root);
  const agents = loadAgentCatalog({ root });

  if (agents.length === 0) {
    throw new NoAgentsEnabledError();
  }

  await verifyAgentProviders(agents);

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

  const effectiveMaxParallel = resolveMaxParallel(agents, requestedMaxParallel);

  return {
    prompt,
    baseRevisionSha,
    agents,
    evalPlan,
    effectiveMaxParallel,
    environment,
  };
}

function resolveMaxParallel(
  agents: readonly AgentDefinition[],
  requestedMaxParallel: number | undefined,
): number {
  const agentCount = agents.length;
  if (agentCount === 0) {
    return 0;
  }
  const resolvedInput =
    requestedMaxParallel !== undefined ? requestedMaxParallel : agentCount;
  return Math.min(agentCount, Math.max(1, resolvedInput));
}
