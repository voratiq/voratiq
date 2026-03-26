import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentId } from "../configs/agents/types.js";
import { normalizePathForDisplay, resolvePath } from "../utils/path.js";
import {
  ARTIFACTS_DIRNAME,
  CONTEXT_DIRNAME,
  getAgentSessionArtifactsDirectoryPath,
  getAgentSessionContextDirectoryPath,
  getAgentSessionDirectoryPath,
  getAgentSessionManifestPath,
  getAgentSessionRuntimeDirectoryPath,
  getAgentSessionSandboxDirectoryPath,
  getAgentSessionSandboxHomePath,
  getAgentSessionSandboxSettingsPath,
  getAgentSessionStderrPath,
  getAgentSessionStdoutPath,
  getAgentSessionWorkspaceDirectoryPath,
  getRunDirectoryPath,
  MANIFEST_FILENAME,
  RUNTIME_DIRNAME,
  SANDBOX_DIRNAME,
  SANDBOX_SETTINGS_FILENAME,
  STDERR_FILENAME,
  STDOUT_FILENAME,
  VORATIQ_RUN_DIR,
  WORKSPACE_DIRNAME,
} from "./structure.js";

export interface RunWorkspacePaths {
  absolute: string;
  relative: string;
}

export function resolveRunWorkspacePaths(
  root: string,
  runId: string,
): RunWorkspacePaths {
  const relative = normalizePathForDisplay(getRunDirectoryPath(runId));
  const absolute = resolvePath(root, relative);
  return { absolute, relative };
}

export function formatRunWorkspaceRelative(runId: string): string {
  return normalizePathForDisplay(getRunDirectoryPath(runId));
}

export interface AgentWorkspacePaths {
  agentRoot: string;
  artifactsPath: string;
  contextPath: string;
  stdoutPath: string;
  stderrPath: string;
  workspacePath: string;
  runtimeManifestPath: string;
  sandboxPath: string;
  sandboxHomePath: string;
  sandboxSettingsPath: string;
  runtimePath: string;
}

type AgentWorkspaceArtifactKey = Exclude<
  keyof AgentWorkspacePaths,
  "agentRoot"
>;

interface AgentWorkspaceArtifactDescriptor {
  getRelativePath: (options: AgentWorkspaceArtifactContext) => string;
  ensureDir?: boolean;
  initializeEmptyFile?: boolean;
}

type AgentWorkspaceArtifactDescriptorTable = {
  [K in AgentWorkspaceArtifactKey]: AgentWorkspaceArtifactDescriptor;
};

type AgentWorkspaceArtifactDescriptorEntry = [
  AgentWorkspaceArtifactKey,
  AgentWorkspaceArtifactDescriptor,
];

interface AgentWorkspaceArtifactContext {
  domain: string;
  sessionId: string;
  agentId: AgentId;
}

interface AgentWorkspaceArtifactPathPair {
  relative: string;
  absolute: string;
}

type AgentWorkspaceArtifactPathMap = Record<
  AgentWorkspaceArtifactKey,
  AgentWorkspaceArtifactPathPair
>;

type AgentWorkspaceArtifactAbsoluteMap = Record<
  AgentWorkspaceArtifactKey,
  string
>;

const AGENT_WORKSPACE_ARTIFACTS = {
  artifactsPath: {
    getRelativePath: ({ domain, sessionId, agentId }) =>
      getAgentSessionArtifactsDirectoryPath(domain, sessionId, agentId),
    ensureDir: true,
  },
  contextPath: {
    getRelativePath: ({ domain, sessionId, agentId }) =>
      getAgentSessionContextDirectoryPath(domain, sessionId, agentId),
    ensureDir: true,
  },
  stdoutPath: {
    getRelativePath: ({ domain, sessionId, agentId }) =>
      getAgentSessionStdoutPath(domain, sessionId, agentId),
    initializeEmptyFile: true,
  },
  stderrPath: {
    getRelativePath: ({ domain, sessionId, agentId }) =>
      getAgentSessionStderrPath(domain, sessionId, agentId),
    initializeEmptyFile: true,
  },
  workspacePath: {
    getRelativePath: ({ domain, sessionId, agentId }) =>
      getAgentSessionWorkspaceDirectoryPath(domain, sessionId, agentId),
    ensureDir: true,
  },
  runtimeManifestPath: {
    getRelativePath: ({ domain, sessionId, agentId }) =>
      getAgentSessionManifestPath(domain, sessionId, agentId),
  },
  runtimePath: {
    getRelativePath: ({ domain, sessionId, agentId }) =>
      getAgentSessionRuntimeDirectoryPath(domain, sessionId, agentId),
    ensureDir: true,
  },
  sandboxPath: {
    getRelativePath: ({ domain, sessionId, agentId }) =>
      getAgentSessionSandboxDirectoryPath(domain, sessionId, agentId),
    ensureDir: true,
  },
  sandboxHomePath: {
    getRelativePath: ({ domain, sessionId, agentId }) =>
      getAgentSessionSandboxHomePath(domain, sessionId, agentId),
    ensureDir: true,
  },
  sandboxSettingsPath: {
    getRelativePath: ({ domain, sessionId, agentId }) =>
      getAgentSessionSandboxSettingsPath(domain, sessionId, agentId),
  },
} satisfies AgentWorkspaceArtifactDescriptorTable;

