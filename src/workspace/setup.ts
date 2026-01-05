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
  VORATIQ_REVIEWS_DIR,
  VORATIQ_REVIEWS_FILE,
  VORATIQ_REVIEWS_SESSIONS_DIR,
  VORATIQ_RUNS_DIR,
  VORATIQ_RUNS_FILE,
  VORATIQ_RUNS_SESSIONS_DIR,
  VORATIQ_SANDBOX_FILE,
  VORATIQ_SPECS_DIR,
  VORATIQ_SPECS_FILE,
  VORATIQ_SPECS_SESSIONS_DIR,
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
  const reviewsDir = resolveWorkspacePath(root, VORATIQ_REVIEWS_DIR);
  const specsDir = resolveWorkspacePath(root, VORATIQ_SPECS_DIR);
  if (!(await pathExists(runsDir))) {
    await mkdir(runsDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, runsDir));
  }

  if (!(await pathExists(reviewsDir))) {
    await mkdir(reviewsDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, reviewsDir));
  }

  if (!(await pathExists(specsDir))) {
    await mkdir(specsDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, specsDir));
  }

  const sessionsDir = resolveWorkspacePath(root, VORATIQ_RUNS_SESSIONS_DIR);
  const reviewSessionsDir = resolveWorkspacePath(
    root,
    VORATIQ_REVIEWS_SESSIONS_DIR,
  );
  const specSessionsDir = resolveWorkspacePath(
    root,
    VORATIQ_SPECS_SESSIONS_DIR,
  );
  if (!(await pathExists(sessionsDir))) {
    await mkdir(sessionsDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, sessionsDir));
  }

  if (!(await pathExists(reviewSessionsDir))) {
    await mkdir(reviewSessionsDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, reviewSessionsDir));
  }

  if (!(await pathExists(specSessionsDir))) {
    await mkdir(specSessionsDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, specSessionsDir));
  }

  const runsIndexPath = resolveWorkspacePath(root, VORATIQ_RUNS_FILE);
  const reviewsIndexPath = resolveWorkspacePath(root, VORATIQ_REVIEWS_FILE);
  const specsIndexPath = resolveWorkspacePath(root, VORATIQ_SPECS_FILE);
  if (!(await pathExists(runsIndexPath))) {
    const initialIndex = JSON.stringify({ version: 2, sessions: [] }, null, 2);
    await writeFile(runsIndexPath, `${initialIndex}\n`, { encoding: "utf8" });
    createdFiles.push(relativeToRoot(root, runsIndexPath));
  }

  if (!(await pathExists(reviewsIndexPath))) {
    const initialIndex = JSON.stringify({ version: 1, sessions: [] }, null, 2);
    await writeFile(reviewsIndexPath, `${initialIndex}\n`, {
      encoding: "utf8",
    });
    createdFiles.push(relativeToRoot(root, reviewsIndexPath));
  }

  if (!(await pathExists(specsIndexPath))) {
    const initialIndex = JSON.stringify({ version: 1, sessions: [] }, null, 2);
    await writeFile(specsIndexPath, `${initialIndex}\n`, { encoding: "utf8" });
    createdFiles.push(relativeToRoot(root, specsIndexPath));
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
  const reviewsDir = resolveWorkspacePath(root, VORATIQ_REVIEWS_DIR);
  const specsDir = resolveWorkspacePath(root, VORATIQ_SPECS_DIR);
  const sessionsDir = resolveWorkspacePath(root, VORATIQ_RUNS_SESSIONS_DIR);
  const reviewSessionsDir = resolveWorkspacePath(
    root,
    VORATIQ_REVIEWS_SESSIONS_DIR,
  );
  const specSessionsDir = resolveWorkspacePath(
    root,
    VORATIQ_SPECS_SESSIONS_DIR,
  );
  const runsIndexPath = resolveWorkspacePath(root, VORATIQ_RUNS_FILE);
  const reviewsIndexPath = resolveWorkspacePath(root, VORATIQ_REVIEWS_FILE);
  const specsIndexPath = resolveWorkspacePath(root, VORATIQ_SPECS_FILE);
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
      `${relativeToRoot(root, reviewsDir)}/`,
      `${relativeToRoot(root, specsDir)}/`,
      `${relativeToRoot(root, sessionsDir)}/`,
      `${relativeToRoot(root, reviewSessionsDir)}/`,
      `${relativeToRoot(root, specSessionsDir)}/`,
      relativeToRoot(root, runsIndexPath),
      relativeToRoot(root, reviewsIndexPath),
      relativeToRoot(root, specsIndexPath),
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
    reviewsDir,
    () => new WorkspaceMissingEntryError(relativeToRoot(root, reviewsDir)),
  );

  await ensureDirectoryExists(
    specsDir,
    () => new WorkspaceMissingEntryError(relativeToRoot(root, specsDir)),
  );

  await ensureDirectoryExists(
    sessionsDir,
    () => new WorkspaceMissingEntryError(relativeToRoot(root, sessionsDir)),
  );

  await ensureDirectoryExists(
    reviewSessionsDir,
    () =>
      new WorkspaceMissingEntryError(relativeToRoot(root, reviewSessionsDir)),
  );

  await ensureDirectoryExists(
    specSessionsDir,
    () => new WorkspaceMissingEntryError(relativeToRoot(root, specSessionsDir)),
  );

  await ensureFileExists(
    runsIndexPath,
    () => new WorkspaceMissingEntryError(relativeToRoot(root, runsIndexPath)),
  );

  await ensureFileExists(
    reviewsIndexPath,
    () =>
      new WorkspaceMissingEntryError(relativeToRoot(root, reviewsIndexPath)),
  );

  await ensureFileExists(
    specsIndexPath,
    () => new WorkspaceMissingEntryError(relativeToRoot(root, specsIndexPath)),
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
