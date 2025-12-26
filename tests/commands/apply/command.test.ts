import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { executeApplyCommand } from "../../../src/commands/apply/command.js";
import {
  ApplyAgentDiffMissingOnDiskError,
  ApplyBaseMismatchError,
  ApplyPatchApplicationError,
} from "../../../src/commands/apply/errors.js";
import { appendRunRecord } from "../../../src/runs/records/persistence.js";
import type { RunRecord } from "../../../src/runs/records/types.js";
import { createWorkspace } from "../../../src/workspace/setup.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../../support/factories/run-records.js";

const execFileAsync = promisify(execFile);

describe("executeApplyCommand", () => {
  jest.setTimeout(20_000);
  it("applies the recorded diff to the working tree", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "voratiq-apply-success-"));
    try {
      await initGitRepository(repoRoot);
      await createWorkspace(repoRoot);

      const { filePath, baseRevisionSha, diffContent, diffStatistics } =
        await createDiffFixture({
          repoRoot,
          original: "console.log('hello');\n",
          updated: "console.log('hello apply');\n",
        });

      const runId = "run-success";
      const agentId = "claude";
      const diffRelative = await writeRunRecord({
        repoRoot,
        runId,
        agentId,
        baseRevisionSha,
        diffContent,
        diffStatistics,
      });

      const result = await executeApplyCommand({
        root: repoRoot,
        runsFilePath: join(repoRoot, ".voratiq", "runs", "index.json"),
        runId,
        agentId,
        ignoreBaseMismatch: false,
      });

      await expect(readFile(filePath, "utf8")).resolves.toBe(
        "console.log('hello apply');\n",
      );

      expect(result.runId).toBe(runId);
      expect(result.agent.agentId).toBe(agentId);
      expect(result.diffPath).toBe(diffRelative);
      expect(result.ignoredBaseMismatch).toBe(false);

      const recordPath = join(
        repoRoot,
        ".voratiq",
        "runs",
        "sessions",
        runId,
        "record.json",
      );
      const updatedRecord = JSON.parse(
        await readFile(recordPath, "utf8"),
      ) as RunRecord;
      expect(updatedRecord?.applyStatus).toBeDefined();
      expect(updatedRecord?.applyStatus?.agentId).toBe(agentId);
      expect(updatedRecord?.applyStatus?.status).toBe("succeeded");
      expect(updatedRecord?.applyStatus?.ignoredBaseMismatch).toBe(false);
      expect(typeof updatedRecord?.applyStatus?.appliedAt).toBe("string");
      expect(
        Number.isNaN(
          Date.parse(updatedRecord?.applyStatus?.appliedAt ?? "invalid"),
        ),
      ).toBe(false);
      expect(updatedRecord?.applyStatus?.detail ?? undefined).toBeUndefined();
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects when HEAD diverges from the recorded base revision", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "voratiq-apply-base-"));
    try {
      await initGitRepository(repoRoot);
      await createWorkspace(repoRoot);

      const { filePath, baseRevisionSha, diffContent, diffStatistics } =
        await createDiffFixture({
          repoRoot,
          original: "module.exports = 1;\n",
          updated: "module.exports = 2;\n",
        });

      const runId = "run-base";
      const agentId = "codex";
      await writeRunRecord({
        repoRoot,
        runId,
        agentId,
        baseRevisionSha,
        diffContent,
        diffStatistics,
      });

      await advanceHead(repoRoot);

      await expect(
        executeApplyCommand({
          root: repoRoot,
          runsFilePath: join(repoRoot, ".voratiq", "runs", "index.json"),
          runId,
          agentId,
          ignoreBaseMismatch: false,
        }),
      ).rejects.toBeInstanceOf(ApplyBaseMismatchError);

      await expect(readFile(filePath, "utf8")).resolves.toBe(
        "module.exports = 1;\n",
      );
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("allows ignored base mismatches when explicitly requested", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "voratiq-apply-ignore-"));
    try {
      await initGitRepository(repoRoot);
      await createWorkspace(repoRoot);

      const { filePath, baseRevisionSha, diffContent, diffStatistics } =
        await createDiffFixture({
          repoRoot,
          original: "export const value = 1;\n",
          updated: "export const value = 3;\n",
        });

      const runId = "run-ignore";
      const agentId = "gemini";
      const diffRelative = await writeRunRecord({
        repoRoot,
        runId,
        agentId,
        baseRevisionSha,
        diffContent,
        diffStatistics,
      });

      await advanceHead(repoRoot);

      const result = await executeApplyCommand({
        root: repoRoot,
        runsFilePath: join(repoRoot, ".voratiq", "runs", "index.json"),
        runId,
        agentId,
        ignoreBaseMismatch: true,
      });

      expect(result.diffPath).toBe(diffRelative);
      expect(result.ignoredBaseMismatch).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe(
        "export const value = 3;\n",
      );
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("fails when the recorded diff is missing", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "voratiq-apply-missing-"));
    try {
      await initGitRepository(repoRoot);
      await createWorkspace(repoRoot);

      const { baseRevisionSha, diffContent, diffStatistics } =
        await createDiffFixture({
          repoRoot,
          original: "console.log('missing');\n",
          updated: "console.log('still missing');\n",
        });

      const runId = "run-missing";
      const agentId = "claude";
      const diffRelative = await writeRunRecord({
        repoRoot,
        runId,
        agentId,
        baseRevisionSha,
        diffContent,
        diffStatistics,
      });

      await rm(join(repoRoot, diffRelative), { recursive: true, force: true });

      await expect(
        executeApplyCommand({
          root: repoRoot,
          runsFilePath: join(repoRoot, ".voratiq", "runs", "index.json"),
          runId,
          agentId,
          ignoreBaseMismatch: false,
        }),
      ).rejects.toBeInstanceOf(ApplyAgentDiffMissingOnDiskError);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("records failed apply attempts with detail", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "voratiq-apply-failure-"));
    try {
      await initGitRepository(repoRoot);
      await createWorkspace(repoRoot);

      const { filePath, baseRevisionSha, diffContent, diffStatistics } =
        await createDiffFixture({
          repoRoot,
          original: "console.log('hello');\n",
          updated: "console.log('hello apply');\n",
        });

      const runId = "run-failure";
      const agentId = "scribe";
      await writeRunRecord({
        repoRoot,
        runId,
        agentId,
        baseRevisionSha,
        diffContent,
        diffStatistics,
      });

      await writeFile(filePath, "console.log('different');\n", "utf8");

      await expect(
        executeApplyCommand({
          root: repoRoot,
          runsFilePath: join(repoRoot, ".voratiq", "runs", "index.json"),
          runId,
          agentId,
          ignoreBaseMismatch: false,
        }),
      ).rejects.toBeInstanceOf(ApplyPatchApplicationError);

      const recordPath = join(
        repoRoot,
        ".voratiq",
        "runs",
        "sessions",
        runId,
        "record.json",
      );
      const updatedRecord = JSON.parse(
        await readFile(recordPath, "utf8"),
      ) as RunRecord;

      expect(updatedRecord?.applyStatus).toBeDefined();
      expect(updatedRecord?.applyStatus?.agentId).toBe(agentId);
      expect(updatedRecord?.applyStatus?.status).toBe("failed");
      expect(updatedRecord?.applyStatus?.ignoredBaseMismatch).toBe(false);
      const detail = updatedRecord?.applyStatus?.detail;
      expect(typeof detail === "string" && detail.length > 0).toBe(true);
      expect((detail?.length ?? 0) <= 256).toBe(true);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

interface DiffFixtureOptions {
  repoRoot: string;
  original: string;
  updated: string;
}

interface DiffFixtureResult {
  filePath: string;
  baseRevisionSha: string;
  diffContent: string;
  diffStatistics: string;
}

async function createDiffFixture(
  options: DiffFixtureOptions,
): Promise<DiffFixtureResult> {
  const { repoRoot, original, updated } = options;
  const filePath = join(repoRoot, "src", "artifact.ts");
  await mkdir(join(repoRoot, "src"), { recursive: true });
  await writeFile(filePath, original, "utf8");

  await runGit(repoRoot, ["add", "src/artifact.ts"]);
  await runGit(repoRoot, ["commit", "-m", "seed artifact"]);

  const baseRevisionSha = await runGit(repoRoot, ["rev-parse", "HEAD"]);

  await writeFile(filePath, updated, "utf8");
  const diffContent = await runGit(repoRoot, ["diff"], { trim: false });
  const diffStatistics = await runGit(repoRoot, ["diff", "--shortstat"]);
  await runGit(repoRoot, ["checkout", "--", "src/artifact.ts"]);

  return { filePath, baseRevisionSha, diffContent, diffStatistics };
}

async function writeRunRecord(options: {
  repoRoot: string;
  runId: string;
  agentId: string;
  baseRevisionSha: string;
  diffContent: string;
  diffStatistics: string;
}): Promise<string> {
  const {
    repoRoot,
    runId,
    agentId,
    baseRevisionSha,
    diffContent,
    diffStatistics,
  } = options;
  void diffStatistics;

  const runDir = join(repoRoot, ".voratiq", "runs", "sessions", runId);
  const agentDir = join(runDir, agentId);
  const workspaceDir = join(agentDir, "workspace");
  const artifactsDir = join(agentDir, "artifacts");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(artifactsDir, { recursive: true });

  const stdoutPath = join(artifactsDir, "stdout.log");
  const stderrPath = join(artifactsDir, "stderr.log");
  const summaryPath = join(artifactsDir, "summary.txt");
  const diffPath = join(artifactsDir, "diff.patch");

  await writeFile(stdoutPath, "stdout\n", "utf8");
  await writeFile(stderrPath, "stderr\n", "utf8");
  await writeFile(summaryPath, "summary\n", "utf8");
  await writeFile(diffPath, diffContent, "utf8");

  const diffRelative = `.voratiq/runs/sessions/${runId}/${agentId}/artifacts/diff.patch`;
  const now = new Date().toISOString();

  const agentRecord = createAgentInvocationRecord({
    agentId,
    model: `${agentId}-model`,
    status: "succeeded",
    startedAt: now,
    completedAt: now,
    commitSha: baseRevisionSha,
  });

  const runRecord = createRunRecord({
    runId,
    baseRevisionSha,
    spec: { path: "specs/sample.md" },
    createdAt: now,
    agents: [agentRecord],
    status: "succeeded",
  });

  const runsFilePath = join(repoRoot, ".voratiq", "runs", "index.json");
  await appendRunRecord({ root: repoRoot, runsFilePath, record: runRecord });

  return diffRelative;
}

async function initGitRepository(root: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  await execFileAsync("git", ["config", "user.name", "Voratiq Test"], {
    cwd: root,
  });
  await execFileAsync("git", ["commit", "--allow-empty", "-m", "init"], {
    cwd: root,
  });
}

async function runGit(
  root: string,
  args: string[],
  options: { trim?: boolean } = {},
): Promise<string> {
  const { trim = true } = options;
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
  });
  return trim ? stdout.trim() : stdout;
}

async function advanceHead(root: string): Promise<void> {
  const markerPath = join(root, "README.md");
  await writeFile(markerPath, `${Date.now()}\n`, "utf8");
  await runGit(root, ["add", "README.md"]);
  await runGit(root, ["commit", "-m", "advance head"], { trim: false });
}
