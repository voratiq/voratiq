import { execFile } from "node:child_process";
import {
  access,
  constants as fsConstants,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { executePruneCommand } from "../../src/commands/prune/command.js";
import type { PruneSuccessResult } from "../../src/commands/prune/types.js";
import { appendRunRecord } from "../../src/records/persistence.js";
import type {
  AgentInvocationRecord,
  RunRecord,
} from "../../src/records/types.js";
import type { ConfirmationOptions } from "../../src/render/interactions/confirmation.js";
import { formatWorkspacePath } from "../../src/workspace/structure.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../support/factories/run-records.js";

const execFileAsync = promisify(execFile);
const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

describe("voratiq prune (integration)", () => {
  let repoRoot: string;
  let runsDir: string;
  let sessionsDir: string;
  let runsFilePath: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "voratiq-prune-"));
    await initGitRepository(repoRoot);

    runsDir = join(repoRoot, ".voratiq", "runs");
    runsFilePath = join(runsDir, "index.json");
    sessionsDir = join(runsDir, "sessions");
    await mkdir(sessionsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("removes agent workspaces and updates history after confirmation", async () => {
    const runId = "run-123";
    const agentId = "claude";
    const branchName = `voratiq/run/${runId}/${agentId}`;
    const runPath = join(sessionsDir, runId);
    const agentPath = join(runPath, agentId);
    const workspacePath = join(agentPath, "workspace");
    const artifactsPath = join(agentPath, "artifacts");
    const evalsPath = join(agentPath, "evals");

    await mkdir(workspacePath, { recursive: true });
    await mkdir(artifactsPath, { recursive: true });
    await writeFile(join(workspacePath, "temp.txt"), "scratch", "utf8");
    await writeFile(join(artifactsPath, "stdout.log"), "stdout", "utf8");
    await writeFile(join(artifactsPath, "stderr.log"), "stderr", "utf8");
    await writeFile(join(artifactsPath, "diff.patch"), "diff", "utf8");
    await writeFile(join(artifactsPath, "summary.txt"), "summary", "utf8");
    await mkdir(evalsPath, { recursive: true });
    await writeFile(join(evalsPath, "report.json"), "{}", "utf8");
    await writeFile(join(runPath, "prompt.txt"), "Summarize spec", "utf8");

    const headRevision = await gitHeadRevision(repoRoot);
    const agentRecord = buildAgentRecord(runId, agentId);
    const runRecord = createRunRecord({
      runId,
      baseRevisionSha: headRevision,
      spec: { path: "specs/sample.md" },
      status: "succeeded",
      createdAt: "2025-10-15T10:00:00.000Z",
      agents: [agentRecord],
    });

    await writeRunRecord(repoRoot, runsFilePath, runRecord);
    await execFileAsync("git", ["branch", branchName], { cwd: repoRoot });

    const confirmations: ConfirmationOptions[] = [];
    const confirmHandler = (options: ConfirmationOptions) => {
      confirmations.push(options);
      return Promise.resolve(true);
    };

    const result = await executePruneCommand({
      root: repoRoot,
      runsDir,
      runsFilePath,
      runId,
      confirm: confirmHandler,
      clock: () => new Date("2025-10-15T12:00:00.000Z"),
    });

    if (result.status !== "pruned") {
      throw new Error(`Expected pruned status, received ${result.status}`);
    }
    const success: PruneSuccessResult = result;
    expect(success.workspaces.removed).toEqual([
      `${formatWorkspacePath("runs", "sessions", runId)}/${agentId}/workspace`,
    ]);
    expect(success.workspaces.missing).toEqual([]);
    expect(success.artifacts.purged).toBe(false);
    expect(success.artifacts.removed).toEqual([]);
    expect(success.artifacts.missing).toEqual([]);
    expect(success.branches.deleted).toEqual([branchName]);
    expect(success.branches.skipped).toEqual([]);
    expect(success.createdAt).toBe("2025-10-15T10:00:00.000Z");
    expect(success.deletedAt).toBe("2025-10-15T12:00:00.000Z");
    await expect(access(workspacePath, fsConstants.F_OK)).rejects.toThrow();
    await expect(
      access(join(artifactsPath, "stdout.log"), fsConstants.F_OK),
    ).resolves.toBeUndefined();
    await expect(
      access(join(artifactsPath, "stderr.log"), fsConstants.F_OK),
    ).resolves.toBeUndefined();
    await expect(
      access(join(artifactsPath, "diff.patch"), fsConstants.F_OK),
    ).resolves.toBeUndefined();
    await expect(
      access(join(artifactsPath, "summary.txt"), fsConstants.F_OK),
    ).resolves.toBeUndefined();
    await expect(access(evalsPath, fsConstants.F_OK)).resolves.toBeUndefined();
    await expect(access(runPath, fsConstants.F_OK)).resolves.toBeUndefined();

    const branchList = await gitBranchList(repoRoot, branchName);
    expect(branchList).toBe("");

    const updatedRecords = await readRunRecords(repoRoot, runsFilePath);
    expect(updatedRecords).toHaveLength(1);
    expect(updatedRecords[0]).toMatchObject({
      runId,
      status: "pruned",
      deletedAt: "2025-10-15T12:00:00.000Z",
    });

    expect(confirmations).toHaveLength(1);
    const firstConfirmation = confirmations[0];
    if (!firstConfirmation) {
      throw new Error("Expected confirmation details to be captured");
    }
    const prefaceLines = firstConfirmation.prefaceLines ?? [];
    const normalizedPrefaceLines = prefaceLines.map((line) =>
      stripAnsi(line).trimEnd(),
    );
    expect(normalizedPrefaceLines).toEqual([
      "",
      `${runId} SUCCEEDED`,
      "",
      "Created    2025-10-15 03:00",
      "Spec       specs/sample.md",
      `Workspace  ${formatWorkspacePath("runs", "sessions", runId)}`,
      "",
      "Workspaces to be removed:",
      `  - ${formatWorkspacePath("runs", "sessions", runId)}/${agentId}/workspace`,
      "",
      "Branches to be deleted:",
      `  - ${branchName}`,
      "",
    ]);
    expect(firstConfirmation.message).toBe("Proceed?");
  });

  it("aborts when confirmation is declined", async () => {
    const runId = "run-321";
    const agentId = "codex";
    const branchName = `voratiq/run/${runId}/${agentId}`;
    const runPath = join(sessionsDir, runId);
    const agentPath = join(runPath, agentId);
    const workspacePath = join(agentPath, "workspace");
    const artifactsPath = join(agentPath, "artifacts");

    await mkdir(workspacePath, { recursive: true });
    await mkdir(artifactsPath, { recursive: true });
    await writeFile(join(artifactsPath, "stdout.log"), "stdout", "utf8");
    await writeFile(join(runPath, "prompt.txt"), "Summarize spec", "utf8");

    const headRevision = await gitHeadRevision(repoRoot);
    const runRecord = createRunRecord({
      runId,
      baseRevisionSha: headRevision,
      spec: { path: "specs/decline.md" },
      status: "succeeded",
      createdAt: "2025-10-15T10:30:00.000Z",
      agents: [buildAgentRecord(runId, agentId)],
    });

    await writeRunRecord(repoRoot, runsFilePath, runRecord);
    await execFileAsync("git", ["branch", branchName], { cwd: repoRoot });

    const confirmHandler = () => Promise.resolve(false);

    const result = await executePruneCommand({
      root: repoRoot,
      runsDir,
      runsFilePath,
      runId,
      confirm: confirmHandler,
      clock: () => new Date("2025-10-15T13:00:00.000Z"),
    });

    expect(result.status).toBe("aborted");
    await expect(
      access(workspacePath, fsConstants.F_OK),
    ).resolves.toBeUndefined();
    await expect(
      access(join(artifactsPath, "stdout.log"), fsConstants.F_OK),
    ).resolves.toBeUndefined();

    const branchList = await gitBranchList(repoRoot, branchName);
    expect(branchList).not.toBe("");

    const persistedRecords = await readRunRecords(repoRoot, runsFilePath);
    const firstRecord = persistedRecords[0];
    if (!firstRecord) {
      throw new Error("Expected run record to remain after aborting prune");
    }
    expect(firstRecord.deletedAt).toBeNull();
  });

  it("purges artifacts when requested", async () => {
    const runId = "run-999";
    const agentId = "gemini";
    const branchName = `voratiq/run/${runId}/${agentId}`;
    const runPath = join(sessionsDir, runId);
    const agentPath = join(runPath, agentId);
    const workspacePath = join(agentPath, "workspace");
    const artifactsPath = join(agentPath, "artifacts");
    const evalsPath = join(agentPath, "evals");

    await mkdir(workspacePath, { recursive: true });
    await mkdir(artifactsPath, { recursive: true });
    await writeFile(join(workspacePath, "notes.md"), "scratch", "utf8");
    await writeFile(join(artifactsPath, "stdout.log"), "stdout", "utf8");
    await writeFile(join(artifactsPath, "stderr.log"), "stderr", "utf8");
    await writeFile(join(artifactsPath, "diff.patch"), "diff", "utf8");
    await writeFile(join(artifactsPath, "summary.txt"), "summary", "utf8");
    await mkdir(evalsPath, { recursive: true });
    await writeFile(join(evalsPath, "result.json"), "{}", "utf8");
    await writeFile(join(runPath, "prompt.txt"), "Summarize spec", "utf8");

    const headRevision = await gitHeadRevision(repoRoot);
    const runRecord = createRunRecord({
      runId,
      baseRevisionSha: headRevision,
      spec: { path: "specs/purge.md" },
      status: "succeeded",
      createdAt: "2025-10-15T11:00:00.000Z",
      agents: [buildAgentRecord(runId, agentId)],
    });

    await writeRunRecord(repoRoot, runsFilePath, runRecord);
    await execFileAsync("git", ["branch", branchName], { cwd: repoRoot });

    const confirmations: ConfirmationOptions[] = [];
    const confirmHandler = (options: ConfirmationOptions) => {
      confirmations.push(options);
      return Promise.resolve(true);
    };

    const result = await executePruneCommand({
      root: repoRoot,
      runsDir,
      runsFilePath,
      runId,
      confirm: confirmHandler,
      purge: true,
      clock: () => new Date("2025-10-15T14:00:00.000Z"),
    });

    if (result.status !== "pruned") {
      throw new Error(`Expected pruned status, received ${result.status}`);
    }
    const success: PruneSuccessResult = result;

    expect(success.workspaces.removed).toEqual([
      `${formatWorkspacePath("runs", "sessions", runId)}/${agentId}/workspace`,
    ]);
    expect(success.artifacts.purged).toBe(true);
    expect(success.artifacts.removed).toEqual(
      expect.arrayContaining([
        `${formatWorkspacePath("runs", "sessions", runId)}/${agentId}/artifacts/stdout.log`,
        `${formatWorkspacePath("runs", "sessions", runId)}/${agentId}/artifacts/stderr.log`,
        `${formatWorkspacePath("runs", "sessions", runId)}/${agentId}/artifacts/diff.patch`,
        `${formatWorkspacePath("runs", "sessions", runId)}/${agentId}/artifacts/summary.txt`,
        `${formatWorkspacePath("runs", "sessions", runId)}/${agentId}/evals`,
      ]),
    );
    expect(success.artifacts.missing).toEqual([]);
    expect(success.createdAt).toBe("2025-10-15T11:00:00.000Z");

    await expect(access(workspacePath, fsConstants.F_OK)).rejects.toThrow();
    await expect(
      access(join(artifactsPath, "stdout.log"), fsConstants.F_OK),
    ).rejects.toThrow();
    await expect(
      access(join(artifactsPath, "stderr.log"), fsConstants.F_OK),
    ).rejects.toThrow();
    await expect(
      access(join(artifactsPath, "diff.patch"), fsConstants.F_OK),
    ).rejects.toThrow();
    await expect(
      access(join(artifactsPath, "summary.txt"), fsConstants.F_OK),
    ).rejects.toThrow();
    await expect(access(evalsPath, fsConstants.F_OK)).rejects.toThrow();
    await expect(access(runPath, fsConstants.F_OK)).resolves.toBeUndefined();

    const branchList = await gitBranchList(repoRoot, branchName);
    expect(branchList).toBe("");

    expect(confirmations).toHaveLength(1);
    const firstConfirmation = confirmations[0];
    if (!firstConfirmation) {
      throw new Error("Expected confirmation details to be captured");
    }
    const prefaceLines = firstConfirmation.prefaceLines ?? [];
    const normalizedPrefaceLines = prefaceLines.map((line) =>
      stripAnsi(line).trimEnd(),
    );
    expect(normalizedPrefaceLines).toEqual([
      "",
      `${runId} SUCCEEDED`,
      "",
      "Created    2025-10-15 04:00",
      "Spec       specs/purge.md",
      `Workspace  ${formatWorkspacePath("runs", "sessions", runId)}`,
      "",
      "Directories to be deleted:",
      `  - ${formatWorkspacePath("runs", "sessions", runId)}/${agentId}`,
      "",
      "Branches to be deleted:",
      `  - ${branchName}`,
      "",
    ]);
    expect(firstConfirmation.message).toBe("Proceed?");
  });

  it("fails when the run is already marked deleted", async () => {
    const runId = "run-already-pruned";
    const agentId = "claude";
    const branchName = `voratiq/run/${runId}/${agentId}`;

    const headRevision = await gitHeadRevision(repoRoot);
    const runRecord = createRunRecord({
      runId,
      baseRevisionSha: headRevision,
      spec: { path: "specs/already-pruned.md" },
      status: "pruned",
      createdAt: "2025-10-15T09:00:00.000Z",
      agents: [buildAgentRecord(runId, agentId)],
      deletedAt: "2025-10-15T10:00:00.000Z",
    });

    await writeRunRecord(repoRoot, runsFilePath, runRecord);
    await execFileAsync("git", ["branch", branchName], { cwd: repoRoot });

    await expect(
      executePruneCommand({
        root: repoRoot,
        runsDir,
        runsFilePath,
        runId,
        confirm: () => Promise.resolve(true),
      }),
    ).rejects.toThrow(`Run ${runId} has been deleted.`);
  });

  it("allows two prune commands to mutate history concurrently", async () => {
    const runA = createRunRecord({
      runId: "run-concurrent-a",
      spec: { path: "specs/a.md" },
      status: "succeeded",
      agents: [buildAgentRecord("run-concurrent-a", "claude")],
    });
    const runB = createRunRecord({
      runId: "run-concurrent-b",
      spec: { path: "specs/b.md" },
      status: "succeeded",
      agents: [buildAgentRecord("run-concurrent-b", "codex")],
    });

    await writeRunRecord(repoRoot, runsFilePath, runA);
    await writeRunRecord(repoRoot, runsFilePath, runB);

    const pruneA = executePruneCommand({
      root: repoRoot,
      runsDir,
      runsFilePath,
      runId: runA.runId,
      confirm: () => Promise.resolve(true),
    });
    const pruneB = executePruneCommand({
      root: repoRoot,
      runsDir,
      runsFilePath,
      runId: runB.runId,
      confirm: () => Promise.resolve(true),
    });

    const [resultA, resultB] = await Promise.all([pruneA, pruneB]);
    expect(resultA.status).toBe("pruned");
    expect(resultB.status).toBe("pruned");

    const records = await readRunRecords(repoRoot, runsFilePath);
    const byId = new Map(records.map((record) => [record.runId, record]));
    expect(byId.get(runA.runId)?.status).toBe("pruned");
    expect(byId.get(runB.runId)?.status).toBe("pruned");
  });
});

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

