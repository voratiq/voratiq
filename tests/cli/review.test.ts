import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { Command } from "commander";

import {
  createReviewCommand,
  type ReviewCommandOptions,
  type ReviewCommandResult,
  runReviewCommand,
} from "../../src/cli/review.js";
import type { EvalSlug } from "../../src/configs/evals/types.js";
import {
  formatAgentBadge,
  formatRunBadge,
} from "../../src/render/utils/badges.js";
import { formatRunTimestamp } from "../../src/render/utils/records.js";
import { appendRunRecord } from "../../src/runs/records/persistence.js";
import type {
  AgentEvalSnapshot,
  RunRecord,
} from "../../src/runs/records/types.js";
import { colorize } from "../../src/utils/colors.js";
import { createWorkspace } from "../../src/workspace/setup.js";
import { silenceCommander } from "../support/commander.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../support/factories/run-records.js";

const execFileAsync = promisify(execFile);
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

describe("voratiq review", () => {
  describe("command options", () => {
    it("requires --run", async () => {
      const reviewCommand = silenceCommander(createReviewCommand());
      reviewCommand.exitOverride().action(() => {});

      const program = silenceCommander(new Command());
      program.exitOverride().addCommand(reviewCommand);

      await expect(
        program.parseAsync(["node", "voratiq", "review"]),
      ).rejects.toThrow(/required option '--run <run-id>'/iu);
    });

    it("parses --run", async () => {
      let received: unknown;
      const reviewCommand = silenceCommander(createReviewCommand());
      reviewCommand.exitOverride().action((options) => {
        received = options;
      });

      const program = silenceCommander(new Command());
      program.exitOverride().addCommand(reviewCommand);

      await program.parseAsync([
        "node",
        "voratiq",
        "review",
        "--run",
        "20250101-abcde",
      ]);

      expect((received as { run?: string }).run).toBe("20250101-abcde");
    });

    it("prints help text", () => {
      const command = silenceCommander(createReviewCommand());
      const help = command.helpInformation();
      expect(help).toContain("Usage: review [options]");
      expect(help).toContain("--run <run-id>");
    });
  });

  describe("runReviewCommand", () => {
    let repoRoot: string;

    beforeEach(async () => {
      repoRoot = await mkdtemp(join(tmpdir(), "voratiq-review-"));
      await initGitRepository(repoRoot);
      await createWorkspace(repoRoot);
    });

    afterEach(async () => {
      await rm(repoRoot, { recursive: true, force: true });
    });

    it("renders review summary for the requested run", async () => {
      const runRecord = buildRunRecord({
        runId: "20251007-184454-vmtyf",
        specPath: "specs/hello-world.md",
        baseRevisionSha: "abc1234",
      });

      await writeRunRecord(repoRoot, runRecord);

      const result = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
      });

      const body = result.body ?? "";
      const plainBody = body.replace(ANSI_PATTERN, "");
      const normalizedBody = plainBody.replace(/\s+/g, " ");
      const expectedRunHeader = `${formatRunBadge(runRecord.runId)} ${colorize(
        "SUCCEEDED",
        "green",
      )}`;
      expect(body).toContain(expectedRunHeader);
      expect(normalizedBody).toContain("Spec specs/hello-world.md");
      expect(normalizedBody).toContain(
        "Workspace .voratiq/runs/sessions/20251007-184454-vmtyf",
      );
      expect(normalizedBody).toContain(
        "Root .voratiq/runs/sessions/20251007-184454-vmtyf/claude",
      );
      expect(normalizedBody).toContain("RUNTIME PATH");
      expect(normalizedBody).toContain("manifest runtime/manifest.json");
      expect(normalizedBody).toContain("sandbox runtime/sandbox.json");
      const expectedCreated = formatRunTimestamp(runRecord.createdAt);
      expect(normalizedBody).toContain(`Created ${expectedCreated}`);
      expect(normalizedBody).toContain("Base Revision abc1234");
      const expectedHeader = `  ${formatAgentBadge("claude")} ${colorize(
        "SUCCEEDED",
        "green",
      )}`;
      expect(body).toContain(expectedHeader);
      expect(normalizedBody).toContain("Duration 1m");
      expect(normalizedBody).toContain(
        "Root .voratiq/runs/sessions/20251007-184454-vmtyf/claude",
      );
      expect(normalizedBody).toContain("EVAL STATUS LOG");
      expect(normalizedBody).toContain("format SUCCEEDED evals/format.log");
      expect(normalizedBody).toContain("ARTIFACT PATH");
      expect(normalizedBody).toContain("summary artifacts/summary.txt");
      expect(normalizedBody).toContain("diff artifacts/diff.patch");
      expect(normalizedBody).toContain("stdout artifacts/stdout.log");
      expect(normalizedBody).toContain("stderr artifacts/stderr.log");
      expect(plainBody).toContain(
        "Error: Agent failed to modify the workspace",
      );
      expect(body).toContain(
        "To integrate a solution:\n  voratiq apply --run 20251007-184454-vmtyf --agent <agent-id>",
      );
      const lines = body
        .split("\n")
        .map((line) => line.replace(ANSI_PATTERN, ""));
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(120);
      }
      expect(result.exitCode).toBeUndefined();
    });

    it("renders pruned runs with status context", async () => {
      const runRecord = buildRunRecord({
        runId: "20251007-184454-deleted",
        specPath: "specs/hello-world.md",
        baseRevisionSha: "abc1234",
        deletedAt: "2025-10-12T16:45:12Z",
      });

      await writeRunRecord(repoRoot, runRecord);

      const result = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
      });

      const body = result.body ?? "";
      const plainBody = body.replace(ANSI_PATTERN, "");
      const normalizedBody = plainBody.replace(/\s+/g, " ");
      expect(normalizedBody).toContain("20251007-184454-deleted PRUNED");
      expect(normalizedBody).toContain("Spec specs/hello-world.md");
      expect(normalizedBody).toContain(
        "Root .voratiq/runs/sessions/20251007-184454-deleted/claude",
      );
      expect(normalizedBody).toContain("Note: Run was pruned");
    });

    it("throws a descriptive error when run is missing", async () => {
      await writeFile(
        join(repoRoot, ".voratiq", "runs", "index.json"),
        "",
        "utf8",
      );

      await expect(
        withRepoCwd(repoRoot, () => runReviewCommand({ runId: "missing-run" })),
      ).rejects.toThrow("Run missing-run not found.");
    });

    it("throws when the run index contains invalid JSON", async () => {
      const runsFilePath = join(repoRoot, ".voratiq", "runs", "index.json");
      await writeFile(runsFilePath, '{"invalid":', "utf8");

      await expect(
        withRepoCwd(repoRoot, () => runReviewCommand({ runId: "any-run" })),
      ).rejects.toThrow("Failed to parse .voratiq/runs/index.json:");
    });
  });
});

