import { rm } from "node:fs/promises";

import { toErrorMessage } from "../../utils/errors.js";
import { getGitStderr, removeWorktree } from "../../utils/git.js";

export interface TeardownDiagnostic {
  readonly label: string;
  readonly error: unknown;
}

export type TeardownResource =
  | {
      readonly kind: "path";
      readonly path: string;
      readonly label?: string;
    }
  | {
      readonly kind: "worktree";
      readonly root: string;
      readonly worktreePath: string;
      readonly label?: string;
    }
  | {
      readonly kind: "action";
      readonly key: string;
      readonly label: string;
      readonly cleanup: () => Promise<void>;
    };

export interface TeardownController {
  readonly label: string;
  addPath(path: string, label?: string): void;
  addWorktree(options: {
    root: string;
    worktreePath: string;
    label?: string;
  }): void;
  addAction(options: {
    key: string;
    label: string;
    cleanup: () => Promise<void>;
  }): void;
  listResources(): readonly TeardownResource[];
}

export interface ScratchWorkspaceTeardownPaths {
  readonly workspacePath: string;
  readonly contextPath: string;
  readonly runtimePath: string;
  readonly sandboxPath: string;
}

export function createTeardownController(label: string): TeardownController {
  const resources = new Map<string, TeardownResource>();

  return {
    label,
    addPath(path, resourceLabel) {
      resources.set(`path:${path}`, {
        kind: "path",
        path,
        ...(resourceLabel ? { label: resourceLabel } : {}),
      });
    },
    addWorktree(options) {
      const { root, worktreePath, label: resourceLabel } = options;
      resources.set(`worktree:${root}:${worktreePath}`, {
        kind: "worktree",
        root,
        worktreePath,
        ...(resourceLabel ? { label: resourceLabel } : {}),
      });
    },
    addAction(options) {
      resources.set(`action:${options.key}`, {
        kind: "action",
        key: options.key,
        label: options.label,
        cleanup: options.cleanup,
      });
    },
    listResources() {
      return [...resources.values()];
    },
  };
}

export function registerScratchWorkspaceTeardownPaths(
  teardown: TeardownController,
  workspacePaths: ScratchWorkspaceTeardownPaths,
  labelPrefix: string,
): void {
  teardown.addPath(workspacePaths.workspacePath, `${labelPrefix} workspace`);
  teardown.addPath(workspacePaths.contextPath, `${labelPrefix} context`);
  teardown.addPath(workspacePaths.runtimePath, `${labelPrefix} runtime`);
  teardown.addPath(workspacePaths.sandboxPath, `${labelPrefix} sandbox`);
}

export async function runTeardown(
  controller: TeardownController | undefined,
): Promise<readonly TeardownDiagnostic[]> {
  if (!controller) {
    return [];
  }

  const diagnostics: TeardownDiagnostic[] = [];
  for (const resource of controller.listResources()) {
    try {
      await cleanupTeardownResource(resource);
    } catch (error) {
      const label = resourceLabel(resource);
      diagnostics.push({ label, error });
      console.warn(
        `[voratiq] Failed to teardown ${controller.label} ${label}: ${toErrorMessage(error)}`,
      );
    }
  }

  return diagnostics;
}

async function cleanupTeardownResource(
  resource: TeardownResource,
): Promise<void> {
  switch (resource.kind) {
    case "path":
      await rm(resource.path, { recursive: true, force: true });
      return;
    case "worktree":
      await cleanupWorktree(resource);
      return;
    case "action":
      await resource.cleanup();
      return;
  }
}

async function cleanupWorktree(
  resource: Extract<TeardownResource, { kind: "worktree" }>,
): Promise<void> {
  try {
    await removeWorktree({
      root: resource.root,
      worktreePath: resource.worktreePath,
    });
    return;
  } catch (error) {
    if (!isIgnorableMissingWorktreeError(error)) {
      throw error;
    }
  }

  await rm(resource.worktreePath, { recursive: true, force: true });
}

function isIgnorableMissingWorktreeError(error: unknown): boolean {
  const stderr = getGitStderr(error)?.toLowerCase() ?? "";
  return (
    stderr.includes("is not a working tree") ||
    stderr.includes("not a working tree") ||
    stderr.includes("does not exist") ||
    stderr.includes("no such file or directory")
  );
}

function resourceLabel(resource: TeardownResource): string {
  if (resource.label) {
    return `resource \`${resource.label}\``;
  }

  switch (resource.kind) {
    case "path":
      return `path \`${resource.path}\``;
    case "worktree":
      return `worktree \`${resource.worktreePath}\``;
    case "action":
      return `resource \`${resource.label}\``;
  }
}
