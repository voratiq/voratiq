import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  normalizePathForDisplay,
  relativeToRoot,
} from "../../src/utils/path.js";
import {
  buildAgentSessionWorkspacePaths,
  buildAgentWorkspacePaths,
  resolveRunWorkspacePaths,
  scaffoldAgentSessionWorkspace,
  scaffoldAgentWorkspace,
} from "../../src/workspace/layout.js";
import {
  getAgentArtifactsDirectoryPath,
  getAgentDiffPath,
  getAgentEvalsDirectoryPath,
  getAgentManifestPath,
  getAgentReviewPath,
  getAgentRuntimeDirectoryPath,
  getAgentSandboxDirectoryPath,
  getAgentSandboxHomePath,
  getAgentSandboxSettingsPath,
  getAgentSessionWorkspaceDirectoryPath,
  getAgentStderrPath,
  getAgentStdoutPath,
  getAgentSummaryPath,
  getAgentWorkspaceDirectoryPath,
  WORKSPACE_DIRNAME,
} from "../../src/workspace/structure.js";

type ArtifactKey = Exclude<
  keyof ReturnType<typeof buildAgentWorkspacePaths>,
  "agentRoot"
>;

const ARTIFACT_BUILDERS: Record<
  ArtifactKey,
  (runId: string, agentId: string) => string
> = {
  artifactsPath: (runId, agentId) =>
    getAgentArtifactsDirectoryPath(runId, agentId),
  stdoutPath: (runId, agentId) => getAgentStdoutPath(runId, agentId),
  stderrPath: (runId, agentId) => getAgentStderrPath(runId, agentId),
  diffPath: (runId, agentId) => getAgentDiffPath(runId, agentId),
  summaryPath: (runId, agentId) => getAgentSummaryPath(runId, agentId),
  reviewPath: (runId, agentId) => getAgentReviewPath(runId, agentId),
  workspacePath: (runId, agentId) =>
    getAgentWorkspaceDirectoryPath(runId, agentId),
  evalsDirPath: (runId, agentId) => getAgentEvalsDirectoryPath(runId, agentId),
  runtimeManifestPath: (runId, agentId) => getAgentManifestPath(runId, agentId),
  runtimePath: (runId, agentId) => getAgentRuntimeDirectoryPath(runId, agentId),
  sandboxPath: (runId, agentId) => getAgentSandboxDirectoryPath(runId, agentId),
  sandboxHomePath: (runId, agentId) => getAgentSandboxHomePath(runId, agentId),
  sandboxSettingsPath: (runId, agentId) =>
    getAgentSandboxSettingsPath(runId, agentId),
};

const SCAFFOLD_FILE_KEYS: ArtifactKey[] = [
  "stdoutPath",
  "stderrPath",
  "diffPath",
  "summaryPath",
  "reviewPath",
];

const SCAFFOLD_DIR_KEYS: ArtifactKey[] = [
  "artifactsPath",
  "workspacePath",
  "evalsDirPath",
  "runtimePath",
  "sandboxPath",
  "sandboxHomePath",
];

