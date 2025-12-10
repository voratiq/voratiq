import { writeCommandPreface } from "../../cli/output.js";
import { buildInitializationPrompt } from "../../render/transcripts/init.js";
import { createWorkspace } from "../../workspace/setup.js";
import {
  formatWorkspacePath,
  VORATIQ_SANDBOX_FILE,
} from "../../workspace/structure.js";
import type { CreateWorkspaceResult } from "../../workspace/types.js";
import { configureAgents } from "./agents.js";
import { configureEnvironment } from "./environment.js";
import { configureEvals } from "./evals.js";
import type {
  InitCommandInput,
  InitCommandResult,
  SandboxInitSummary,
} from "./types.js";

export async function executeInitCommand(
  input: InitCommandInput,
): Promise<InitCommandResult> {
  const { root, interactive, confirm, prompt } = input;

  const workspaceResult = await createWorkspace(root);

  const initializationPrompt = buildInitializationPrompt();
  writeCommandPreface(initializationPrompt);

  const agentSummary = await configureAgents(root, {
    interactive,
    confirm,
  });

  const environmentSummary = await configureEnvironment(root, {
    interactive,
    confirm,
    prompt,
  });

  const evalSummary = await configureEvals(
    root,
    {
      interactive,
      confirm,
    },
    environmentSummary.config,
  );

  const sandboxSummary = buildSandboxSummary(workspaceResult);

  return {
    workspaceResult,
    agentSummary,
    environmentSummary,
    evalSummary,
    sandboxSummary,
  };
}

function buildSandboxSummary(
  workspaceResult: CreateWorkspaceResult,
): SandboxInitSummary {
  const configPath = formatWorkspacePath(VORATIQ_SANDBOX_FILE);
  const normalizedCreated = workspaceResult.createdFiles.map((file) =>
    file.replace(/\\/g, "/"),
  );
  const configCreated = normalizedCreated.includes(configPath);
  return { configPath, configCreated };
}
