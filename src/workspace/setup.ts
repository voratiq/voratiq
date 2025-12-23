import { mkdir, writeFile } from "node:fs/promises";

import {
  ensureDirectoryExists,
  ensureFileExists,
  isDirectory,
  pathExists,
} from "../utils/fs.js";
import { relativeToRoot } from "../utils/path.js";
import {
  WorkspaceMissingEntryError,
  WorkspaceNotInitializedError,
} from "./errors.js";
import {
  resolveWorkspacePath,
  VORATIQ_AGENTS_FILE,
  VORATIQ_ENVIRONMENT_FILE,
  VORATIQ_EVALS_FILE,
  VORATIQ_RUNS_DIR,
  VORATIQ_RUNS_FILE,
  VORATIQ_RUNS_SESSIONS_DIR,
  VORATIQ_SANDBOX_FILE,
} from "./structure.js";
import {
  buildDefaultAgentsTemplate,
  buildDefaultEnvironmentTemplate,
  buildDefaultEvalsTemplate,
  buildDefaultSandboxTemplate,
} from "./templates.js";
import type { CreateWorkspaceResult } from "./types.js";

export async function createWorkspace(
  root: string,
): Promise<CreateWorkspaceResult> {
  const createdDirectories: string[] = [];
  const createdFiles: string[] = [];

  const workspaceDir = resolveWorkspacePath(root);
  if (!(await pathExists(workspaceDir))) {
    await mkdir(workspaceDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, workspaceDir));
  }

  const runsDir = resolveWorkspacePath(root, VORATIQ_RUNS_DIR);
  if (!(await pathExists(runsDir))) {
    await mkdir(runsDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, runsDir));
  }

  const sessionsDir = resolveWorkspacePath(root, VORATIQ_RUNS_SESSIONS_DIR);
  if (!(await pathExists(sessionsDir))) {
    await mkdir(sessionsDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, sessionsDir));
  }

  const runsIndexPath = resolveWorkspacePath(root, VORATIQ_RUNS_FILE);
  if (!(await pathExists(runsIndexPath))) {
    const initialIndex = JSON.stringify({ version: 2, sessions: [] }, null, 2);
    await writeFile(runsIndexPath, `${initialIndex}\n`, { encoding: "utf8" });
    createdFiles.push(relativeToRoot(root, runsIndexPath));
  }

  const agentsConfigPath = resolveWorkspacePath(root, VORATIQ_AGENTS_FILE);
  if (!(await pathExists(agentsConfigPath))) {
    const agentsTemplate = buildDefaultAgentsTemplate();
    await writeFile(agentsConfigPath, agentsTemplate, { encoding: "utf8" });
    createdFiles.push(relativeToRoot(root, agentsConfigPath));
  }

  const evalsConfigPath = resolveWorkspacePath(root, VORATIQ_EVALS_FILE);
  if (!(await pathExists(evalsConfigPath))) {
    const evalsTemplate = buildDefaultEvalsTemplate();
    await writeFile(evalsConfigPath, evalsTemplate, { encoding: "utf8" });
    createdFiles.push(relativeToRoot(root, evalsConfigPath));
  }

  const environmentConfigPath = resolveWorkspacePath(
    root,
    VORATIQ_ENVIRONMENT_FILE,
  );
  if (!(await pathExists(environmentConfigPath))) {
    const environmentTemplate = buildDefaultEnvironmentTemplate();
    await writeFile(environmentConfigPath, environmentTemplate, {
      encoding: "utf8",
    });
    createdFiles.push(relativeToRoot(root, environmentConfigPath));
  }

  const sandboxConfigPath = resolveWorkspacePath(root, VORATIQ_SANDBOX_FILE);
  if (!(await pathExists(sandboxConfigPath))) {
    const sandboxTemplate = buildDefaultSandboxTemplate();
    await writeFile(sandboxConfigPath, sandboxTemplate, {
      encoding: "utf8",
    });
    createdFiles.push(relativeToRoot(root, sandboxConfigPath));
  }

  return { createdDirectories, createdFiles };
}

export async function validateWorkspace(root: string): Promise<void> {
  const workspaceDir = resolveWorkspacePath(root);
  const runsDir = resolveWorkspacePath(root, VORATIQ_RUNS_DIR);
  const sessionsDir = resolveWorkspacePath(root, VORATIQ_RUNS_SESSIONS_DIR);
  const runsIndexPath = resolveWorkspacePath(root, VORATIQ_RUNS_FILE);
  const agentsConfigPath = resolveWorkspacePath(root, VORATIQ_AGENTS_FILE);
  const evalsConfigPath = resolveWorkspacePath(root, VORATIQ_EVALS_FILE);
  const environmentConfigPath = resolveWorkspacePath(
    root,
    VORATIQ_ENVIRONMENT_FILE,
  );
  const sandboxConfigPath = resolveWorkspacePath(root, VORATIQ_SANDBOX_FILE);

  if (!(await isDirectory(workspaceDir))) {
    const missingEntries = [
      `${relativeToRoot(root, workspaceDir)}/`,
      `${relativeToRoot(root, runsDir)}/`,
      `${relativeToRoot(root, sessionsDir)}/`,
      relativeToRoot(root, runsIndexPath),
      relativeToRoot(root, agentsConfigPath),
      relativeToRoot(root, environmentConfigPath),
      relativeToRoot(root, sandboxConfigPath),
    ];
    throw new WorkspaceNotInitializedError(missingEntries);
  }

  await ensureDirectoryExists(
    runsDir,
    () => new WorkspaceMissingEntryError(relativeToRoot(root, runsDir)),
  );

  await ensureDirectoryExists(
    sessionsDir,
    () => new WorkspaceMissingEntryError(relativeToRoot(root, sessionsDir)),
  );

  await ensureFileExists(
    runsIndexPath,
    () => new WorkspaceMissingEntryError(relativeToRoot(root, runsIndexPath)),
  );

  await ensureFileExists(
    agentsConfigPath,
    () =>
      new WorkspaceMissingEntryError(relativeToRoot(root, agentsConfigPath)),
  );

  await ensureFileExists(
    evalsConfigPath,
    () => new WorkspaceMissingEntryError(relativeToRoot(root, evalsConfigPath)),
  );

  await ensureFileExists(
    environmentConfigPath,
    () =>
      new WorkspaceMissingEntryError(
        relativeToRoot(root, environmentConfigPath),
      ),
  );

  await ensureFileExists(
    sandboxConfigPath,
    () =>
      new WorkspaceMissingEntryError(relativeToRoot(root, sandboxConfigPath)),
  );
}