async function runReviewInRepo(
  repoRoot: string,
  options: ReviewCommandOptions,
): Promise<ReviewCommandResult> {
  return await withRepoCwd(repoRoot, () => runReviewCommand(options));
}

async function withRepoCwd<T>(
  repoRoot: string,
  fn: () => Promise<T>,
): Promise<T> {
  const originalCwd = process.cwd();
  try {
    process.chdir(repoRoot);
    return await fn();
  } finally {
    process.chdir(originalCwd);
  }
}

interface RunRecordInit {
  runId: string;
  specPath: string;
  baseRevisionSha: string;
  status?: RunRecord["status"];
  deletedAt?: string | null;
}

function buildRunRecord(init: RunRecordInit): RunRecord {
  const startedAt = "2025-10-08T18:00:00.000Z";
  const completedAt = "2025-10-08T18:01:00.000Z";
  const { runId, specPath, baseRevisionSha } = init;

  const claudeAgent = createAgentInvocationRecord({
    agentId: "claude",
    model: "claude-test-model",
    status: "succeeded",
    startedAt,
    completedAt,
    commitSha: "4444444444444444444444444444444444444444",
    artifacts: {
      diffAttempted: true,
      diffCaptured: true,
      stdoutCaptured: true,
      stderrCaptured: true,
      summaryCaptured: true,
    },
    evals: createEvalResults({
      format: { hasLog: true },
      lint: { hasLog: true },
      typecheck: { hasLog: true },
      tests: { hasLog: true },
    }),
    error: undefined,
  });

  const codexAgent = createAgentInvocationRecord({
    agentId: "codex",
    model: "codex-test-model",
    status: "failed",
    startedAt,
    completedAt: "2025-10-08T18:00:34.000Z",
    artifacts: {
      diffAttempted: false,
      diffCaptured: false,
      stdoutCaptured: true,
      stderrCaptured: true,
      summaryCaptured: false,
    },
    evals: createEvalResults({
      format: { status: "failed", hasLog: true },
      lint: { status: "failed", hasLog: true },
      typecheck: { status: "failed", hasLog: true },
      tests: { status: "failed", hasLog: true },
    }),
    error: "Agent failed to modify the workspace",
  });

  return createRunRecord({
    runId,
    baseRevisionSha,
    spec: { path: specPath },
    createdAt: "2025-10-08T18:00:00.000Z",
    agents: [claudeAgent, codexAgent],
    status: init.status ?? (init.deletedAt ? "pruned" : "succeeded"),
    deletedAt: init.deletedAt ?? null,
  });
}

function createEvalResults(
  overrides: Partial<Record<EvalSlug, Partial<AgentEvalSnapshot>>> = {},
): AgentEvalSnapshot[] {
  const base: AgentEvalSnapshot[] = [
    { slug: "format", status: "succeeded", hasLog: true },
    { slug: "lint", status: "succeeded", hasLog: true },
    { slug: "typecheck", status: "succeeded", hasLog: true },
    { slug: "tests", status: "succeeded", hasLog: true },
  ];

  return base.map((evaluation) => {
    const override = overrides[evaluation.slug];
    return override ? { ...evaluation, ...override } : evaluation;
  });
}

async function writeRunRecord(root: string, record: RunRecord): Promise<void> {
  const runsFilePath = join(root, ".voratiq", "runs", "index.json");
  await appendRunRecord({ root, runsFilePath, record });
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
