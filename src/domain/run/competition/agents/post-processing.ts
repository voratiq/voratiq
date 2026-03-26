import type { EnvironmentConfig } from "../../../../configs/environment/types.js";
import type { SandboxPersona } from "../../../../workspace/agents.js";
import {
  type ArtifactCollectionResult,
  collectAgentArtifacts,
} from "./artifacts.js";
import type { RunAgentWorkspacePaths } from "./workspace.js";

export interface RunPostProcessingInput {
  workspacePaths: RunAgentWorkspacePaths;
  baseRevisionSha: string;
  root: string;
  environment: EnvironmentConfig;
  persona: SandboxPersona;
}

export async function runPostProcessingAndCollectArtifacts(
  input: RunPostProcessingInput,
): Promise<ArtifactCollectionResult> {
  return await collectAgentArtifacts(input);
}
