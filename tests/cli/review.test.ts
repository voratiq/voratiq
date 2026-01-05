import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { Command } from "commander";

import * as harness from "../../src/agents/runtime/harness.js";
import * as sandboxRuntime from "../../src/agents/runtime/sandbox.js";
import {
  createReviewCommand,
  type ReviewCommandOptions,
  runReviewCommand,
} from "../../src/cli/review.js";
import * as preflight from "../../src/preflight/index.js";
import { appendRunRecord } from "../../src/runs/records/persistence.js";
import type { RunRecord } from "../../src/runs/records/types.js";
import { createWorkspace } from "../../src/workspace/setup.js";
import { silenceCommander } from "../support/commander.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../support/factories/run-records.js";

const execFileAsync = promisify(execFile);

const runSandboxedAgentMock = jest.mocked(harness.runSandboxedAgent);

jest.mock("../../src/agents/runtime/harness.js", () => ({
  runSandboxedAgent: jest.fn(),
}));

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

    it("parses --agent", async () => {
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
        "--agent",
        "reviewer",
      ]);

      expect((received as { agent?: string }).agent).toBe("reviewer");
    });

    it("prints help text", () => {
      const command = silenceCommander(createReviewCommand());
      const help = command.helpInformation();
      expect(help).toContain("Usage: review [options]");
      expect(help).toContain("--run <run-id>");
      expect(help).toContain("--agent <agent-id>");
    });
  });

  describe("runReviewCommand", () => {
    let repoRoot: string;
    let restorePlatformSpy: jest.SpyInstance | undefined;
    let restoreDependenciesSpy: jest.SpyInstance | undefined;

    beforeEach(async () => {
      repoRoot = await mkdtemp(join(tmpdir(), "voratiq-review-"));
      await initGitRepository(repoRoot);
      await createWorkspace(repoRoot);
      await writeAgentsConfig(repoRoot, [
        {
          id: "reviewer",
          provider: "codex",
          model: "gpt-5.2-codex",
          enabled: true,
          binary: process.execPath,
        },
      ]);

      restorePlatformSpy = jest
        .spyOn(sandboxRuntime, "checkPlatformSupport")
        .mockImplementation(() => {});
      restoreDependenciesSpy = jest
        .spyOn(preflight, "ensureSandboxDependencies")
        .mockImplementation(() => {});

      runSandboxedAgentMock.mockReset();
      runSandboxedAgentMock.mockImplementation(async (options) => {
        const outputPath = join(options.paths.workspacePath, "review.md");
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(
          outputPath,
          [
            "# Review",
            "",
            "## Summary",
            "Looks good.",
            "",
            "## Agent Findings",
            "- N/A",
            "",
            "## Evaluations",
            "- N/A",
            "",
            "## Risks / Missing Artifacts",
            "- N/A",
            "",
            "## Recommendations",
            "- N/A",
            "",
          ].join("\n"),
          "utf8",
        );
        return {
          exitCode: 0,
          sandboxSettings: {
            network: {
              allowedDomains: [],
              deniedDomains: [],
            },
            filesystem: {
              denyRead: [],
              allowWrite: [],
              denyWrite: [],
            },
          },
          manifestEnv: {},
        };
      });
    });

    afterEach(async () => {
      restorePlatformSpy?.mockRestore();
      restoreDependenciesSpy?.mockRestore();
      await rm(repoRoot, { recursive: true, force: true });
    });

    it("runs the reviewer agent and persists review artifacts", async () => {
      const runRecord = buildRunRecord({
        runId: "20251007-184454-vmtyf",
      });
      await writeRunRecord(repoRoot, runRecord);

      const result = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
        agentId: "reviewer",
      });

      expect(result.body).toContain("Review saved: ");
      expect(result.body).toContain(
        `To integrate a solution:\n  voratiq apply --run ${runRecord.runId} --agent <agent-id>`,
      );
      expect(result.missingArtifacts).toEqual([]);

      const reviewOutputAbsolute = join(repoRoot, result.outputPath);
      await expect(readFile(reviewOutputAbsolute, "utf8")).resolves.toContain(
        "## Summary",
      );

      const recordPath = join(
        repoRoot,
        ".voratiq",
        "reviews",
        "sessions",
        result.reviewId,
        "record.json",
      );
      const record = JSON.parse(await readFile(recordPath, "utf8")) as {
        runId: string;
        agentId: string;
        status: string;
        outputPath: string;
      };
      expect(record.runId).toBe(runRecord.runId);
      expect(record.agentId).toBe("reviewer");
      expect(record.status).toBe("succeeded");
      expect(record.outputPath).toBe(result.outputPath);
    });

    it("prints a warning when run artifacts are missing", async () => {
      const runRecord = buildRunRecord({
        runId: "20251212-090000-zzz999",
        includeDiff: true,
        includeChatJsonl: true,
      });
      await writeRunRecord(repoRoot, runRecord);

      const result = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
        agentId: "reviewer",
      });

      expect(result.missingArtifacts).toEqual(["diff.patch", "chat.jsonl"]);
      expect(result.body).toContain(
        "Warning: Missing artifacts: diff.patch, chat.jsonl. Review may be incomplete.",
      );
    });

    it("throws a descriptive error when run is missing", async () => {
      await writeFile(
        join(repoRoot, ".voratiq", "runs", "index.json"),
        "",
        "utf8",
      );

      await expect(
        withRepoCwd(repoRoot, () =>
          runReviewCommand({ runId: "missing-run", agentId: "reviewer" }),
        ),
      ).rejects.toThrow("Run missing-run not found.");
    });

    it("throws when the run index contains invalid JSON", async () => {
      const runsFilePath = join(repoRoot, ".voratiq", "runs", "index.json");
      await writeFile(runsFilePath, '{"invalid":', "utf8");

      await expect(
        withRepoCwd(repoRoot, () =>
          runReviewCommand({ runId: "any-run", agentId: "reviewer" }),
        ),
      ).rejects.toThrow("Failed to parse .voratiq/runs/index.json:");
    });
  });
});

