import { mkdir, readFile, writeFile } from "node:fs/promises";

import { readAgentsConfig } from "../configs/agents/loader.js";
import { buildDefaultOrchestrationTemplate } from "../configs/orchestration/bootstrap.js";
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
  VORATIQ_ORCHESTRATION_FILE,
  VORATIQ_REDUCTIONS_DIR,
  VORATIQ_REDUCTIONS_FILE,
  VORATIQ_REDUCTIONS_SESSIONS_DIR,
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
  const runsDir = resolveWorkspacePath(root, VORATIQ_RUNS_DIR);
  const reductionsDir = resolveWorkspacePath(root, VORATIQ_REDUCTIONS_DIR);
  const reviewsDir = resolveWorkspacePath(root, VORATIQ_REVIEWS_DIR);
  const specsDir = resolveWorkspacePath(root, VORATIQ_SPECS_DIR);

  const sessionsDir = resolveWorkspacePath(root, VORATIQ_RUNS_SESSIONS_DIR);
  const reductionSessionsDir = resolveWorkspacePath(
    root,
    VORATIQ_REDUCTIONS_SESSIONS_DIR,
  );
  const reviewSessionsDir = resolveWorkspacePath(
    root,
    VORATIQ_REVIEWS_SESSIONS_DIR,
  );
  const specSessionsDir = resolveWorkspacePath(
    root,
    VORATIQ_SPECS_SESSIONS_DIR,
  );

  const runsIndexPath = resolveWorkspacePath(root, VORATIQ_RUNS_FILE);
  const reductionsIndexPath = resolveWorkspacePath(
    root,
    VORATIQ_REDUCTIONS_FILE,
  );
  const reviewsIndexPath = resolveWorkspacePath(root, VORATIQ_REVIEWS_FILE);
  const specsIndexPath = resolveWorkspacePath(root, VORATIQ_SPECS_FILE);

  const agentsConfigPath = resolveWorkspacePath(root, VORATIQ_AGENTS_FILE);
  const evalsConfigPath = resolveWorkspacePath(root, VORATIQ_EVALS_FILE);
  const environmentConfigPath = resolveWorkspacePath(
    root,
    VORATIQ_ENVIRONMENT_FILE,
  );
  const sandboxConfigPath = resolveWorkspacePath(root, VORATIQ_SANDBOX_FILE);
  const orchestrationConfigPath = resolveWorkspacePath(
    root,
    VORATIQ_ORCHESTRATION_FILE,
  );

  const [
    workspaceExists,
    runsExists,
    reductionsExists,
    reviewsExists,
    specsExists,
    runsSessionsExists,
    reductionsSessionsExists,
    reviewsSessionsExists,
    specsSessionsExists,
    runsIndexExists,
    reductionsIndexExists,
    reviewsIndexExists,
    specsIndexExists,
    agentsConfigExists,
    evalsConfigExists,
    environmentConfigExists,
    sandboxConfigExists,
    orchestrationConfigExists,
  ] = await Promise.all([
    pathExists(workspaceDir),
    pathExists(runsDir),
    pathExists(reductionsDir),
    pathExists(reviewsDir),
    pathExists(specsDir),
    pathExists(sessionsDir),
    pathExists(reductionSessionsDir),
    pathExists(reviewSessionsDir),
    pathExists(specSessionsDir),
    pathExists(runsIndexPath),
    pathExists(reductionsIndexPath),
    pathExists(reviewsIndexPath),
    pathExists(specsIndexPath),
    pathExists(agentsConfigPath),
    pathExists(evalsConfigPath),
    pathExists(environmentConfigPath),
    pathExists(sandboxConfigPath),
    pathExists(orchestrationConfigPath),
  ]);

  if (!workspaceExists) {
    await mkdir(workspaceDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, workspaceDir));
  }

  if (!runsExists) {
    await mkdir(runsDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, runsDir));
  }

  if (!reductionsExists) {
    await mkdir(reductionsDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, reductionsDir));
  }

  if (!reviewsExists) {
    await mkdir(reviewsDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, reviewsDir));
  }

  if (!specsExists) {
    await mkdir(specsDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, specsDir));
  }

  if (!runsSessionsExists) {
    await mkdir(sessionsDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, sessionsDir));
  }

  if (!reductionsSessionsExists) {
    await mkdir(reductionSessionsDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, reductionSessionsDir));
  }

  if (!reviewsSessionsExists) {
    await mkdir(reviewSessionsDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, reviewSessionsDir));
  }

  if (!specsSessionsExists) {
    await mkdir(specSessionsDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, specSessionsDir));
  }

  if (!runsIndexExists) {
    const initialIndex = JSON.stringify({ version: 2, sessions: [] }, null, 2);
    await writeFile(runsIndexPath, `${initialIndex}\n`, { encoding: "utf8" });
    createdFiles.push(relativeToRoot(root, runsIndexPath));
  }

  if (!reductionsIndexExists) {
    const initialIndex = JSON.stringify({ version: 1, sessions: [] }, null, 2);
    await writeFile(reductionsIndexPath, `${initialIndex}\n`, {
      encoding: "utf8",
    });
    createdFiles.push(relativeToRoot(root, reductionsIndexPath));
  }

  if (!reviewsIndexExists) {
    const initialIndex = JSON.stringify({ version: 1, sessions: [] }, null, 2);
    await writeFile(reviewsIndexPath, `${initialIndex}\n`, {
      encoding: "utf8",
    });
    createdFiles.push(relativeToRoot(root, reviewsIndexPath));
  }

  if (!specsIndexExists) {
    const initialIndex = JSON.stringify({ version: 1, sessions: [] }, null, 2);
    await writeFile(specsIndexPath, `${initialIndex}\n`, { encoding: "utf8" });
    createdFiles.push(relativeToRoot(root, specsIndexPath));
  }

  if (!agentsConfigExists) {
    const agentsTemplate = buildDefaultAgentsTemplate();
    await writeFile(agentsConfigPath, agentsTemplate, { encoding: "utf8" });
    createdFiles.push(relativeToRoot(root, agentsConfigPath));
  }

  if (!evalsConfigExists) {
    const evalsTemplate = buildDefaultEvalsTemplate();
    await writeFile(evalsConfigPath, evalsTemplate, { encoding: "utf8" });
    createdFiles.push(relativeToRoot(root, evalsConfigPath));
  }

  if (!environmentConfigExists) {
    const environmentTemplate = buildDefaultEnvironmentTemplate();
    await writeFile(environmentConfigPath, environmentTemplate, {
      encoding: "utf8",
    });
    createdFiles.push(relativeToRoot(root, environmentConfigPath));
  }

  if (!sandboxConfigExists) {
    const sandboxTemplate = buildDefaultSandboxTemplate();
    await writeFile(sandboxConfigPath, sandboxTemplate, {
      encoding: "utf8",
    });
    createdFiles.push(relativeToRoot(root, sandboxConfigPath));
  }

  if (!orchestrationConfigExists) {
    const agentsContent = await readFile(agentsConfigPath, "utf8");
    const agentsConfig = readAgentsConfig(agentsContent);
    const orchestrationTemplate =
      buildDefaultOrchestrationTemplate(agentsConfig);
    await writeFile(orchestrationConfigPath, orchestrationTemplate, {
      encoding: "utf8",
    });
    createdFiles.push(relativeToRoot(root, orchestrationConfigPath));
  }

  return { createdDirectories, createdFiles };
}

