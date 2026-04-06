import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readAgentsConfig } from "../configs/agents/loader.js";
import {
  loadEnvironmentConfig,
  type LoadEnvironmentConfigOptions,
} from "../configs/environment/loader.js";
import type { EnvironmentConfig } from "../configs/environment/types.js";
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
  VORATIQ_INTERACTIVE_DIR,
  VORATIQ_INTERACTIVE_FILE,
  VORATIQ_INTERACTIVE_SESSIONS_DIR,
  VORATIQ_MESSAGE_DIR,
  VORATIQ_MESSAGE_FILE,
  VORATIQ_MESSAGE_SESSIONS_DIR,
  VORATIQ_ORCHESTRATION_FILE,
  VORATIQ_REDUCTION_DIR,
  VORATIQ_REDUCTION_FILE,
  VORATIQ_REDUCTION_SESSIONS_DIR,
  VORATIQ_RUN_DIR,
  VORATIQ_RUN_FILE,
  VORATIQ_RUN_SESSIONS_DIR,
  VORATIQ_SANDBOX_FILE,
  VORATIQ_SPEC_DIR,
  VORATIQ_SPEC_FILE,
  VORATIQ_SPEC_SESSIONS_DIR,
  VORATIQ_VERIFICATION_CONFIG_FILE,
  VORATIQ_VERIFICATION_DIR,
  VORATIQ_VERIFICATION_FILE,
  VORATIQ_VERIFICATION_SESSIONS_DIR,
  VORATIQ_VERIFICATION_TEMPLATES_DIR,
} from "./structure.js";
import {
  buildDefaultAgentsTemplate,
  buildDefaultEnvironmentTemplate,
  buildDefaultSandboxTemplate,
} from "./templates.js";
import type { CreateWorkspaceResult } from "./types.js";
import {
  buildDefaultVerificationConfigYaml,
  SHIPPED_VERIFICATION_TEMPLATES,
} from "./verification-defaults.js";

async function seedVerificationSurface(
  root: string,
  options: {
    verificationConfigPath?: string;
    configExists?: boolean;
    restoreTemplates?: boolean;
  } = {},
): Promise<{ createdDirectories: string[]; createdFiles: string[] }> {
  const createdDirectories: string[] = [];
  const createdFiles: string[] = [];

  const verificationConfigPath =
    options.verificationConfigPath ??
    resolveWorkspacePath(root, VORATIQ_VERIFICATION_CONFIG_FILE);
  const configExists =
    options.configExists ?? (await pathExists(verificationConfigPath));

  if (!configExists) {
    await mkdir(dirname(verificationConfigPath), { recursive: true });
    const seededConfig = await buildSeededVerificationConfig(root);
    await writeFile(verificationConfigPath, seededConfig, { encoding: "utf8" });
    createdFiles.push(relativeToRoot(root, verificationConfigPath));
  }

  if (options.restoreTemplates === false) {
    return { createdDirectories, createdFiles };
  }

  const templatesRoot = resolveWorkspacePath(
    root,
    VORATIQ_VERIFICATION_TEMPLATES_DIR,
  );
  if (!(await pathExists(templatesRoot))) {
    await mkdir(templatesRoot, { recursive: true });
    createdDirectories.push(relativeToRoot(root, templatesRoot));
  }

  for (const template of SHIPPED_VERIFICATION_TEMPLATES) {
    const templateDir = join(templatesRoot, template.name);
    if (!(await pathExists(templateDir))) {
      await mkdir(templateDir, { recursive: true });
      createdDirectories.push(relativeToRoot(root, templateDir));
    }

    const promptPath = join(templateDir, "prompt.md");
    const rubricPath = join(templateDir, "rubric.md");
    const schemaPath = join(templateDir, "schema.yaml");

    if (!(await pathExists(promptPath))) {
      await writeFile(promptPath, `${template.prompt.trimEnd()}\n`, "utf8");
      createdFiles.push(relativeToRoot(root, promptPath));
    }
    if (!(await pathExists(rubricPath))) {
      await writeFile(rubricPath, `${template.rubric.trimEnd()}\n`, "utf8");
      createdFiles.push(relativeToRoot(root, rubricPath));
    }
    if (!(await pathExists(schemaPath))) {
      await writeFile(schemaPath, `${template.schema.trimEnd()}\n`, "utf8");
      createdFiles.push(relativeToRoot(root, schemaPath));
    }
  }

  return { createdDirectories, createdFiles };
}

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
      directorySegment: VORATIQ_SPEC_DIR,
      sessionsSegment: VORATIQ_SPEC_SESSIONS_DIR,
      indexSegment: VORATIQ_SPEC_FILE,
      indexVersion: 1,
    },
    {
      directorySegment: VORATIQ_RUN_DIR,
      sessionsSegment: VORATIQ_RUN_SESSIONS_DIR,
      indexSegment: VORATIQ_RUN_FILE,
      indexVersion: 2,
    },
    {
      directorySegment: VORATIQ_REDUCTION_DIR,
      sessionsSegment: VORATIQ_REDUCTION_SESSIONS_DIR,
      indexSegment: VORATIQ_REDUCTION_FILE,
      indexVersion: 1,
    },
    {
      directorySegment: VORATIQ_VERIFICATION_DIR,
      sessionsSegment: VORATIQ_VERIFICATION_SESSIONS_DIR,
      indexSegment: VORATIQ_VERIFICATION_FILE,
      indexVersion: 1,
    },
    {
      directorySegment: VORATIQ_MESSAGE_DIR,
      sessionsSegment: VORATIQ_MESSAGE_SESSIONS_DIR,
      indexSegment: VORATIQ_MESSAGE_FILE,
      indexVersion: 1,
    },
    {
      directorySegment: VORATIQ_INTERACTIVE_DIR,
      sessionsSegment: VORATIQ_INTERACTIVE_SESSIONS_DIR,
      indexSegment: VORATIQ_INTERACTIVE_FILE,
      indexVersion: 1,
    },
  ];