async function runReviewInRepo(
  repoRoot: string,
  options: ReviewCommandOptions,
) {
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

async function writeAgentsConfig(
  root: string,
  agents: Array<{
    id: string;
    provider: string;
    model: string;
    enabled: boolean;
    binary: string;
  }>,
): Promise<void> {
  const header = "agents:\n";
  const body = agents
    .map((agent) =>
      [
        `  - id: ${agent.id}`,
        `    provider: ${agent.provider}`,
        `    model: ${agent.model}`,
        `    enabled: ${agent.enabled ? "true" : "false"}`,
        `    binary: ${JSON.stringify(agent.binary)}`,
      ].join("\n"),
    )
    .join("\n\n");
  const payload = `${header}${body}\n`;
  await writeFile(join(root, ".voratiq", "agents.yaml"), payload, "utf8");
}

async function writeRunRecord(root: string, record: RunRecord): Promise<void> {
  const runsFilePath = join(root, ".voratiq", "runs", "index.json");
  await appendRunRecord({ root, runsFilePath, record });
}

function buildRunRecord(options: {
  runId: string;
  includeDiff?: boolean;
  includeChatJsonl?: boolean;
}): RunRecord {
  const { runId, includeDiff = false, includeChatJsonl = false } = options;

  const artifacts = includeDiff || includeChatJsonl ? {} : undefined;

  const agentRecord = createAgentInvocationRecord({
    agentId: "codex",
    status: "succeeded",
    evals: [],
    artifacts: {
      diffAttempted: includeDiff,
      diffCaptured: includeDiff,
      chatCaptured: includeChatJsonl,
      chatFormat: includeChatJsonl ? "jsonl" : undefined,
      stdoutCaptured: false,
      stderrCaptured: false,
      summaryCaptured: false,
      ...artifacts,
    },
  });

  return createRunRecord({
    runId,
    agents: [agentRecord],
    status: "succeeded",
    deletedAt: null,
  });
}
