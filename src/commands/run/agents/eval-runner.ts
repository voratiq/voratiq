import type { EnvironmentConfig } from "../../../configs/environment/types.js";
import type {
  AgentEvalResult,
  EvalDefinition,
} from "../../../configs/evals/types.js";
import { executeEvaluations } from "../../../evals/runner.js";
import {
  type ArtifactCollectionResult,
  collectAgentArtifacts,
  type SandboxPersona,
} from "../../../workspace/agents.js";
import type { AgentWorkspacePaths } from "../../../workspace/layout.js";

export interface EvalRunInput {
  evalPlan: readonly EvalDefinition[];
  workspacePaths: AgentWorkspacePaths;
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
    workspacePath: workspacePaths.workspacePath,
    summaryPath: workspacePaths.summaryPath,
    diffPath: workspacePaths.diffPath,
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
