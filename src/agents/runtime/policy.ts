import { isAbsolute, relative, resolve as resolveAbsolute } from "node:path";

import type {
  SandboxFilesystemConfig,
  SandboxNetworkConfig,
} from "../../configs/sandbox/types.js";
import {
  resolveWorkspacePath,
  VORATIQ_AGENTS_FILE,
  VORATIQ_ENVIRONMENT_FILE,
  VORATIQ_HISTORY_LOCK_FILENAME,
  VORATIQ_ORCHESTRATION_FILE,
  VORATIQ_REDUCTION_DIR,
  VORATIQ_RUN_DIR,
  VORATIQ_RUN_FILE,
  VORATIQ_SANDBOX_FILE,
  VORATIQ_SPEC_DIR,
  VORATIQ_VERIFICATION_DIR,
} from "../../workspace/structure.js";
import type { SandboxPolicyOverrides } from "./types.js";

export type SandboxStageId = "run" | "spec" | "verify" | "reduce" | "message";

export interface BuildSandboxPolicyInput {
  stageId: SandboxStageId;
  root: string;
  workspacePath: string;
  sandboxHomePath: string;
  sandboxSettingsPath: string;
  runtimePath: string;
  artifactsPath: string;
  repoRootPath?: string;
  providerFilesystem: SandboxFilesystemConfig;
  providerNetwork: SandboxNetworkConfig;
  policyOverrides?: SandboxPolicyOverrides;
  stageDenyWritePaths?: readonly string[];
  stageDenyReadPaths?: readonly string[];
}

export interface NormalizeFilesystemPolicyInput {
  workspacePath: string;
  filesystem: SandboxFilesystemConfig;
}

export interface NormalizeNetworkPolicyInput {
  workspacePath: string;
  network: SandboxNetworkConfig;
}

export function buildSandboxPolicy(input: BuildSandboxPolicyInput): {
  filesystem: SandboxFilesystemConfig;
  network: SandboxNetworkConfig;
} {
  const {
    stageId,
    root,
    workspacePath,
    sandboxHomePath,
    sandboxSettingsPath,
    runtimePath,
    artifactsPath,
    repoRootPath,
    providerFilesystem,
    providerNetwork,
    policyOverrides,
    stageDenyWritePaths = [],
    stageDenyReadPaths = [],
  } = input;

  const baseline = buildBaselineFilesystemPolicy({
    root,
    stageId,
  });
  const providerResolved = resolveFilesystemPaths(
    providerFilesystem,
    workspacePath,
  );
  const overridesResolved = resolveFilesystemOverrides(
    policyOverrides,
    workspacePath,
  );
  const stageResolved = {
    allowWrite: [] as string[],
    denyRead: resolvePaths(stageDenyReadPaths, workspacePath),
    denyWrite: resolvePaths(stageDenyWritePaths, workspacePath),
  };

  // Keep denyRead/denyWrite symmetric by default. Runtime metadata stays
  // write-protected via allowWrite blockers to keep the shim boot path readable.
  const runtimeDenyPaths = [artifactsPath];

  const denyReadRaw = [
    ...baseline.denyRead,
    ...stageResolved.denyRead,
    ...providerResolved.denyRead,
    ...runtimeDenyPaths,
    ...overridesResolved.denyRead,
  ];
  const denyWriteRaw = [
    ...baseline.denyWrite,
    ...stageResolved.denyWrite,
    ...providerResolved.denyWrite,
    ...runtimeDenyPaths,
    ...overridesResolved.denyWrite,
  ];

  const allowWriteRaw = [
    ...providerResolved.allowWrite,
    ...stageResolved.allowWrite,
    ...overridesResolved.allowWrite,
    sandboxHomePath,
    workspacePath,
  ];
  const normalizedRepoRootPath = repoRootPath
    ? normalizeAbsolutePath(repoRootPath, workspacePath)
    : undefined;
  const allowWriteBlockers = normalizePaths({
    entries: [sandboxSettingsPath, runtimePath, artifactsPath, ...denyWriteRaw],
    workspacePath,
    collapseChildren: true,
  });
  const allowWriteFiltered = allowWriteRaw.filter((entry) => {
    const normalized = normalizeAbsolutePath(entry, workspacePath);
    if (normalizedRepoRootPath && normalized === normalizedRepoRootPath) {
      return false;
    }
    return !allowWriteBlockers.some((blocked) =>
      isParentOrSamePath(blocked, normalized),
    );
  });

  const filesystem = normalizeFilesystemPolicy({
    workspacePath,
    filesystem: {
      denyRead: denyReadRaw,
      allowWrite: allowWriteFiltered,
      denyWrite: denyWriteRaw,
    },
  });
  const network = normalizeNetworkPolicy({
    workspacePath,
    network: providerNetwork,
  });

  return { filesystem, network };
}