const WORKSPACE_CONFIG_SEGMENTS: readonly string[] = [
  VORATIQ_AGENTS_FILE,
  VORATIQ_VERIFICATION_CONFIG_FILE,
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
  const environmentConfigPath = resolveWorkspacePath(
    root,
    VORATIQ_ENVIRONMENT_FILE,
  );
  const sandboxConfigPath = resolveWorkspacePath(root, VORATIQ_SANDBOX_FILE);
  const orchestrationConfigPath = resolveWorkspacePath(
    root,
    VORATIQ_ORCHESTRATION_FILE,
  );
  const verificationConfigPath = resolveWorkspacePath(
    root,
    VORATIQ_VERIFICATION_CONFIG_FILE,
  );

  const workspaceExists = await pathExists(workspaceDir);
  const [agentsConfigExists, environmentConfigExists] = await Promise.all([
    pathExists(agentsConfigPath),
    pathExists(environmentConfigPath),
  ]);
  const [sandboxConfigExists, orchestrationConfigExists, verificationExists] =
    await Promise.all([
      pathExists(sandboxConfigPath),
      pathExists(orchestrationConfigPath),
      pathExists(verificationConfigPath),
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

  const seededVerification = await seedVerificationSurface(root, {
    verificationConfigPath,
    configExists: verificationExists,
  });
  createdDirectories.push(...seededVerification.createdDirectories);
  createdFiles.push(...seededVerification.createdFiles);

  return { createdDirectories, createdFiles };
}

export async function repairWorkspaceStructure(
  root: string,
  options: {
    restoreShippedVerificationTemplates?: boolean;
  } = {},
): Promise<RepairWorkspaceStructureResult> {
  const createdDirectories: string[] = [];
  const createdFiles: string[] = [];

  const workspaceDir = resolveWorkspacePath(root);
  await ensureWorkspaceDirectoryEntry(root, workspaceDir);

  // Additive repair must not mutate config semantics.
  for (const configPath of resolveWorkspaceConfigPaths(root)) {
    const kind = await detectPathKind(configPath);
    if (
      kind === "missing" &&
      configPath.endsWith(VORATIQ_VERIFICATION_CONFIG_FILE)
    ) {
      await mkdir(dirname(configPath), { recursive: true });
      const seededConfig = await buildSeededVerificationConfig(root);
      await writeFile(configPath, seededConfig, { encoding: "utf8" });
      createdFiles.push(relativeToRoot(root, configPath));
      continue;
    }
    await ensureWorkspaceFileEntry(root, configPath);
  }

  const seededVerification = await seedVerificationSurface(root, {
    restoreTemplates: options.restoreShippedVerificationTemplates ?? true,
  });
  createdDirectories.push(...seededVerification.createdDirectories);
  createdFiles.push(...seededVerification.createdFiles);

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

function loadVerificationSeedingEnvironment(
  root: string,
  options: LoadEnvironmentConfigOptions = {},
): EnvironmentConfig {
  try {
    return loadEnvironmentConfig({
      root,
      optional: true,
      ...options,
    });
  } catch {
    return {};
  }
}

async function buildSeededVerificationConfig(root: string): Promise<string> {
  const environment = loadVerificationSeedingEnvironment(root);
  return buildDefaultVerificationConfigYaml({ root, environment });
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
