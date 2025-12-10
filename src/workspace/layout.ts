import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentId } from "../configs/agents/types.js";
import { normalizePathForDisplay, resolvePath } from "../utils/path.js";
import {
  getAgentDiffPath,
  getAgentDirectoryPath,
  getAgentEvalsDirectoryPath,
  getAgentManifestPath,
  getAgentRuntimeDirectoryPath,
  getAgentSandboxDirectoryPath,
  getAgentSandboxHomePath,
  getAgentSandboxSettingsPath,
  getAgentStderrPath,
  getAgentStdoutPath,
  getAgentSummaryPath,
  getAgentWorkspaceDirectoryPath,
  getRunDirectoryPath,
  getRunPromptPath,
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

export const WORKSPACE_SUMMARY_FILENAME = ".summary.txt" as const;

export interface AgentWorkspacePaths {
  agentRoot: string;
  stdoutPath: string;
  stderrPath: string;
  diffPath: string;
  summaryPath: string;
  workspacePath: string;
  evalsDirPath: string;
  promptPath: string;
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
  runId: string;
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
  stdoutPath: {
    getRelativePath: ({ runId, agentId }) => getAgentStdoutPath(runId, agentId),
    initializeEmptyFile: true,
  },
  stderrPath: {
    getRelativePath: ({ runId, agentId }) => getAgentStderrPath(runId, agentId),
    initializeEmptyFile: true,
  },
  diffPath: {
    getRelativePath: ({ runId, agentId }) => getAgentDiffPath(runId, agentId),
    initializeEmptyFile: true,
  },
  summaryPath: {
    getRelativePath: ({ runId, agentId }) =>
      getAgentSummaryPath(runId, agentId),
    initializeEmptyFile: true,
  },
  workspacePath: {
    getRelativePath: ({ runId, agentId }) =>
      getAgentWorkspaceDirectoryPath(runId, agentId),
    ensureDir: true,
  },
  evalsDirPath: {
    getRelativePath: ({ runId, agentId }) =>
      getAgentEvalsDirectoryPath(runId, agentId),
    ensureDir: true,
  },
  promptPath: {
    getRelativePath: ({ runId }) => getRunPromptPath(runId),
  },
  runtimeManifestPath: {
    getRelativePath: ({ runId, agentId }) =>
      getAgentManifestPath(runId, agentId),
  },
  runtimePath: {
    getRelativePath: ({ runId, agentId }) =>
      getAgentRuntimeDirectoryPath(runId, agentId),
    ensureDir: true,
  },
  sandboxPath: {
    getRelativePath: ({ runId, agentId }) =>
      getAgentSandboxDirectoryPath(runId, agentId),
    ensureDir: true,
  },
  sandboxHomePath: {
    getRelativePath: ({ runId, agentId }) =>
      getAgentSandboxHomePath(runId, agentId),
    ensureDir: true,
  },
  sandboxSettingsPath: {
    getRelativePath: ({ runId, agentId }) =>
      getAgentSandboxSettingsPath(runId, agentId),
  },
} satisfies AgentWorkspaceArtifactDescriptorTable;

function getAgentWorkspaceArtifactDescriptorEntries(): AgentWorkspaceArtifactDescriptorEntry[] {
  return Object.entries(
    AGENT_WORKSPACE_ARTIFACTS,
  ) as AgentWorkspaceArtifactDescriptorEntry[];
}

function resolveAgentWorkspaceArtifactPaths(options: {
  root: string;
  runId: string;
  agentId: AgentId;
}): AgentWorkspaceArtifactPathMap {
  const { root, runId, agentId } = options;
  const entries = getAgentWorkspaceArtifactDescriptorEntries();
  const map = Object.create(null) as AgentWorkspaceArtifactPathMap;
  for (const [key, descriptor] of entries) {
    const relative = normalizePathForDisplay(
      descriptor.getRelativePath({ runId, agentId }),
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

  const artifactPaths = resolveAgentWorkspaceArtifactPaths({
    root,
    runId,
    agentId,
  });
  const absoluteArtifacts = buildAbsoluteArtifactPathMap(artifactPaths);

  const agentRelative = normalizePathForDisplay(
    getAgentDirectoryPath(runId, agentId),
  );
  const agentRoot = resolvePath(root, agentRelative);

  return {
    agentRoot,
    ...absoluteArtifacts,
  };
}

export function resolveRunPromptPath(root: string, runId: string): string {
  const promptRelative = normalizePathForDisplay(getRunPromptPath(runId));
  return resolvePath(root, promptRelative);
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

  for (const dirPath of directoriesToEnsure) {
    await mkdir(dirPath, { recursive: true });
  }

  for (const filePath of filesToInitialize) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "", { encoding: "utf8" });
  }
}
