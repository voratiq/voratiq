import { rm } from "node:fs/promises";

import { WorkspaceSetupRunError } from "../commands/run/errors.js";
import type { AgentId } from "../configs/agents/types.js";
import type { EnvironmentConfig } from "../configs/environment/types.js";
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

export async function prepareAgentWorkspace(options: {
  paths: AgentWorkspacePaths;
  baseRevisionSha: string;
  root: string;
  agentId: AgentId;
  runId: string;
  environment: EnvironmentConfig;
}): Promise<void> {
  const { paths, baseRevisionSha, root, agentId, runId, environment } = options;

  try {
    await scaffoldAgentWorkspace(paths);
    await rm(resolvePath(paths.agentRoot, "tmp"), {
      recursive: true,
      force: true,
    }).catch(() => {});
  } catch (error) {
    throw ensureWorkspaceError(error);
  }

  try {
    await createWorktree({
      root,
      worktreePath: paths.workspacePath,
      branch: `voratiq/run/${runId}/${agentId}`,
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

export function ensureWorkspaceError(error: unknown): WorkspaceSetupRunError {
  if (error instanceof WorkspaceSetupError) {
    return new WorkspaceSetupRunError(error.detail, {
      detailLines: error.detailLines,
      hintLines: error.hintLines,
    });
  }
  return new WorkspaceSetupRunError(toErrorMessage(error));
}
