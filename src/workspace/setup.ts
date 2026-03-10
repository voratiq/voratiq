import { mkdir, readFile, writeFile } from "node:fs/promises";

import { readAgentsConfig } from "../configs/agents/loader.js";
import { buildDefaultOrchestrationTemplate } from "../configs/orchestration/bootstrap.js";
import { toErrorMessage } from "../utils/errors.js";
import { isDirectory, isFile, pathExists } from "../utils/fs.js";
import { relativeToRoot } from "../utils/path.js";
import {
  WorkspaceMissingEntryError,
  WorkspaceNotInitializedError,
  WorkspaceSetupError,
  WorkspaceWrongTypeEntryError,
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

interface WorkspaceDomainStructureDefinition {
  readonly directorySegment: string;
  readonly sessionsSegment: string;
  readonly indexSegment: string;
  readonly indexVersion: number;
}

interface ResolvedWorkspaceDomainStructure {
  readonly directoryPath: string;
  readonly sessionsPath: string;
  readonly indexPath: string;
  readonly indexVersion: number;
}

export interface RepairWorkspaceStructureResult {
  readonly repaired: boolean;
  readonly createdDirectories: string[];
  readonly createdFiles: string[];
}

const DOMAIN_STRUCTURE_DEFINITIONS: readonly WorkspaceDomainStructureDefinition[] =
  [
    {
      directorySegment: VORATIQ_RUNS_DIR,
      sessionsSegment: VORATIQ_RUNS_SESSIONS_DIR,
      indexSegment: VORATIQ_RUNS_FILE,
      indexVersion: 2,
    },
    {
      directorySegment: VORATIQ_REDUCTIONS_DIR,
      sessionsSegment: VORATIQ_REDUCTIONS_SESSIONS_DIR,
      indexSegment: VORATIQ_REDUCTIONS_FILE,
      indexVersion: 1,
    },
    {
      directorySegment: VORATIQ_REVIEWS_DIR,
      sessionsSegment: VORATIQ_REVIEWS_SESSIONS_DIR,
      indexSegment: VORATIQ_REVIEWS_FILE,
      indexVersion: 1,
    },
    {
      directorySegment: VORATIQ_SPECS_DIR,
      sessionsSegment: VORATIQ_SPECS_SESSIONS_DIR,
      indexSegment: VORATIQ_SPECS_FILE,
      indexVersion: 1,
    },
  ];

const WORKSPACE_CONFIG_SEGMENTS: readonly string[] = [
  VORATIQ_AGENTS_FILE,
  VORATIQ_EVALS_FILE,
  VORATIQ_ENVIRONMENT_FILE,
  VORATIQ_SANDBOX_FILE,
  VORATIQ_ORCHESTRATION_FILE,
];

export async function createWorkspace(
  root: string,
): Promise<CreateWorkspaceResult> {
  const createdDirectories: string[] = [];
  const createdFiles: string[] = [];

  const workspaceDir = resolveWorkspacePath(root);
  const domainStructures = resolveWorkspaceDomainStructures(root);

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

  const workspaceExists = await pathExists(workspaceDir);
  const [agentsConfigExists, evalsConfigExists, environmentConfigExists] =
    await Promise.all([
      pathExists(agentsConfigPath),
      pathExists(evalsConfigPath),
      pathExists(environmentConfigPath),
    ]);
  const [sandboxConfigExists, orchestrationConfigExists] = await Promise.all([
    pathExists(sandboxConfigPath),
    pathExists(orchestrationConfigPath),
  ]);

  if (!workspaceExists) {
    await mkdir(workspaceDir, { recursive: true });
    createdDirectories.push(relativeToRoot(root, workspaceDir));
  }

  for (const domain of domainStructures) {
    if (!(await pathExists(domain.directoryPath))) {
      await mkdir(domain.directoryPath, { recursive: true });
      createdDirectories.push(relativeToRoot(root, domain.directoryPath));
    }

    if (!(await pathExists(domain.sessionsPath))) {
      await mkdir(domain.sessionsPath, { recursive: true });
      createdDirectories.push(relativeToRoot(root, domain.sessionsPath));
    }

    if (!(await pathExists(domain.indexPath))) {
      await writeInitialIndex(domain.indexPath, domain.indexVersion);
      createdFiles.push(relativeToRoot(root, domain.indexPath));
    }
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

export async function repairWorkspaceStructure(
  root: string,
): Promise<RepairWorkspaceStructureResult> {
  const createdDirectories: string[] = [];
  const createdFiles: string[] = [];

  const workspaceDir = resolveWorkspacePath(root);
  await ensureWorkspaceDirectoryEntry(root, workspaceDir);

  // Additive repair must not mutate config semantics.
  for (const configPath of resolveWorkspaceConfigPaths(root)) {
    await ensureWorkspaceFileEntry(root, configPath);
  }

  const domainStructures = resolveWorkspaceDomainStructures(root);
  const missingDirectories: string[] = [];
  const missingIndexes: ResolvedWorkspaceDomainStructure[] = [];
  const existingIndexes: ResolvedWorkspaceDomainStructure[] = [];

  for (const domain of domainStructures) {
    await classifyExpectedDirectory({
      root,
      path: domain.directoryPath,
      onMissing: () => {
        missingDirectories.push(domain.directoryPath);
      },
    });

    await classifyExpectedDirectory({
      root,
      path: domain.sessionsPath,
      onMissing: () => {
        missingDirectories.push(domain.sessionsPath);
      },
    });

    await classifyExpectedFile({
      root,
      path: domain.indexPath,
      onMissing: () => {
        missingIndexes.push(domain);
      },
      onPresent: () => {
        existingIndexes.push(domain);
      },
    });
  }

  const repaired = missingDirectories.length > 0 || missingIndexes.length > 0;
  if (!repaired) {
    return { repaired: false, createdDirectories, createdFiles };
  }

  for (const domain of existingIndexes) {
    await validateWorkspaceIndexFile(root, domain);
  }

  for (const directoryPath of missingDirectories) {
    await mkdir(directoryPath, { recursive: true });
    createdDirectories.push(relativeToRoot(root, directoryPath));
  }

  for (const domain of missingIndexes) {
    await writeInitialIndex(domain.indexPath, domain.indexVersion);
    createdFiles.push(relativeToRoot(root, domain.indexPath));
  }

  return { repaired: true, createdDirectories, createdFiles };
}

export async function validateWorkspace(root: string): Promise<void> {
  const workspaceDir = resolveWorkspacePath(root);
  const domainStructures = resolveWorkspaceDomainStructures(root);
  const configPaths = resolveWorkspaceConfigPaths(root);

  if (!(await isDirectory(workspaceDir))) {
    const missingEntries = buildWorkspaceMissingEntryList({
      root,
      workspaceDir,
      domainStructures,
      configPaths,
    });
    throw new WorkspaceNotInitializedError(missingEntries);
  }

  for (const domain of domainStructures) {
    await ensureWorkspaceDirectoryEntry(root, domain.directoryPath);
    await ensureWorkspaceDirectoryEntry(root, domain.sessionsPath);
    await ensureWorkspaceFileEntry(root, domain.indexPath);
    await validateWorkspaceIndexFile(root, domain);
  }

  for (const configPath of configPaths) {
    await ensureWorkspaceFileEntry(root, configPath);
  }
}

function resolveWorkspaceDomainStructures(
  root: string,
): readonly ResolvedWorkspaceDomainStructure[] {
  return DOMAIN_STRUCTURE_DEFINITIONS.map((domain) => ({
    directoryPath: resolveWorkspacePath(root, domain.directorySegment),
    sessionsPath: resolveWorkspacePath(root, domain.sessionsSegment),
    indexPath: resolveWorkspacePath(root, domain.indexSegment),
    indexVersion: domain.indexVersion,
  }));
}

function resolveWorkspaceConfigPaths(root: string): readonly string[] {
  return WORKSPACE_CONFIG_SEGMENTS.map((segment) =>
    resolveWorkspacePath(root, segment),
  );
}

function buildWorkspaceMissingEntryList(options: {
  root: string;
  workspaceDir: string;
  domainStructures: readonly ResolvedWorkspaceDomainStructure[];
  configPaths: readonly string[];
}): string[] {
  const { root, workspaceDir, domainStructures, configPaths } = options;
  const missing: string[] = [`${relativeToRoot(root, workspaceDir)}/`];

  for (const domain of domainStructures) {
    missing.push(`${relativeToRoot(root, domain.directoryPath)}/`);
    missing.push(`${relativeToRoot(root, domain.sessionsPath)}/`);
    missing.push(relativeToRoot(root, domain.indexPath));
  }

  for (const configPath of configPaths) {
    missing.push(relativeToRoot(root, configPath));
  }

  return missing;
}

async function classifyExpectedDirectory(options: {
  root: string;
  path: string;
  onMissing: () => void;
}): Promise<void> {
  const { root, path, onMissing } = options;
  const kind = await detectPathKind(path);
  if (kind === "missing") {
    onMissing();
    return;
  }
  if (kind !== "directory") {
    throw new WorkspaceWrongTypeEntryError(
      relativeToRoot(root, path),
      "directory",
    );
  }
}

async function classifyExpectedFile(options: {
  root: string;
  path: string;
  onMissing: () => void;
  onPresent: () => void;
}): Promise<void> {
  const { root, path, onMissing, onPresent } = options;
  const kind = await detectPathKind(path);
  if (kind === "missing") {
    onMissing();
    return;
  }
  if (kind !== "file") {
    throw new WorkspaceWrongTypeEntryError(relativeToRoot(root, path), "file");
  }
  onPresent();
}

async function ensureWorkspaceDirectoryEntry(
  root: string,
  path: string,
): Promise<void> {
  const kind = await detectPathKind(path);
  if (kind === "missing") {
    throw new WorkspaceMissingEntryError(relativeToRoot(root, path));
  }
  if (kind !== "directory") {
    throw new WorkspaceWrongTypeEntryError(
      relativeToRoot(root, path),
      "directory",
    );
  }
}

async function ensureWorkspaceFileEntry(
  root: string,
  path: string,
): Promise<void> {
  const kind = await detectPathKind(path);
  if (kind === "missing") {
    throw new WorkspaceMissingEntryError(relativeToRoot(root, path));
  }
  if (kind !== "file") {
    throw new WorkspaceWrongTypeEntryError(relativeToRoot(root, path), "file");
  }
}

async function detectPathKind(
  path: string,
): Promise<"missing" | "directory" | "file" | "other"> {
  if (!(await pathExists(path))) {
    return "missing";
  }
  if (await isDirectory(path)) {
    return "directory";
  }
  if (await isFile(path)) {
    return "file";
  }
  return "other";
}

async function validateWorkspaceIndexFile(
  root: string,
  domain: ResolvedWorkspaceDomainStructure,
): Promise<void> {
  const displayPath = relativeToRoot(root, domain.indexPath);
  let raw: string;
  try {
    raw = await readFile(domain.indexPath, "utf8");
  } catch (error) {
    throw new WorkspaceSetupError(
      `Failed to read workspace index \`${displayPath}\`: ${toErrorMessage(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new WorkspaceSetupError(
      `Failed to parse workspace index \`${displayPath}\`: ${toErrorMessage(error)}`,
    );
  }

  if (!isValidWorkspaceIndexPayload(parsed, domain.indexVersion)) {
    throw new WorkspaceSetupError(
      `Invalid workspace index \`${displayPath}\`: expected \`{ version: ${domain.indexVersion}, sessions: [] }\`.`,
    );
  }
}

function isValidWorkspaceIndexPayload(
  payload: unknown,
  version: number,
): boolean {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const candidate = payload as { version?: unknown; sessions?: unknown };
  return candidate.version === version && Array.isArray(candidate.sessions);
}

async function writeInitialIndex(path: string, version: number): Promise<void> {
  const initialIndex = JSON.stringify({ version, sessions: [] }, null, 2);
  await writeFile(path, `${initialIndex}\n`, { encoding: "utf8" });
}
