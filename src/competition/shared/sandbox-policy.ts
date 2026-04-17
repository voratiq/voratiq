import { readdir } from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  resolve as resolveAbsolute,
} from "node:path";

import {
  getOperatorAccessProfile,
  type ReadonlyWorkspaceMountKey,
  type SandboxStageId,
} from "../../agents/runtime/operator-access.js";
import { assertPathWithinRoot } from "../../utils/path.js";

export interface ComposeStageSandboxPolicyInput {
  stageId: SandboxStageId;
  root: string;
  workspacePath: string;
  runtimePath: string;
  sandboxHomePath: string;
  contextPath?: string;
  includeStagedContext?: boolean;
  verifierInputsAbsolute?: string;
  verifierReferenceRepoAbsolute?: string;
}

export interface StageSandboxPolicy {
  extraWriteProtectedPaths: string[];
  extraReadProtectedPaths: string[];
}

interface AllowedRepositoryRootOptions {
  root: string;
  workspacePath: string;
  runtimePath: string;
  sandboxHomePath: string;
  contextPath?: string;
  includeStagedContext: boolean;
  verifierInputsAbsolute?: string;
  verifierReferenceRepoAbsolute?: string;
}

export async function composeStageSandboxPolicy(
  input: ComposeStageSandboxPolicyInput,
): Promise<StageSandboxPolicy> {
  const profile = getOperatorAccessProfile(input.stageId);
  const includeContextRoot =
    input.includeStagedContext === true ||
    profile.readonlyWorkspaceMounts.includes("context");
  const allowReadRoots = buildAllowedRepositoryReadRoots({
    root: input.root,
    workspacePath: input.workspacePath,
    runtimePath: input.runtimePath,
    sandboxHomePath: input.sandboxHomePath,
    contextPath: input.contextPath,
    includeStagedContext: includeContextRoot,
    verifierInputsAbsolute: input.verifierInputsAbsolute,
    verifierReferenceRepoAbsolute: input.verifierReferenceRepoAbsolute,
  });

  return {
    extraWriteProtectedPaths: buildReadonlyWorkspaceMountPaths({
      workspacePath: input.workspacePath,
      readonlyWorkspaceMounts: profile.readonlyWorkspaceMounts,
      includeStagedContext: includeContextRoot,
      contextPath: input.contextPath,
      verifierInputsAbsolute: input.verifierInputsAbsolute,
      verifierReferenceRepoAbsolute: input.verifierReferenceRepoAbsolute,
    }),
    extraReadProtectedPaths: profile.restrictRepositoryReads
      ? await buildRepositoryIsolationDenyPaths({
          root: input.root,
          allowReadRoots,
        })
      : [],
  };
}

function buildAllowedRepositoryReadRoots(
  options: AllowedRepositoryRootOptions,
): string[] {
  const roots = [
    options.workspacePath,
    options.runtimePath,
    options.sandboxHomePath,
    resolveAbsolute(options.root, "dist"),
  ];

  if (options.includeStagedContext && options.contextPath) {
    roots.push(options.contextPath);
  }

  if (options.verifierInputsAbsolute) {
    roots.push(options.verifierInputsAbsolute);
  }

  if (options.verifierReferenceRepoAbsolute) {
    roots.push(options.verifierReferenceRepoAbsolute);
  }

  return dedupePaths(roots);
}

function buildReadonlyWorkspaceMountPaths(options: {
  workspacePath: string;
  readonlyWorkspaceMounts: readonly ReadonlyWorkspaceMountKey[];
  includeStagedContext: boolean;
  contextPath?: string;
  verifierInputsAbsolute?: string;
  verifierReferenceRepoAbsolute?: string;
}): string[] {
  const {
    workspacePath,
    readonlyWorkspaceMounts,
    includeStagedContext,
    contextPath,
    verifierInputsAbsolute,
    verifierReferenceRepoAbsolute,
  } = options;
  const protectedPaths: string[] = [];

  for (const mountKey of readonlyWorkspaceMounts) {
    const mountPath = join(workspacePath, mountKey);

    if (mountKey === "context") {
      if (contextPath && includeStagedContext) {
        protectedPaths.push(mountPath, contextPath);
      }
      continue;
    }

    if (mountKey === "inputs") {
      if (verifierInputsAbsolute) {
        protectedPaths.push(mountPath, verifierInputsAbsolute);
      }
      continue;
    }

    if (mountKey === "reference_repo" && verifierReferenceRepoAbsolute) {
      protectedPaths.push(mountPath, verifierReferenceRepoAbsolute);
    }
  }

  return dedupePaths(protectedPaths);
}