function getAgentWorkspaceArtifactDescriptorEntries(): AgentWorkspaceArtifactDescriptorEntry[] {
  return Object.entries(
    AGENT_WORKSPACE_ARTIFACTS,
  ) as AgentWorkspaceArtifactDescriptorEntry[];
}

function resolveAgentWorkspaceArtifactPaths(options: {
  root: string;
  domain: string;
  sessionId: string;
  agentId: AgentId;
}): AgentWorkspaceArtifactPathMap {
  const { root, domain, sessionId, agentId } = options;
  const entries = getAgentWorkspaceArtifactDescriptorEntries();
  const map = Object.create(null) as AgentWorkspaceArtifactPathMap;
  for (const [key, descriptor] of entries) {
    const relative = normalizePathForDisplay(
      descriptor.getRelativePath({ domain, sessionId, agentId }),
    );
    map[key] = {
      relative,
      absolute: resolvePath(root, relative),
    } satisfies AgentWorkspaceArtifactPathPair;
  }
  return map;
}

function buildAbsoluteArtifactPathMap(
  artifactPaths: AgentWorkspaceArtifactPathMap,
): AgentWorkspaceArtifactAbsoluteMap {
  const absoluteMap = Object.create(null) as AgentWorkspaceArtifactAbsoluteMap;
  for (const key of Object.keys(artifactPaths) as AgentWorkspaceArtifactKey[]) {
    absoluteMap[key] = artifactPaths[key].absolute;
  }
  return absoluteMap;
}

export function buildAgentWorkspacePaths(options: {
  root: string;
  runId: string;
  agentId: AgentId;
}): AgentWorkspacePaths {
  const { root, runId, agentId } = options;
  return buildAgentSessionWorkspacePaths({
    root,
    domain: VORATIQ_RUN_DIR,
    sessionId: runId,
    agentId,
  });
}

export function buildAgentSessionWorkspacePaths(options: {
  root: string;
  domain: string;
  sessionId: string;
  agentId: AgentId;
}): AgentWorkspacePaths {
  const { root, domain, sessionId, agentId } = options;

  const artifactPaths = resolveAgentWorkspaceArtifactPaths({
    root,
    domain,
    sessionId,
    agentId,
  });
  const absoluteArtifacts = buildAbsoluteArtifactPathMap(artifactPaths);

  const agentRelative = normalizePathForDisplay(
    getAgentSessionDirectoryPath(domain, sessionId, agentId),
  );
  const agentRoot = resolvePath(root, agentRelative);

  return {
    agentRoot,
    ...absoluteArtifacts,
  };
}

export function buildScopedAgentWorkspacePaths(options: {
  agentRoot: string;
}): AgentWorkspacePaths {
  const { agentRoot } = options;

  return {
    agentRoot,
    artifactsPath: resolvePath(agentRoot, ARTIFACTS_DIRNAME),
    contextPath: resolvePath(agentRoot, CONTEXT_DIRNAME),
    stdoutPath: resolvePath(agentRoot, ARTIFACTS_DIRNAME, STDOUT_FILENAME),
    stderrPath: resolvePath(agentRoot, ARTIFACTS_DIRNAME, STDERR_FILENAME),
    workspacePath: resolvePath(agentRoot, WORKSPACE_DIRNAME),
    runtimeManifestPath: resolvePath(
      agentRoot,
      RUNTIME_DIRNAME,
      MANIFEST_FILENAME,
    ),
    sandboxPath: resolvePath(agentRoot, SANDBOX_DIRNAME),
    sandboxHomePath: resolvePath(agentRoot, SANDBOX_DIRNAME),
    sandboxSettingsPath: resolvePath(
      agentRoot,
      RUNTIME_DIRNAME,
      SANDBOX_SETTINGS_FILENAME,
    ),
    runtimePath: resolvePath(agentRoot, RUNTIME_DIRNAME),
  };
}

export async function scaffoldAgentWorkspace(
  paths: AgentWorkspacePaths,
): Promise<void> {
  await mkdir(paths.agentRoot, { recursive: true });

  const descriptorEntries = getAgentWorkspaceArtifactDescriptorEntries();
  const directoriesToEnsure = new Set<string>();
  const filesToInitialize = new Set<string>();

  for (const [key, descriptor] of descriptorEntries) {
    const absolutePath = paths[key];
    if (descriptor.ensureDir) {
      directoriesToEnsure.add(absolutePath);
    }
    if (descriptor.initializeEmptyFile) {
      filesToInitialize.add(absolutePath);
    }
  }

  for (const filePath of filesToInitialize) {
    directoriesToEnsure.add(dirname(filePath));
  }

  for (const dirPath of directoriesToEnsure) {
    await mkdir(dirPath, { recursive: true });
  }

  for (const filePath of filesToInitialize) {
    await writeFile(filePath, "", { encoding: "utf8" });
  }
}

export async function scaffoldAgentSessionWorkspace(options: {
  root: string;
  domain: string;
  sessionId: string;
  agentId: AgentId;
}): Promise<AgentWorkspacePaths> {
  const paths = buildAgentSessionWorkspacePaths(options);
  await scaffoldAgentWorkspace(paths);
  return paths;
}