export function normalizeFilesystemPolicy(
  input: NormalizeFilesystemPolicyInput,
): SandboxFilesystemConfig {
  const { workspacePath, filesystem } = input;
  return {
    denyRead: normalizePaths({
      entries: filesystem.denyRead,
      workspacePath,
      collapseChildren: true,
    }),
    allowWrite: normalizePaths({
      entries: filesystem.allowWrite,
      workspacePath,
      collapseChildren: false,
    }),
    denyWrite: normalizePaths({
      entries: filesystem.denyWrite,
      workspacePath,
      collapseChildren: true,
    }),
  };
}

export function normalizeNetworkPolicy(
  input: NormalizeNetworkPolicyInput,
): SandboxNetworkConfig {
  const { workspacePath, network } = input;
  const allowUnixSockets = network.allowUnixSockets
    ? normalizePaths({
        entries: network.allowUnixSockets,
        workspacePath,
        collapseChildren: false,
      })
    : undefined;

  return {
    allowedDomains: normalizeStrings(network.allowedDomains),
    deniedDomains: normalizeStrings(network.deniedDomains),
    allowLocalBinding: network.allowLocalBinding === true,
    ...(allowUnixSockets && allowUnixSockets.length > 0
      ? { allowUnixSockets }
      : {}),
    ...(network.allowAllUnixSockets === true
      ? { allowAllUnixSockets: true }
      : {}),
  };
}

function buildBaselineFilesystemPolicy(options: {
  root: string;
  stageId: SandboxStageId;
}): SandboxFilesystemConfig {
  const { root, stageId } = options;
  const commonSensitivePaths = [
    resolveWorkspacePath(root, VORATIQ_AGENTS_FILE),
    resolveWorkspacePath(root, VORATIQ_ENVIRONMENT_FILE),
    resolveWorkspacePath(root, VORATIQ_ORCHESTRATION_FILE),
    resolveWorkspacePath(root, VORATIQ_SANDBOX_FILE),
  ];
  const stageRoots = resolveStageRoots(stageId, root);

  // Default deny rules stay symmetric; read-only divergences are explicit.
  const symmetricDeny = [...commonSensitivePaths, ...stageRoots.symmetric];
  return {
    allowWrite: [],
    denyRead: [...symmetricDeny, ...stageRoots.readOnly],
    denyWrite: [...symmetricDeny],
  };
}

