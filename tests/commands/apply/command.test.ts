import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { executeApplyCommand } from "../../../src/commands/apply/command.js";
import {
  ApplyAgentDiffMissingOnDiskError,
  ApplyAgentSummaryEmptyError,
  ApplyAgentSummaryNotRecordedError,
  ApplyBaseMismatchError,
  ApplyPatchApplicationError,
} from "../../../src/commands/apply/errors.js";
import {
  appendRunRecord,
  rewriteRunRecord,
} from "../../../src/runs/records/persistence.js";
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

  it("overwrites applyStatus when applying multiple agents", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "voratiq-apply-overwrite-"));
    try {
      await initGitRepository(repoRoot);
      await createWorkspace(repoRoot);

      const srcDir = join(repoRoot, "src");
      await mkdir(srcDir, { recursive: true });

      const fileA = join(srcDir, "artifact-a.ts");
      const fileB = join(srcDir, "artifact-b.ts");
      await writeFile(fileA, "console.log('a');\n", "utf8");
      await writeFile(fileB, "console.log('b');\n", "utf8");
      await runGit(repoRoot, ["add", "src/artifact-a.ts", "src/artifact-b.ts"]);
      await runGit(repoRoot, ["commit", "-m", "seed artifacts"]);

      const baseRevisionSha = await runGit(repoRoot, ["rev-parse", "HEAD"]);

      await writeFile(fileA, "console.log('a apply');\n", "utf8");
      const diffA = await runGit(repoRoot, ["diff"], { trim: false });
      const diffStatsA = await runGit(repoRoot, ["diff", "--shortstat"]);
      await runGit(repoRoot, ["checkout", "--", "src/artifact-a.ts"]);

      await writeFile(fileB, "console.log('b apply');\n", "utf8");
      const diffB = await runGit(repoRoot, ["diff"], { trim: false });
      const diffStatsB = await runGit(repoRoot, ["diff", "--shortstat"]);
      await runGit(repoRoot, ["checkout", "--", "src/artifact-b.ts"]);

      const runId = "run-apply-overwrite";
      const agentA = "agent-a";
      const agentB = "agent-b";

      await writeRunRecordWithAgents({
        repoRoot,
        runId,
        baseRevisionSha,
        agents: [
          {
            agentId: agentA,
            diffContent: diffA,
            diffStatistics: diffStatsA,
          },
          {
            agentId: agentB,
            diffContent: diffB,
            diffStatistics: diffStatsB,
          },
        ],
      });

      const runsFilePath = join(repoRoot, ".voratiq", "runs", "index.json");

      await executeApplyCommand({
        root: repoRoot,
        runsFilePath,
        runId,
        agentId: agentA,
        ignoreBaseMismatch: false,
      });

      const recordPath = join(
        repoRoot,
        ".voratiq",
        "runs",
        "sessions",
        runId,
        "record.json",
      );
      const afterFirstApply = JSON.parse(
        await readFile(recordPath, "utf8"),
      ) as RunRecord;
      expect(afterFirstApply.applyStatus?.agentId).toBe(agentA);

      await executeApplyCommand({
        root: repoRoot,
        runsFilePath,
        runId,
        agentId: agentB,
        ignoreBaseMismatch: false,
      });

      const afterSecondApply = JSON.parse(
        await readFile(recordPath, "utf8"),
      ) as RunRecord;
      expect(afterSecondApply.applyStatus?.agentId).toBe(agentB);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("persists applyStatus when applying during a running run", async () => {
    jest.useFakeTimers();
    const repoRoot = await mkdtemp(join(tmpdir(), "voratiq-apply-running-"));
    try {
      await initGitRepository(repoRoot);
      await createWorkspace(repoRoot);

      const { baseRevisionSha, diffContent, diffStatistics } =
        await createDiffFixture({
          repoRoot,
          original: "console.log('hello');\n",
          updated: "console.log('hello running apply');\n",
        });

      const runId = "run-running-apply";
      const agentId = "claude";
      const runsFilePath = join(repoRoot, ".voratiq", "runs", "index.json");

      await writeRunRecordWithAgents({
        repoRoot,
        runId,
        baseRevisionSha,
        runStatus: "running",
        agents: [
          {
            agentId,
            diffContent,
            diffStatistics,
          },
        ],
      });

      await executeApplyCommand({
        root: repoRoot,
        runsFilePath,
        runId,
        agentId,
        ignoreBaseMismatch: false,
      });

      // Simulate the apply process exiting immediately; scheduled flush timers
      // must not be relied upon for persistence.
      jest.clearAllTimers();

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
      expect(updatedRecord.applyStatus?.agentId).toBe(agentId);
      expect(updatedRecord.applyStatus?.status).toBe("succeeded");
    } finally {
      jest.useRealTimers();
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("applies work and records applyStatus for an aborted run", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "voratiq-apply-aborted-"));
    try {
      await initGitRepository(repoRoot);
      await createWorkspace(repoRoot);

      const { filePath, baseRevisionSha, diffContent, diffStatistics } =
        await createDiffFixture({
          repoRoot,
          original: "console.log('hello');\n",
          updated: "console.log('hello aborted apply');\n",
        });

      const runId = "run-aborted-apply";
      const agentId = "claude";
      await writeRunRecord({
        repoRoot,
        runId,
        agentId,
        baseRevisionSha,
        diffContent,
        diffStatistics,
      });

      const runsFilePath = join(repoRoot, ".voratiq", "runs", "index.json");
      await rewriteRunRecord({
        root: repoRoot,
        runsFilePath,
        runId,
        mutate: (existing) => ({
          ...existing,
          status: "aborted",
        }),
      });

      const result = await executeApplyCommand({
        root: repoRoot,
        runsFilePath,
        runId,
        agentId,
        ignoreBaseMismatch: false,
      });

      await expect(readFile(filePath, "utf8")).resolves.toBe(
        "console.log('hello aborted apply');\n",
      );
      expect(result.status).toBe("aborted");

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

      expect(updatedRecord.status).toBe("aborted");
      expect(updatedRecord.applyStatus?.agentId).toBe(agentId);
      expect(updatedRecord.applyStatus?.status).toBe("succeeded");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("creates a git commit when requested", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "voratiq-apply-commit-"));
    try {
      await initGitRepository(repoRoot);
      await createWorkspace(repoRoot);

      const { filePath, baseRevisionSha, diffContent, diffStatistics } =
        await createDiffFixture({
          repoRoot,
          original: "console.log('hello');\n",
          updated: "console.log('hello committed');\n",
        });

      const runId = "run-commit";
      const agentId = "claude";
      await writeRunRecord({
        repoRoot,
        runId,
        agentId,
        baseRevisionSha,
        diffContent,
        diffStatistics,
        summaryContent: "commit subject\n",
      });

      const result = await executeApplyCommand({
        root: repoRoot,
        runsFilePath: join(repoRoot, ".voratiq", "runs", "index.json"),
        runId,
        agentId,
        ignoreBaseMismatch: false,
        commit: true,
      });

      await expect(readFile(filePath, "utf8")).resolves.toBe(
        "console.log('hello committed');\n",
      );

      const appliedCommitSha = await runGit(repoRoot, ["rev-parse", "HEAD"]);
      expect(result.appliedCommitSha).toBe(appliedCommitSha);
      await expect(
        runGit(repoRoot, ["log", "-1", "--pretty=%s"]),
      ).resolves.toBe("commit subject");

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
      expect(updatedRecord?.applyStatus?.appliedCommitSha).toBe(
        appliedCommitSha,
      );
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("fails when the summary artifact is missing and does not commit", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "voratiq-apply-no-summary-"));
    try {
      await initGitRepository(repoRoot);
      await createWorkspace(repoRoot);

      const { filePath, baseRevisionSha, diffContent, diffStatistics } =
        await createDiffFixture({
          repoRoot,
          original: "console.log('hello');\n",
          updated: "console.log('hello no summary');\n",
        });

      const runId = "run-no-summary";
      const agentId = "claude";
      await writeRunRecord({
        repoRoot,
        runId,
        agentId,
        baseRevisionSha,
        diffContent,
        diffStatistics,
        artifacts: { diffCaptured: true },
      });

      await expect(
        executeApplyCommand({
          root: repoRoot,
          runsFilePath: join(repoRoot, ".voratiq", "runs", "index.json"),
          runId,
          agentId,
          ignoreBaseMismatch: false,
          commit: true,
        }),
      ).rejects.toBeInstanceOf(ApplyAgentSummaryNotRecordedError);

      await expect(readFile(filePath, "utf8")).resolves.toBe(
        "console.log('hello no summary');\n",
      );

      await expect(runGit(repoRoot, ["rev-parse", "HEAD"])).resolves.toBe(
        baseRevisionSha,
      );
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("fails when the summary artifact is empty and does not commit", async () => {
    const repoRoot = await mkdtemp(
      join(tmpdir(), "voratiq-apply-empty-summary-"),
    );
    try {
      await initGitRepository(repoRoot);
      await createWorkspace(repoRoot);

      const { filePath, baseRevisionSha, diffContent, diffStatistics } =
        await createDiffFixture({
          repoRoot,
          original: "console.log('hello');\n",
          updated: "console.log('hello empty summary');\n",
        });

      const runId = "run-empty-summary";
      const agentId = "claude";
      await writeRunRecord({
        repoRoot,
        runId,
        agentId,
        baseRevisionSha,
        diffContent,
        diffStatistics,
        summaryContent: "   \n",
      });

      await expect(
        executeApplyCommand({
          root: repoRoot,
          runsFilePath: join(repoRoot, ".voratiq", "runs", "index.json"),
          runId,
          agentId,
          ignoreBaseMismatch: false,
          commit: true,
        }),
      ).rejects.toBeInstanceOf(ApplyAgentSummaryEmptyError);

      await expect(readFile(filePath, "utf8")).resolves.toBe(
        "console.log('hello empty summary');\n",
      );

      await expect(runGit(repoRoot, ["rev-parse", "HEAD"])).resolves.toBe(
        baseRevisionSha,
      );
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
  summaryContent?: string;
  artifacts?: RunRecord["agents"][number]["artifacts"];
}): Promise<string> {
  const {
    repoRoot,
    runId,
    agentId,
    baseRevisionSha,
    diffContent,
    diffStatistics,
    summaryContent = "summary\n",
    artifacts,
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
  await writeFile(summaryPath, summaryContent, "utf8");
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
    ...(artifacts ? { artifacts } : {}),
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

async function writeRunRecordWithAgents(options: {
  repoRoot: string;
  runId: string;
  baseRevisionSha: string;
  runStatus?: RunRecord["status"];
  agents: Array<{
    agentId: string;
    diffContent: string;
    diffStatistics: string;
    summaryContent?: string;
    artifacts?: RunRecord["agents"][number]["artifacts"];
    status?: RunRecord["agents"][number]["status"];
  }>;
}): Promise<void> {
  const { repoRoot, runId, baseRevisionSha, agents, runStatus } = options;
  const now = new Date().toISOString();

  const agentRecords = await Promise.all(
    agents.map(async (agent) => {
      const {
        agentId,
        diffContent,
        diffStatistics,
        summaryContent = "summary\n",
        artifacts,
        status,
      } = agent;
      void diffStatistics;

      const agentDir = join(
        repoRoot,
        ".voratiq",
        "runs",
        "sessions",
        runId,
        agentId,
      );
      const artifactsDir = join(agentDir, "artifacts");
      await mkdir(artifactsDir, { recursive: true });

      await writeFile(join(artifactsDir, "stdout.log"), "stdout\n", "utf8");
      await writeFile(join(artifactsDir, "stderr.log"), "stderr\n", "utf8");
      await writeFile(
        join(artifactsDir, "summary.txt"),
        summaryContent,
        "utf8",
      );
      await writeFile(join(artifactsDir, "diff.patch"), diffContent, "utf8");

      return createAgentInvocationRecord({
        agentId,
        model: `${agentId}-model`,
        status: status ?? "succeeded",
        startedAt: now,
        completedAt: now,
        commitSha: baseRevisionSha,
        ...(artifacts ? { artifacts } : {}),
      });
    }),
  );

  const runRecord = createRunRecord({
    runId,
    baseRevisionSha,
    spec: { path: "specs/sample.md" },
    createdAt: now,
    agents: agentRecords,
    status: runStatus ?? "succeeded",
  });

  const runsFilePath = join(repoRoot, ".voratiq", "runs", "index.json");
  await appendRunRecord({ root: repoRoot, runsFilePath, record: runRecord });
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
