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

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import type { EnvironmentConfig } from "../../../src/configs/environment/types.js";
import { collectAgentArtifacts } from "../../../src/domain/run/competition/agents/artifacts.js";
import type { RunAgentWorkspacePaths } from "../../../src/domain/run/competition/agents/workspace.js";
import { WORKSPACE_SUMMARY_FILENAME } from "../../../src/domain/run/competition/agents/workspace.js";
import { pathExists } from "../../../src/utils/fs.js";
import {
  gitAddAll,
  gitCommitAll,
  gitDiff,
  gitDiffShortStat,
  gitHasStagedChanges,
  runGitCommand,
} from "../../../src/utils/git.js";
import * as workspaceDependencies from "../../../src/workspace/dependencies.js";
import { WORKSPACE_SHIM_RELATIVE_PATH } from "../../../src/workspace/shim.js";

jest.mock("../../../src/utils/git.js", () => ({
  gitAddAll: jest.fn(),
  gitCommitAll: jest.fn(),
  gitDiff: jest.fn(),
  gitDiffShortStat: jest.fn(),
  gitHasStagedChanges: jest.fn(),
  runGitCommand: jest.fn(),
}));

const mockedGitAddAll = gitAddAll as jest.MockedFunction<typeof gitAddAll>;
const mockedGitCommitAll = gitCommitAll as jest.MockedFunction<
  typeof gitCommitAll
>;
const mockedGitDiff = gitDiff as jest.MockedFunction<typeof gitDiff>;
const mockedGitDiffShortStat = gitDiffShortStat as jest.MockedFunction<
  typeof gitDiffShortStat
>;
const mockedGitHasStagedChanges = gitHasStagedChanges as jest.MockedFunction<
  typeof gitHasStagedChanges
>;
const mockedRunGitCommand = runGitCommand as jest.MockedFunction<
  typeof runGitCommand
>;

