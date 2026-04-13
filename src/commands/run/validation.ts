import type { AgentDefinition } from "../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../configs/environment/types.js";
import {
  NoAgentsEnabledError,
  RunPreflightError,
} from "../../domain/run/competition/errors.js";
import { RunOptionValidationError } from "../../domain/run/model/errors.js";
import type { RunSpecTarget } from "../../domain/run/model/types.js";
import { loadOperatorEnvironment } from "../../preflight/environment.js";
import { prepareConfiguredOperatorReadiness } from "../../preflight/operator.js";
import { getHeadRevision } from "../../utils/git.js";
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
  const preflight = await prepareConfiguredOperatorReadiness({
    root,
    resolvedAgentIds,
    includeEnvironment: false,
  });
  if (preflight.noAgentsEnabled) {
    throw new NoAgentsEnabledError();
  }

  if (preflight.issues.length > 0) {
    throw new RunPreflightError(
      preflight.issues,
      preflight.preProviderIssueCount,
    );
  }
  const agents = preflight.agents;
  const environment = loadOperatorEnvironment({
    root,
    errorMode: "workspace-missing",
  });

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