async function buildRepositoryIsolationDenyPaths(options: {
  root: string;
  allowReadRoots: readonly string[];
}): Promise<string[]> {
  const root = resolveAbsolute(options.root);
  const allowReadRoots = normalizeAllowedRoots(root, options.allowReadRoots);
  if (allowReadRoots.some((path) => path === root)) {
    return [];
  }

  const trieRoot = buildAllowedRootTrie(root, allowReadRoots);
  const denied: string[] = [];
  await collectSiblingDenyPaths({
    directoryPath: root,
    allowed: trieRoot,
    denied,
  });
  return dedupePaths(denied);
}

async function collectSiblingDenyPaths(options: {
  directoryPath: string;
  allowed: AllowedRootTrieNode;
  denied: string[];
}): Promise<void> {
  const { directoryPath, allowed, denied } = options;
  if (allowed.terminal) {
    return;
  }

  let entries: string[];
  try {
    entries = await readdir(directoryPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (allowed.children.has(entry)) {
      continue;
    }
    denied.push(resolveAbsolute(directoryPath, entry));
  }

  for (const [segment, child] of allowed.children) {
    await collectSiblingDenyPaths({
      directoryPath: resolveAbsolute(directoryPath, segment),
      allowed: child,
      denied,
    });
  }
}

interface AllowedRootTrieNode {
  terminal: boolean;
  children: Map<string, AllowedRootTrieNode>;
}

function buildAllowedRootTrie(
  root: string,
  allowReadRoots: readonly string[],
): AllowedRootTrieNode {
  const trieRoot = createAllowedRootTrieNode();
  for (const allowReadRoot of allowReadRoots) {
    const relativePath = relative(root, allowReadRoot);
    if (relativePath === "" || relativePath === ".") {
      trieRoot.terminal = true;
      trieRoot.children.clear();
      break;
    }

    const segments = relativePath
      .split(/[\\/]+/u)
      .filter((segment) => segment.length > 0);
    let node = trieRoot;
    for (const segment of segments) {
      let child = node.children.get(segment);
      if (!child) {
        child = createAllowedRootTrieNode();
        node.children.set(segment, child);
      }
      node = child;
      if (node.terminal) {
        break;
      }
    }
    node.terminal = true;
    node.children.clear();
  }
  return trieRoot;
}

function createAllowedRootTrieNode(): AllowedRootTrieNode {
  return {
    terminal: false,
    children: new Map<string, AllowedRootTrieNode>(),
  };
}

function normalizeAllowedRoots(
  root: string,
  allowReadRoots: readonly string[],
): string[] {
  const normalized = allowReadRoots.flatMap((entry) => {
    const candidate = isAbsolute(entry)
      ? resolveAbsolute(entry)
      : resolveAbsolute(root, entry);
    try {
      return [assertPathWithinRoot(root, candidate)];
    } catch {
      return [];
    }
  });

  const sorted = dedupePaths(normalized);
  const collapsed: string[] = [];
  for (const candidate of sorted) {
    if (collapsed.some((parent) => isParentOrSamePath(parent, candidate))) {
      continue;
    }
    collapsed.push(candidate);
  }
  return collapsed;
}

function dedupePaths(paths: readonly string[]): string[] {
  return Array.from(new Set(paths));
}

function isParentOrSamePath(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  if (rel === "" || rel === ".") {
    return true;
  }
  if (rel.startsWith("..")) {
    return false;
  }
  return !isAbsolute(rel);
}