async function gitHeadRevision(root: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  return stdout.trim();
}

async function gitBranchList(root: string, branch: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["branch", "--list", branch], {
    cwd: root,
    encoding: "utf8",
  });
  return stdout.trim();
}

async function writeRunRecord(
  root: string,
  runsFilePath: string,
  record: RunRecord,
): Promise<void> {
  await appendRunRecord({ root, runsFilePath, record });
}

async function readRunRecords(
  _root: string,
  runsFilePath: string,
): Promise<RunRecord[]> {
  const runsDir = dirname(runsFilePath);
  const sessionsDir = join(runsDir, "sessions");
  const indexRaw = await readFile(runsFilePath, "utf8");
  const parsed = indexRaw.trim()
    ? (JSON.parse(indexRaw) as { sessions?: { runId: string }[] })
    : { sessions: [] };
  const entries = parsed.sessions ?? [];
  const records: RunRecord[] = [];
  for (const entry of entries) {
    const recordPath = join(sessionsDir, entry.runId, "record.json");
    const raw = await readFile(recordPath, "utf8");
    records.push(JSON.parse(raw) as RunRecord);
  }
  return records;
}

function buildAgentRecord(
  _runId: string,
  agentId: string,
): AgentInvocationRecord {
  return createAgentInvocationRecord({
    agentId,
    model: `${agentId}-model`,
    status: "succeeded",
    startedAt: "2025-10-15T09:59:00.000Z",
    completedAt: "2025-10-15T10:01:00.000Z",
    evals: [
      { slug: "format", status: "skipped", hasLog: true },
      { slug: "lint", status: "skipped", hasLog: false },
      { slug: "typecheck", status: "skipped", hasLog: false },
      { slug: "tests", status: "skipped", hasLog: false },
    ],
    artifacts: {
      diffAttempted: true,
      diffCaptured: true,
      stdoutCaptured: true,
      stderrCaptured: true,
      summaryCaptured: true,
    },
    commitSha: "abc123def456ghi789jkl012mno345pqrs678t",
  });
}
