import { rm } from "node:fs/promises";

import type { SandboxStageId } from "../agents/runtime/policy.js";
import type { AgentId } from "../configs/agents/types.js";
import type { EnvironmentConfig } from "../configs/environment/types.js";
import { WorkspaceSetupRunError } from "../domain/run/competition/errors.js";
import { toErrorMessage } from "../utils/errors.js";
import { createWorktree } from "../utils/git.js";
import { resolvePath } from "../utils/path.js";
import { ensureWorkspaceDependencies } from "./dependencies.js";
import { WorkspaceSetupError } from "./errors.js";
import { type AgentWorkspacePaths, scaffoldAgentWorkspace } from "./layout.js";
import { ensureWorkspaceShim } from "./shim.js";

export interface SandboxPersona {
  authorName: string;
  authorEmail: string;
}

export async function prepareScratchAgentWorkspace(options: {
  paths: AgentWorkspacePaths;
}): Promise<void> {
  const { paths } = options;

  try {
    await scaffoldAgentWorkspace(paths);
    await rm(resolvePath(paths.agentRoot, "tmp"), {
      recursive: true,
      force: true,
    }).catch(() => {});
  } catch (error) {
    throw ensureWorkspaceError(error);
  }
}

export async function prepareStageAgentWorkspace(options: {
  paths: AgentWorkspacePaths;
  baseRevisionSha: string;
  root: string;
  agentId: AgentId;
  sessionId: string;
  stageId: SandboxStageId;
  environment: EnvironmentConfig;
}): Promise<void> {
  const {
    paths,
    baseRevisionSha,
    root,
    agentId,
    sessionId,
    stageId,
    environment,
  } = options;

  await prepareScratchAgentWorkspace({ paths });

  try {
    await createWorktree({
      root,
      worktreePath: paths.workspacePath,
      branch: `voratiq/${stageId}/${sessionId}/${agentId}`,
      baseRevision: baseRevisionSha,
    });
    await ensureWorkspaceDependencies({
      root,
      workspacePath: paths.workspacePath,
      environment,
    });
    await ensureWorkspaceShim({
      workspacePath: paths.workspacePath,
    });
  } catch (error) {
    throw ensureWorkspaceError(error);
  }
}

export async function prepareAgentWorkspace(options: {
  paths: AgentWorkspacePaths;
  baseRevisionSha: string;
  root: string;
  agentId: AgentId;
  runId: string;
  environment: EnvironmentConfig;
}): Promise<void> {
  return await prepareStageAgentWorkspace({
    paths: options.paths,
    baseRevisionSha: options.baseRevisionSha,
    root: options.root,
    agentId: options.agentId,
    sessionId: options.runId,
    stageId: "run",
    environment: options.environment,
  });
}

export function ensureWorkspaceError(error: unknown): WorkspaceSetupRunError {
  if (error instanceof WorkspaceSetupError) {
    return new WorkspaceSetupRunError(error.detail, {
      detailLines: error.detailLines,
      hintLines: error.hintLines,
    });
  }
  return new WorkspaceSetupRunError(toErrorMessage(error));
}