function resolveStageRoots(
  stageId: SandboxStageId,
  root: string,
): {
  symmetric: string[];
  readOnly: string[];
} {
  if (stageId === "run") {
    return {
      symmetric: [
        resolveAbsolute(root, ".git"),
        resolveWorkspacePath(root, VORATIQ_RUN_FILE),
        resolveWorkspacePath(
          root,
          VORATIQ_RUN_DIR,
          VORATIQ_HISTORY_LOCK_FILENAME,
        ),
        resolveWorkspacePath(root, VORATIQ_VERIFICATION_DIR),
      ],
      readOnly: [],
    };
  }

  if (stageId === "spec") {
    return {
      symmetric: [
        resolveWorkspacePath(root, VORATIQ_RUN_DIR),
        resolveWorkspacePath(root, VORATIQ_VERIFICATION_DIR),
        resolveWorkspacePath(root, VORATIQ_REDUCTION_DIR),
      ],
      readOnly: [],
    };
  }

  if (stageId === "verify") {
    return {
      symmetric: [
        resolveWorkspacePath(root, VORATIQ_RUN_DIR),
        resolveWorkspacePath(root, VORATIQ_SPEC_DIR),
        resolveWorkspacePath(root, VORATIQ_REDUCTION_DIR),
      ],
      // Verification agents should never inspect repository metadata during
      // blinded review.
      readOnly: [resolveAbsolute(root, ".git")],
    };
  }

  return {
    symmetric: [
      resolveWorkspacePath(root, VORATIQ_RUN_DIR),
      resolveWorkspacePath(root, VORATIQ_SPEC_DIR),
    ],
    readOnly: [resolveAbsolute(root, ".git")],
  };
}

function resolveFilesystemOverrides(
  overrides: SandboxPolicyOverrides | undefined,
  workspacePath: string,
): SandboxFilesystemConfig {
  return {
    allowWrite: resolvePaths(overrides?.allowWrite ?? [], workspacePath),
    denyRead: resolvePaths(overrides?.denyRead ?? [], workspacePath),
    denyWrite: resolvePaths(overrides?.denyWrite ?? [], workspacePath),
  };
}

function resolveFilesystemPaths(
  filesystem: SandboxFilesystemConfig,
  workspacePath: string,
): SandboxFilesystemConfig {
  return {
    allowWrite: resolvePaths(filesystem.allowWrite, workspacePath),
    denyRead: resolvePaths(filesystem.denyRead, workspacePath),
    denyWrite: resolvePaths(filesystem.denyWrite, workspacePath),
  };
}

function resolvePaths(
  entries: readonly string[],
  workspacePath: string,
): string[] {
  return entries.map((entry) => normalizeAbsolutePath(entry, workspacePath));
}

function normalizeAbsolutePath(entry: string, workspacePath: string): string {
  if (isAbsolute(entry)) {
    return resolveAbsolute(entry);
  }
  return resolveAbsolute(workspacePath, entry);
}

function normalizePaths(options: {
  entries: readonly string[];
  workspacePath: string;
  collapseChildren: boolean;
}): string[] {
  const { entries, workspacePath, collapseChildren } = options;
  const canonical = entries.map((entry) =>
    normalizeAbsolutePath(entry, workspacePath),
  );
  const deduped = dedupeAndSortPaths(canonical);
  if (!collapseChildren) {
    return deduped;
  }
  return collapseChildPaths(deduped);
}

function dedupeAndSortPaths(paths: readonly string[]): string[] {
  const deduped = Array.from(new Set(paths));
  deduped.sort(compareCanonicalPaths);
  return deduped;
}

function compareCanonicalPaths(left: string, right: string): number {
  const depthDelta = countSegments(left) - countSegments(right);
  if (depthDelta !== 0) {
    return depthDelta;
  }
  return left.localeCompare(right);
}

function countSegments(value: string): number {
  return value.split(/[\\/]+/u).filter(Boolean).length;
}

function collapseChildPaths(paths: readonly string[]): string[] {
  const collapsed: string[] = [];
  for (const candidate of paths) {
    if (collapsed.some((parent) => isParentOrSamePath(parent, candidate))) {
      continue;
    }
    collapsed.push(candidate);
  }
  return collapsed;
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

function normalizeStrings(entries: readonly string[]): string[] {
  const deduped = Array.from(new Set(entries));
  deduped.sort((left, right) => left.localeCompare(right));
  return deduped;
}
