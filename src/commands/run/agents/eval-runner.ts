import type { EnvironmentConfig } from "../../../configs/environment/types.js";
import type {
  AgentEvalResult,
  EvalDefinition,
} from "../../../configs/evals/types.js";
import { executeEvaluations } from "../../../evals/runner.js";
import type { SandboxPersona } from "../../../workspace/agents.js";
import {
  type ArtifactCollectionResult,
  collectAgentArtifacts,
} from "./artifacts.js";
import type { RunAgentWorkspacePaths } from "./workspace.js";

export interface EvalRunInput {
  evalPlan: readonly EvalDefinition[];
  workspacePaths: RunAgentWorkspacePaths;
  baseRevisionSha: string;
  root: string;
  manifestEnv: Record<string, string>;
  environment: EnvironmentConfig;
  persona: SandboxPersona;
}

export interface EvalRunResult {
  artifacts: ArtifactCollectionResult;
  evaluations: AgentEvalResult[];
  warnings: string[];
}

export async function runPostProcessingAndEvaluations(
  input: EvalRunInput,
): Promise<EvalRunResult> {
  const {
    evalPlan,
    workspacePaths,
    baseRevisionSha,
    root,
    manifestEnv,
    environment,
    persona,
  } = input;

  const artifacts = await collectAgentArtifacts({
    baseRevisionSha,
    workspacePaths,
    root,
    environment,
    persona,
  });

  const evalOutcome = await executeEvaluations({
    evaluations: evalPlan,
    cwd: workspacePaths.workspacePath,
    root,
    logsDirectory: workspacePaths.evalsDirPath,
    env: manifestEnv,
    environment,
  });

  return {
    artifacts,
    evaluations: evalOutcome.results,
    warnings: evalOutcome.warnings,
  };
}
