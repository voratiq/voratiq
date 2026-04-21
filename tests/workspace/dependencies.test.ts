import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolveAbsolute } from "node:path";

import type { EnvironmentConfig } from "../../src/configs/environment/types.js";
import { pathExists } from "../../src/utils/fs.js";
import {
  cleanupWorkspaceDependencies,
  ensureWorkspaceDependencies,
  WorkspaceDependencyCleanupError,
} from "../../src/workspace/dependencies.js";
import { WorkspaceSetupError } from "../../src/workspace/errors.js";

describe("workspace dependency staging", () => {
  let repoRoot: string;
  let workspacePath: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "voratiq-deps-"));
    workspacePath = join(repoRoot, "workspace");
    await mkdir(workspacePath, { recursive: true });
  });

  afterEach(async () => {
    if (repoRoot) {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  async function ensure(environment: EnvironmentConfig): Promise<void> {
    await ensureWorkspaceDependencies({
      root: repoRoot,
      workspacePath,
      environment,
    });
  }

  async function ensureForRun(environment: EnvironmentConfig): Promise<void> {
    await ensureWorkspaceDependencies({
      root: repoRoot,
      workspacePath,
      environment,
      stageId: "run",
    });
  }

  async function cleanup(environment: EnvironmentConfig) {
    return await cleanupWorkspaceDependencies({
      root: repoRoot,
      workspacePath,
      environment,
    });
  }

  async function cleanupForRun(environment: EnvironmentConfig) {
    return await cleanupWorkspaceDependencies({
      root: repoRoot,
      workspacePath,
      environment,
      stageId: "run",
    });
  }

  it("links node_modules into the workspace", async () => {
    const environment: EnvironmentConfig = {
      node: { dependencyRoots: ["node_modules"] },
    };
    const repoNodeModules = join(repoRoot, "node_modules");
    await mkdir(repoNodeModules, { recursive: true });

    await ensure(environment);

    const workspaceNodeModules = join(workspacePath, "node_modules");
    const stats = await lstat(workspaceNodeModules);
    expect(stats.isSymbolicLink()).toBe(true);
    const target = await readlink(workspaceNodeModules);
    const resolved = resolveAbsolute(dirname(workspaceNodeModules), target);
    expect(resolved).toBe(repoNodeModules);
  });

  it("copies node dependency roots into run workspaces for Next.js repos", async () => {
    const environment: EnvironmentConfig = {
      node: { dependencyRoots: ["node_modules"] },
    };
    const repoNodeModules = join(repoRoot, "node_modules");
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({
        dependencies: {
          next: "15.0.0",
        },
      }),
      "utf8",
    );
    await mkdir(join(repoNodeModules, "next", "dist"), { recursive: true });
    await writeFile(
      join(repoNodeModules, "next", "dist", "server.js"),
      "module.exports = 'next';\n",
      "utf8",
    );

    await ensureForRun(environment);

    const workspaceNodeModules = join(workspacePath, "node_modules");
    const stats = await lstat(workspaceNodeModules);
    expect(stats.isDirectory()).toBe(true);
    expect(stats.isSymbolicLink()).toBe(false);
    expect(
      await readFile(
        join(workspaceNodeModules, "next", "dist", "server.js"),
        "utf8",
      ),
    ).toContain("next");
  });

  it("dereferences nested symlinks when copying run workspace node dependencies", async () => {
    const environment: EnvironmentConfig = {
      node: { dependencyRoots: ["node_modules"] },
    };
    const repoNodeModules = join(repoRoot, "node_modules");
    const linkedPackagePath = join(repoRoot, "linked-package");
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({
        dependencies: {
          next: "15.0.0",
        },
      }),
      "utf8",
    );
    await mkdir(linkedPackagePath, { recursive: true });
    await writeFile(join(linkedPackagePath, "index.js"), "export default 1;\n");
    await mkdir(repoNodeModules, { recursive: true });
    await symlink(
      linkedPackagePath,
      join(repoNodeModules, "linked-package"),
      "dir",
    );

    await ensureForRun(environment);

    const copiedPackagePath = join(
      workspacePath,
      "node_modules",
      "linked-package",
    );
    const stats = await lstat(copiedPackagePath);
    expect(stats.isSymbolicLink()).toBe(false);
    expect(await readFile(join(copiedPackagePath, "index.js"), "utf8")).toBe(
      "export default 1;\n",
    );
  });

  it("rejects nested symlinks that escape the repository during copy mode", async () => {
    const environment: EnvironmentConfig = {
      node: { dependencyRoots: ["node_modules"] },
    };
    const repoNodeModules = join(repoRoot, "node_modules");
    const externalPackagePath = await mkdtemp(
      join(tmpdir(), "voratiq-external-linked-package-"),
    );
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({
        dependencies: {
          next: "15.0.0",
        },
      }),
      "utf8",
    );
    await writeFile(
      join(externalPackagePath, "index.js"),
      "export default 2;\n",
      "utf8",
    );
    await mkdir(repoNodeModules, { recursive: true });
    await symlink(
      externalPackagePath,
      join(repoNodeModules, "linked-package"),
      "dir",
    );

    try {
      await expect(ensureForRun(environment)).rejects.toThrow(
        WorkspaceSetupError,
      );
    } finally {
      await rm(externalPackagePath, { recursive: true, force: true });
    }
  });

  it("does not treat nested Next.js packages as a repo-wide copy signal", async () => {
    const environment: EnvironmentConfig = {
      node: { dependencyRoots: ["node_modules"] },
    };
    const repoNodeModules = join(repoRoot, "node_modules");
    await mkdir(join(repoRoot, "apps", "web"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps", "web", "package.json"),
      JSON.stringify({
        dependencies: {
          next: "15.0.0",
        },
      }),
      "utf8",
    );
    await mkdir(repoNodeModules, { recursive: true });

    await ensureForRun(environment);

    const workspaceNodeModules = join(workspacePath, "node_modules");
    const stats = await lstat(workspaceNodeModules);
    expect(stats.isSymbolicLink()).toBe(true);
  });

  it("throws when a declared node dependency root is missing", async () => {
    const environment: EnvironmentConfig = {
      node: { dependencyRoots: ["node_modules"] },
    };

    await expect(ensure(environment)).rejects.toThrow(WorkspaceSetupError);
  });

  it("cleans up node links and reports removal", async () => {
    const environment: EnvironmentConfig = {
      node: { dependencyRoots: ["node_modules"] },
    };
    const repoNodeModules = join(repoRoot, "node_modules");
    await mkdir(repoNodeModules, { recursive: true });
    await ensure(environment);

    const result = await cleanup(environment);

    expect(result.nodeRemoved).toBe(true);
    expect(await pathExists(join(workspacePath, "node_modules"))).toBe(false);
  });

  it("cleans up copied node dependency roots in run workspaces for Next.js repos", async () => {
    const environment: EnvironmentConfig = {
      node: { dependencyRoots: ["node_modules"] },
    };
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({
        dependencies: {
          next: "15.0.0",
        },
      }),
      "utf8",
    );
    await mkdir(join(repoRoot, "node_modules", "next"), { recursive: true });

    await ensureForRun(environment);

    const result = await cleanupForRun(environment);

    expect(result.nodeRemoved).toBe(true);
    expect(await pathExists(join(workspacePath, "node_modules"))).toBe(false);
  });

  it("links python virtual environments into the workspace", async () => {
    const environment: EnvironmentConfig = {
      python: { path: ".venv" },
    };
    const repoVenv = join(repoRoot, ".venv");
    await mkdir(repoVenv, { recursive: true });
    await mkdir(join(repoVenv, "bin"), { recursive: true });

    await ensure(environment);

    const workspaceVenv = join(workspacePath, ".venv");
    const stats = await lstat(workspaceVenv);
    expect(stats.isSymbolicLink()).toBe(true);
    const target = await readlink(workspaceVenv);
    const resolved = resolveAbsolute(dirname(workspaceVenv), target);
    expect(resolved).toBe(repoVenv);
  });

  it("keeps python virtual environments symlinked for Next.js run workspaces", async () => {
    const environment: EnvironmentConfig = {
      node: { dependencyRoots: ["node_modules"] },
      python: { path: ".venv" },
    };
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({
        dependencies: {
          next: "15.0.0",
        },
      }),
      "utf8",
    );
    await mkdir(join(repoRoot, "node_modules", "next"), { recursive: true });
    const repoVenv = join(repoRoot, ".venv");
    await mkdir(join(repoVenv, "bin"), { recursive: true });

    await ensureForRun(environment);

    const workspaceVenv = join(workspacePath, ".venv");
    const stats = await lstat(workspaceVenv);
    expect(stats.isSymbolicLink()).toBe(true);
    const target = await readlink(workspaceVenv);
    const resolved = resolveAbsolute(dirname(workspaceVenv), target);
    expect(resolved).toBe(repoVenv);
  });

  it("cleans up python virtual environment links", async () => {
    const environment: EnvironmentConfig = {
      python: { path: ".venv" },
    };
    const repoVenv = join(repoRoot, ".venv");
    await mkdir(repoVenv, { recursive: true });
    await mkdir(join(repoVenv, "bin"), { recursive: true });
    await ensure(environment);

    const result = await cleanup(environment);

    expect(result.pythonRemoved).toBe(true);
    expect(await pathExists(join(workspacePath, ".venv"))).toBe(false);
  });

  it("restores dependencies after cleanup when re-ensured", async () => {
    const environment: EnvironmentConfig = {
      node: { dependencyRoots: ["node_modules"] },
      python: { path: ".venv" },
    };
    await mkdir(join(repoRoot, "node_modules"), { recursive: true });
    const repoVenv = join(repoRoot, ".venv");
    await mkdir(repoVenv, { recursive: true });

    await ensure(environment);
    const cleanupResult = await cleanup(environment);
    expect(cleanupResult.nodeRemoved || cleanupResult.pythonRemoved).toBe(true);

    await ensure(environment);

    expect(await pathExists(join(workspacePath, "node_modules"))).toBe(true);
    expect(await pathExists(join(workspacePath, ".venv"))).toBe(true);
  });

  it("overwrites conflicting workspace entries when linking", async () => {
    const environment: EnvironmentConfig = {
      node: { dependencyRoots: ["node_modules"] },
    };
    const repoNodeModules = join(repoRoot, "node_modules");
    await mkdir(repoNodeModules, { recursive: true });
    const workspaceNodeModules = join(workspacePath, "node_modules");
    await mkdir(workspaceNodeModules, { recursive: true });
    await writeFile(join(workspaceNodeModules, "placeholder.txt"), "", "utf8");

    await ensure(environment);

    const stats = await lstat(workspaceNodeModules);
    expect(stats.isSymbolicLink()).toBe(true);
    const target = await readlink(workspaceNodeModules);
    const resolved = resolveAbsolute(dirname(workspaceNodeModules), target);
    expect(resolved).toBe(repoNodeModules);
  });

  it("rejects absolute node dependency roots before linking", async () => {
    const environment: EnvironmentConfig = {
      node: { dependencyRoots: ["/tmp"] },
    };

    await expect(ensure(environment)).rejects.toThrow(WorkspaceSetupError);
    expect(await pathExists(join(workspacePath, "node_modules"))).toBe(false);
  });

  it("rejects parent-traversing dependency roots without touching outside directories", async () => {
    const environment: EnvironmentConfig = {
      node: { dependencyRoots: ["../outside-node"] },
    };
    const outsidePath = join(repoRoot, "..", "outside-node");
    await mkdir(outsidePath, { recursive: true });

    try {
      await expect(ensure(environment)).rejects.toThrow(WorkspaceSetupError);
      expect(await pathExists(outsidePath)).toBe(true);
    } finally {
      await rm(outsidePath, { recursive: true, force: true });
    }
  });

  it("rejects absolute python paths before linking", async () => {
    const environment: EnvironmentConfig = {
      python: { path: "/tmp/.venv" },
    };

    await expect(ensure(environment)).rejects.toThrow(WorkspaceSetupError);
    expect(await pathExists(join(workspacePath, ".venv"))).toBe(false);
  });

  it("rejects cleanup when dependency roots escape the repository", async () => {
    const environment: EnvironmentConfig = {
      node: { dependencyRoots: ["../drain"] },
    };

    await expect(cleanup(environment)).rejects.toThrow(WorkspaceSetupError);
  });

  it("reports cleanup intent when subsequent steps fail", async () => {
    const ensureEnvironment: EnvironmentConfig = {
      node: { dependencyRoots: ["node_modules"] },
    };
    const cleanupEnvironment: EnvironmentConfig = {
      node: { dependencyRoots: ["node_modules"] },
      python: { path: "../invalid" },
    };
    const repoNodeModules = join(repoRoot, "node_modules");
    await mkdir(repoNodeModules, { recursive: true });
    await ensure(ensureEnvironment);

    let capturedError: WorkspaceDependencyCleanupError | undefined;
    await expect(
      cleanup(cleanupEnvironment).catch((error) => {
        capturedError = error as WorkspaceDependencyCleanupError;
        throw error;
      }),
    ).rejects.toBeInstanceOf(WorkspaceDependencyCleanupError);

    expect(capturedError?.cleanup.nodeRemoved).toBe(true);
    expect(capturedError?.cleanup.pythonRemoved).toBe(false);
    expect(await pathExists(join(workspacePath, "node_modules"))).toBe(false);
  });
});