describe("collectAgentArtifacts", () => {
  let repoRoot: string;
  let workspacePath: string;
  let summaryPath: string;
  let diffPath: string;
  let artifactsPath: string;
  let workspacePaths: RunAgentWorkspacePaths;
  let gitAddNodeModulesPresent: boolean;
  const environment: EnvironmentConfig = {
    node: { dependencyRoots: ["node_modules"] },
  };
  const persona = {
    authorName: "Sandbox Persona",
    authorEmail: "persona@example.com",
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    repoRoot = await mkdtemp(join(tmpdir(), "voratiq-collect-artifacts-"));
    workspacePath = join(repoRoot, "workspace");
    artifactsPath = join(repoRoot, "artifacts");
    await mkdir(artifactsPath, { recursive: true });
    summaryPath = join(artifactsPath, "summary.txt");
    diffPath = join(artifactsPath, "diff.patch");
    workspacePaths = {
      agentRoot: join(repoRoot, "agent"),
      artifactsPath,
      contextPath: join(repoRoot, "agent", "context"),
      stdoutPath: join(artifactsPath, "stdout.log"),
      stderrPath: join(artifactsPath, "stderr.log"),
      workspacePath,
      runtimeManifestPath: join(repoRoot, "runtime", "manifest.json"),
      sandboxPath: join(repoRoot, "sandbox"),
      sandboxHomePath: join(repoRoot, "sandbox", "home"),
      sandboxSettingsPath: join(repoRoot, "runtime", "sandbox.json"),
      runtimePath: join(repoRoot, "runtime"),
      diffPath,
      summaryPath,
    };

    await mkdir(workspacePath, { recursive: true });
    const repoNodeModules = join(repoRoot, "node_modules");
    await mkdir(repoNodeModules, { recursive: true });
    await symlink(repoNodeModules, join(workspacePath, "node_modules"), "dir");
    await writeFile(
      join(workspacePath, WORKSPACE_SUMMARY_FILENAME),
      "   summary line   ",
      "utf8",
    );

    gitAddNodeModulesPresent = true;
    mockedGitHasStagedChanges.mockResolvedValue(true);
    mockedGitCommitAll.mockResolvedValue(undefined);
    mockedRunGitCommand.mockResolvedValue("abc123");
    mockedGitDiff.mockImplementation(async ({ cwd }) => {
      if (await pathExists(join(cwd, "node_modules"))) {
        return "diff --git a/node_modules b/node_modules\n";
      }
      return "diff --git a/src/index.ts b/src/index.ts\n";
    });
    mockedGitDiffShortStat.mockResolvedValue("1 file changed");
    mockedGitAddAll.mockImplementation(async (cwd) => {
      gitAddNodeModulesPresent = await pathExists(join(cwd, "node_modules"));
    });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("omits the workspace node_modules symlink from export diffs", async () => {
    const result = await collectAgentArtifacts({
      baseRevisionSha: "base-sha",
      workspacePaths,
      root: repoRoot,
      environment,
      persona,
    });

    expect(result.diffCaptured).toBe(true);
    expect(mockedGitAddAll).toHaveBeenCalledTimes(2);
    expect(mockedGitAddAll).toHaveBeenNthCalledWith(1, workspacePath, [
      WORKSPACE_SHIM_RELATIVE_PATH.join("/"),
    ]);
    expect(mockedGitAddAll).toHaveBeenNthCalledWith(2, workspacePath, [
      WORKSPACE_SHIM_RELATIVE_PATH.join("/"),
    ]);
    expect(gitAddNodeModulesPresent).toBe(false);
    expect(await readFile(diffPath, "utf8")).not.toContain("node_modules");
    expect(
      await pathExists(join(workspacePath, WORKSPACE_SUMMARY_FILENAME)),
    ).toBe(false);
    expect(await readFile(summaryPath, "utf8")).toBe("summary line\n");
    expect(mockedGitCommitAll).toHaveBeenCalledWith({
      cwd: workspacePath,
      message: "summary line",
      authorName: persona.authorName,
      authorEmail: persona.authorEmail,
      bypassHooks: true,
    });

    const restoredStats = await lstat(join(workspacePath, "node_modules"));
    expect(restoredStats.isSymbolicLink()).toBe(true);
    const linkTarget = await readlinkWorkspaceNodeModules(workspacePath);
    expect(linkTarget).toBe(resolveAbsolute(repoRoot, "node_modules"));
  });

  it("fails when the diff contains credential artifacts", async () => {
    mockedGitDiff.mockResolvedValue(
      "diff --git a/.gemini/oauth_creds.json b/.gemini/oauth_creds.json\n",
    );

    await expect(
      collectAgentArtifacts({
        baseRevisionSha: "base-sha",
        workspacePaths,
        root: repoRoot,
        environment,
        persona,
      }),
    ).rejects.toThrow(/Credential files must stay inside the sandbox/i);
  });

  it("fails when credential directories are present in the workspace tree", async () => {
    await mkdir(join(workspacePath, ".gemini"), { recursive: true });
    await writeFile(join(workspacePath, ".gemini", "state.json"), "{}", "utf8");

    await expect(
      collectAgentArtifacts({
        baseRevisionSha: "base-sha",
        workspacePaths,
        root: repoRoot,
        environment,
        persona,
      }),
    ).rejects.toThrow(/Credential files must stay inside the sandbox/i);
  });

  it("warns and exports the diff when staged changes exist but the summary is missing", async () => {
    const workspaceSummary = join(workspacePath, WORKSPACE_SUMMARY_FILENAME);
    await rm(workspaceSummary, { force: true });
    mockedGitHasStagedChanges.mockResolvedValue(true);

    const result = await collectAgentArtifacts({
      baseRevisionSha: "base-sha",
      workspacePaths,
      root: repoRoot,
      environment,
      persona,
    });

    expect(result.summaryCaptured).toBe(false);
    expect(result.warnings).toEqual([
      "Agent did not produce a change summary.",
    ]);
    expect(await pathExists(summaryPath)).toBe(false);
    expect(mockedGitCommitAll).toHaveBeenCalledWith({
      cwd: workspacePath,
      message: "voratiq internal export",
      authorName: persona.authorName,
      authorEmail: persona.authorEmail,
      bypassHooks: true,
    });
  });

  it("warns and exports the diff when staged changes exist but the summary is empty", async () => {
    const workspaceSummary = join(workspacePath, WORKSPACE_SUMMARY_FILENAME);
    await writeFile(workspaceSummary, "   \n", "utf8");
    mockedGitHasStagedChanges.mockResolvedValue(true);

    const result = await collectAgentArtifacts({
      baseRevisionSha: "base-sha",
      workspacePaths,
      root: repoRoot,
      environment,
      persona,
    });

    expect(result.summaryCaptured).toBe(false);
    expect(result.warnings).toEqual([
      "Agent did not produce a change summary.",
    ]);
    expect(await pathExists(workspaceSummary)).toBe(false);
    expect(await pathExists(summaryPath)).toBe(false);
    expect(mockedGitCommitAll).toHaveBeenCalledWith({
      cwd: workspacePath,
      message: "voratiq internal export",
      authorName: persona.authorName,
      authorEmail: persona.authorEmail,
      bypassHooks: true,
    });
  });

  it("fails with no-workspace-changes when the summary is missing and nothing was staged", async () => {
    const workspaceSummary = join(workspacePath, WORKSPACE_SUMMARY_FILENAME);
    await rm(workspaceSummary, { force: true });
    mockedGitHasStagedChanges.mockResolvedValue(false);

    await expect(
      collectAgentArtifacts({
        baseRevisionSha: "base-sha",
        workspacePaths,
        root: repoRoot,
        environment,
        persona,
      }),
    ).rejects.toThrow("Agent process failed. No workspace changes detected.");

    expect(mockedGitAddAll).toHaveBeenCalledTimes(1);
    expect(await pathExists(workspaceSummary)).toBe(false);
  });

  it("fails with no-workspace-changes when the only staged change was the summary", async () => {
    mockedGitHasStagedChanges
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(
      collectAgentArtifacts({
        baseRevisionSha: "base-sha",
        workspacePaths,
        root: repoRoot,
        environment,
        persona,
      }),
    ).rejects.toThrow("Agent process failed. No workspace changes detected.");

    expect(
      await pathExists(join(workspacePath, WORKSPACE_SUMMARY_FILENAME)),
    ).toBe(false);
    expect(await readFile(summaryPath, "utf8")).toBe("summary line\n");
    expect(mockedGitCommitAll).not.toHaveBeenCalled();
  });

  it("restores copied node dependencies after export for Next.js run workspaces", async () => {
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({
        dependencies: {
          next: "15.0.0",
        },
      }),
      "utf8",
    );
    await rm(join(workspacePath, "node_modules"), {
      recursive: true,
      force: true,
    });
    await mkdir(join(repoRoot, "node_modules", "next"), { recursive: true });
    await writeFile(
      join(repoRoot, "node_modules", "next", "package.json"),
      '{"name":"next"}',
      "utf8",
    );
    await mkdir(join(workspacePath, "node_modules", "next"), {
      recursive: true,
    });
    const ensureSpy = jest.spyOn(
      workspaceDependencies,
      "ensureWorkspaceDependencies",
    );

    try {
      const result = await collectAgentArtifacts({
        baseRevisionSha: "base-sha",
        workspacePaths,
        root: repoRoot,
        environment,
        persona,
      });

      expect(result.summaryCaptured).toBe(true);
      expect(ensureSpy).toHaveBeenCalledWith({
        root: repoRoot,
        workspacePath,
        environment,
        stageId: "run",
      });
      const restoredStats = await lstat(join(workspacePath, "node_modules"));
      expect(restoredStats.isSymbolicLink()).toBe(false);
      expect(
        await readFile(
          join(workspacePath, "node_modules", "next", "package.json"),
          "utf8",
        ),
      ).toBe('{"name":"next"}');
    } finally {
      ensureSpy.mockRestore();
    }
  });

  it("restores dependencies when cleanup fails", async () => {
    const cleanupSpy = jest
      .spyOn(workspaceDependencies, "cleanupWorkspaceDependencies")
      .mockImplementation(() =>
        Promise.reject(
          new workspaceDependencies.WorkspaceDependencyCleanupError({
            cleanup: { nodeRemoved: true, pythonRemoved: false },
            cause: new Error("synthetic cleanup failure"),
          }),
        ),
      );
    const ensureSpy = jest.spyOn(
      workspaceDependencies,
      "ensureWorkspaceDependencies",
    );

    await rm(join(workspacePath, "node_modules"), {
      recursive: true,
      force: true,
    });

    try {
      const result = await collectAgentArtifacts({
        baseRevisionSha: "base-sha",
        workspacePaths,
        root: repoRoot,
        environment,
        persona,
      });

      expect(result.summaryCaptured).toBe(true);
      expect(ensureSpy).toHaveBeenCalled();
      const restoredStats = await lstat(join(workspacePath, "node_modules"));
      expect(restoredStats.isSymbolicLink()).toBe(true);
    } finally {
      cleanupSpy.mockRestore();
      ensureSpy.mockRestore();
    }
  });

  it("fails when dependency restoration does not succeed", async () => {
    const ensureSpy = jest
      .spyOn(workspaceDependencies, "ensureWorkspaceDependencies")
      .mockRejectedValue(new Error("relink boom"));

    try {
      await expect(
        collectAgentArtifacts({
          baseRevisionSha: "base-sha",
          workspacePaths,
          root: repoRoot,
          environment,
          persona,
        }),
      ).rejects.toThrow(
        "Failed to restore workspace dependencies after export: relink boom",
      );
    } finally {
      ensureSpy.mockRestore();
    }
  });

  it("fails when copied dependency restoration does not succeed", async () => {
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({
        dependencies: {
          next: "15.0.0",
        },
      }),
      "utf8",
    );
    await rm(join(workspacePath, "node_modules"), {
      recursive: true,
      force: true,
    });
    await mkdir(join(workspacePath, "node_modules", "next"), {
      recursive: true,
    });

    const ensureSpy = jest
      .spyOn(workspaceDependencies, "ensureWorkspaceDependencies")
      .mockRejectedValue(new Error("recopy boom"));

    try {
      await expect(
        collectAgentArtifacts({
          baseRevisionSha: "base-sha",
          workspacePaths,
          root: repoRoot,
          environment,
          persona,
        }),
      ).rejects.toThrow(
        "Failed to restore workspace dependencies after export: recopy boom",
      );

      expect(await pathExists(join(workspacePath, "node_modules"))).toBe(false);
      expect(ensureSpy).toHaveBeenCalledWith({
        root: repoRoot,
        workspacePath,
        environment,
        stageId: "run",
      });
    } finally {
      ensureSpy.mockRestore();
    }
  });
});

async function readlinkWorkspaceNodeModules(
  workspace: string,
): Promise<string> {
  const target = await readlink(join(workspace, "node_modules"));
  return resolveAbsolute(dirname(join(workspace, "node_modules")), target);
}