describe("workspace layout helpers", () => {
  const root = join("/repo", "project");
  const runId = "20250101-120000-abc123";
  const agentId = "agent-a";

  it("resolves run workspace paths consistently", () => {
    const paths = resolveRunWorkspacePaths(root, runId);

    expect(paths.absolute).toBe(
      join(root, ".voratiq", "runs", "sessions", runId),
    );
    expect(paths.relative).toBe(`.voratiq/runs/sessions/${runId}`);
  });

  it("builds agent workspace paths with correct structure", () => {
    const runRoot = join(root, ".voratiq", "runs", "sessions", runId);
    const paths = buildAgentWorkspacePaths({ root, runId, agentId });

    expect(paths.agentRoot).toBe(join(runRoot, agentId));
    expect(paths.workspacePath).toBe(join(runRoot, agentId, WORKSPACE_DIRNAME));
    expect(paths.stdoutPath).toBe(
      join(runRoot, agentId, "artifacts", "stdout.log"),
    );
    expect(paths.stderrPath).toBe(
      join(runRoot, agentId, "artifacts", "stderr.log"),
    );
    expect(paths.diffPath).toBe(
      join(runRoot, agentId, "artifacts", "diff.patch"),
    );
    expect(paths.evalsDirPath).toBe(join(runRoot, agentId, "evals"));

    const relativeDisplay = (absolutePath: string) =>
      normalizePathForDisplay(relativeToRoot(root, absolutePath));

    expect(relativeDisplay(paths.workspacePath)).toBe(
      getAgentWorkspaceDirectoryPath(runId, agentId),
    );
    expect(relativeDisplay(paths.stdoutPath)).toBe(
      getAgentStdoutPath(runId, agentId),
    );
    expect(relativeDisplay(paths.stderrPath)).toBe(
      getAgentStderrPath(runId, agentId),
    );
    expect(relativeDisplay(paths.diffPath)).toBe(
      getAgentDiffPath(runId, agentId),
    );
    expect(relativeDisplay(paths.evalsDirPath)).toBe(
      getAgentEvalsDirectoryPath(runId, agentId),
    );
  });

  it("builds agent session paths for non-run domains", () => {
    const domain = "specs";
    const sessionId = "spec-20250102-xyz";
    const sessionRoot = join(root, ".voratiq", domain, "sessions", sessionId);
    const paths = buildAgentSessionWorkspacePaths({
      root,
      domain,
      sessionId,
      agentId,
    });

    expect(paths.agentRoot).toBe(join(sessionRoot, agentId));
    expect(paths.workspacePath).toBe(
      join(sessionRoot, agentId, WORKSPACE_DIRNAME),
    );

    const relativeDisplay = (absolutePath: string) =>
      normalizePathForDisplay(relativeToRoot(root, absolutePath));

    expect(relativeDisplay(paths.workspacePath)).toBe(
      getAgentSessionWorkspaceDirectoryPath(domain, sessionId, agentId),
    );
  });

  it("derives all agent artifacts from the descriptor table", () => {
    const paths = buildAgentWorkspacePaths({ root, runId, agentId });

    for (const key of Object.keys(ARTIFACT_BUILDERS) as ArtifactKey[]) {
      const expectedRelative = normalizePathForDisplay(
        ARTIFACT_BUILDERS[key](runId, agentId),
      );
      const relativeDisplay = normalizePathForDisplay(
        relativeToRoot(root, paths[key]),
      );
      expect(relativeDisplay).toBe(expectedRelative);
    }
  });

  it("scaffolds agent workspace files and directories once", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "voratiq-workspace-"));
    const workspacePaths = buildAgentWorkspacePaths({
      root: tempRoot,
      runId,
      agentId,
    });

    try {
      await scaffoldAgentWorkspace(workspacePaths);

      const directories = new Set<string>([
        workspacePaths.agentRoot,
        ...SCAFFOLD_DIR_KEYS.map((key) => workspacePaths[key]),
      ]);
      for (const dirPath of directories) {
        await expect(access(dirPath)).resolves.toBeUndefined();
      }

      for (const key of SCAFFOLD_FILE_KEYS) {
        await expect(readFile(workspacePaths[key], "utf8")).resolves.toBe("");
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("scaffolds agent session workspace for non-run domains", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "voratiq-workspace-"));
    const domain = "specs";
    const sessionId = "spec-20250103-zzz";

    try {
      const workspacePaths = await scaffoldAgentSessionWorkspace({
        root: tempRoot,
        domain,
        sessionId,
        agentId,
      });

      await expect(
        access(workspacePaths.workspacePath),
      ).resolves.toBeUndefined();
      await expect(readFile(workspacePaths.stdoutPath, "utf8")).resolves.toBe(
        "",
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