export async function validateWorkspace(root: string): Promise<void> {
  const workspaceDir = resolveWorkspacePath(root);
  const runsDir = resolveWorkspacePath(root, VORATIQ_RUNS_DIR);
  const reductionsDir = resolveWorkspacePath(root, VORATIQ_REDUCTIONS_DIR);
  const reviewsDir = resolveWorkspacePath(root, VORATIQ_REVIEWS_DIR);
  const specsDir = resolveWorkspacePath(root, VORATIQ_SPECS_DIR);
  const sessionsDir = resolveWorkspacePath(root, VORATIQ_RUNS_SESSIONS_DIR);
  const reductionSessionsDir = resolveWorkspacePath(
    root,
    VORATIQ_REDUCTIONS_SESSIONS_DIR,
  );
  const reviewSessionsDir = resolveWorkspacePath(
    root,
    VORATIQ_REVIEWS_SESSIONS_DIR,
  );
  const specSessionsDir = resolveWorkspacePath(
    root,
    VORATIQ_SPECS_SESSIONS_DIR,
  );
  const runsIndexPath = resolveWorkspacePath(root, VORATIQ_RUNS_FILE);
  const reductionsIndexPath = resolveWorkspacePath(
    root,
    VORATIQ_REDUCTIONS_FILE,
  );
  const reviewsIndexPath = resolveWorkspacePath(root, VORATIQ_REVIEWS_FILE);
  const specsIndexPath = resolveWorkspacePath(root, VORATIQ_SPECS_FILE);
  const agentsConfigPath = resolveWorkspacePath(root, VORATIQ_AGENTS_FILE);
  const evalsConfigPath = resolveWorkspacePath(root, VORATIQ_EVALS_FILE);
  const environmentConfigPath = resolveWorkspacePath(
    root,
    VORATIQ_ENVIRONMENT_FILE,
  );
  const sandboxConfigPath = resolveWorkspacePath(root, VORATIQ_SANDBOX_FILE);
  const orchestrationConfigPath = resolveWorkspacePath(
    root,
    VORATIQ_ORCHESTRATION_FILE,
  );

  if (!(await isDirectory(workspaceDir))) {
    const missingEntries = [
      `${relativeToRoot(root, workspaceDir)}/`,
      `${relativeToRoot(root, runsDir)}/`,
      `${relativeToRoot(root, reductionsDir)}/`,
      `${relativeToRoot(root, reviewsDir)}/`,
      `${relativeToRoot(root, specsDir)}/`,
      `${relativeToRoot(root, sessionsDir)}/`,
      `${relativeToRoot(root, reductionSessionsDir)}/`,
      `${relativeToRoot(root, reviewSessionsDir)}/`,
      `${relativeToRoot(root, specSessionsDir)}/`,
      relativeToRoot(root, runsIndexPath),
      relativeToRoot(root, reductionsIndexPath),
      relativeToRoot(root, reviewsIndexPath),
      relativeToRoot(root, specsIndexPath),
      relativeToRoot(root, agentsConfigPath),
      relativeToRoot(root, environmentConfigPath),
      relativeToRoot(root, sandboxConfigPath),
      relativeToRoot(root, orchestrationConfigPath),
    ];
    throw new WorkspaceNotInitializedError(missingEntries);
  }

  await ensureDirectoryExists(
    runsDir,
    () => new WorkspaceMissingEntryError(relativeToRoot(root, runsDir)),
  );

  await ensureDirectoryExists(
    reductionsDir,
    () => new WorkspaceMissingEntryError(relativeToRoot(root, reductionsDir)),
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
    reductionSessionsDir,
    () =>
      new WorkspaceMissingEntryError(
        relativeToRoot(root, reductionSessionsDir),
      ),
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
    reductionsIndexPath,
    () =>
      new WorkspaceMissingEntryError(relativeToRoot(root, reductionsIndexPath)),
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

  await ensureFileExists(
    orchestrationConfigPath,
    () =>
      new WorkspaceMissingEntryError(
        relativeToRoot(root, orchestrationConfigPath),
      ),
  );
}
