import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { Command } from "commander";

import { verifyAgentProviders } from "../../src/agents/runtime/auth.js";
import { runSandboxedAgent } from "../../src/agents/runtime/harness.js";
import { checkPlatformSupport } from "../../src/agents/runtime/sandbox.js";
import {
  createReviewCommand,
  type ReviewCommandOptions,
  runReviewCommand,
} from "../../src/cli/review.js";
import { RunNotFoundCliError } from "../../src/commands/errors.js";
import { parseReviewRecommendation } from "../../src/commands/review/recommendation.js";
import { executeCompetitionWithAdapter } from "../../src/competition/command-adapter.js";
import { ensureSandboxDependencies } from "../../src/preflight/index.js";
import { appendRunRecord } from "../../src/runs/records/persistence.js";
import type { RunRecord } from "../../src/runs/records/types.js";
import { HintedError } from "../../src/utils/errors.js";
import { createWorkspace } from "../../src/workspace/setup.js";
import {
  REVIEW_ARTIFACT_INFO_FILENAME,
  REVIEW_RECOMMENDATION_FILENAME,
} from "../../src/workspace/structure.js";
import { silenceCommander } from "../support/commander.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../support/factories/run-records.js";

const execFileAsync = promisify(execFile);

const runSandboxedAgentMock = jest.mocked(runSandboxedAgent);
const checkPlatformSupportMock = jest.mocked(checkPlatformSupport);
const ensureSandboxDependenciesMock = jest.mocked(ensureSandboxDependencies);
const executeCompetitionWithAdapterMock = jest.mocked(
  executeCompetitionWithAdapter,
);
const verifyAgentProvidersMock = jest.mocked(verifyAgentProviders);

function stripAnsi(value: string): string {
  const esc = String.fromCharCode(27);
  const ansiPattern = new RegExp(`${esc}\\[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
}

let currentTestBaseRevisionSha: string | undefined;

jest.mock("../../src/agents/runtime/harness.js", () => ({
  runSandboxedAgent: jest.fn(),
}));

jest.mock("../../src/agents/runtime/sandbox.js", () => {
  const actual = jest.requireActual<
    typeof import("../../src/agents/runtime/sandbox.js")
  >("../../src/agents/runtime/sandbox.js");
  return {
    ...actual,
    checkPlatformSupport: jest.fn(),
  };
});

jest.mock("../../src/competition/command-adapter.js", () => {
  const actual = jest.requireActual<
    typeof import("../../src/competition/command-adapter.js")
  >("../../src/competition/command-adapter.js");
  return {
    ...actual,
    executeCompetitionWithAdapter: jest.fn(
      actual.executeCompetitionWithAdapter,
    ),
  };
});

jest.mock("../../src/agents/runtime/auth.js", () => ({
  verifyAgentProviders: jest.fn(),
}));

jest.mock("../../src/preflight/index.js", () => {
  const actual = jest.requireActual<
    typeof import("../../src/preflight/index.js")
  >("../../src/preflight/index.js");
  return {
    ...actual,
    ensureSandboxDependencies: jest.fn(),
  };
});

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

    it("allows omitting --agent", async () => {
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
        "abc123",
      ]);

      expect((received as { run?: string }).run).toBe("abc123");
      expect((received as { agent?: string[] }).agent).toEqual([]);
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

      expect((received as { agent?: string[] }).agent).toEqual(["reviewer"]);
    });

    it("parses repeatable --agent preserving order", async () => {
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
        "gamma",
        "--agent",
        "alpha",
      ]);

      expect((received as { agent?: string[] }).agent).toEqual([
        "gamma",
        "alpha",
      ]);
    });

    it("parses --max-parallel", async () => {
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
        "--max-parallel",
        "2",
      ]);

      expect((received as { maxParallel?: number }).maxParallel).toBe(2);
    });

    it("parses --profile", async () => {
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
        "--profile",
        "quality",
      ]);

      expect((received as { profile?: string }).profile).toBe("quality");
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
    let seenManifestPath: string | undefined;
    let seenManifestPayload: string | undefined;

    beforeEach(async () => {
      repoRoot = await mkdtemp(join(tmpdir(), "voratiq-review-"));
      await initGitRepository(repoRoot);
      const baseSha = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      currentTestBaseRevisionSha = baseSha.stdout.trim();
      await mkdir(join(repoRoot, "specs"), { recursive: true });
      await writeFile(join(repoRoot, "specs", "sample.md"), "# Spec\n", "utf8");
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

      checkPlatformSupportMock.mockReset();
      checkPlatformSupportMock.mockImplementation(() => {});
      ensureSandboxDependenciesMock.mockReset();
      ensureSandboxDependenciesMock.mockImplementation(() => {});
      executeCompetitionWithAdapterMock.mockClear();
      verifyAgentProvidersMock.mockReset();
      verifyAgentProvidersMock.mockResolvedValue([]);
      seenManifestPath = undefined;
      seenManifestPayload = undefined;

      runSandboxedAgentMock.mockReset();
      runSandboxedAgentMock.mockImplementation(async (options) => {
        const outputPath = join(options.paths.workspacePath, "review.md");
        const recommendationPath = join(
          options.paths.workspacePath,
          REVIEW_RECOMMENDATION_FILENAME,
        );
        seenManifestPath = join(
          options.paths.workspacePath,
          REVIEW_ARTIFACT_INFO_FILENAME,
        );
        seenManifestPayload = await readFile(seenManifestPath, "utf8");
        const manifest = JSON.parse(seenManifestPayload) as {
          run?: { runId?: string };
          candidates?: Array<{ candidateId?: string }>;
        };
        const runId = manifest.run?.runId ?? "unknown-run";
        const candidateId =
          manifest.candidates?.[0]?.candidateId ?? "r_invalidcandidate";
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(
          outputPath,
          [
            "# Review",
            "",
            "## Specification",
            "**Summary**: summary",
            "",
            "## Key Requirements",
            "- R1: requirement",
            "",
            "## Candidate Assessments",
            `### ${candidateId}`,
            "**Status**: succeeded",
            "**Assessment**: Strong foundation",
            "**Quality**: High",
            "**Eval Signal**: none",
            "**Requirements Coverage**:",
            "- R1: Met — Evidence: artifact",
            "**Implementation Notes**: Looks good.",
            "**Follow-up (if applied)**: none",
            "",
            "## Comparison",
            "Only one candidate.",
            "",
            "## Ranking",
            `1. ${candidateId}`,
            "",
            "## Recommendation",
            `**Preferred Candidate**: ${candidateId}`,
            `**Rationale**: Looks good via ${candidateId}.`,
            "**Next Actions**:",
            `voratiq apply --run ${runId} --agent ${candidateId}`,
            "",
          ].join("\n"),
          "utf8",
        );
        await writeFile(
          recommendationPath,
          `${JSON.stringify(
            {
              preferred_agent: candidateId,
              resolved_preferred_agent: "bogus-agent",
              rationale: `Looks good via ${candidateId}.`,
              next_actions: [
                `- \`voratiq apply --run ${runId} --agent ${candidateId}\``,
                `note: keep ${candidateId} for traceability`,
              ],
            },
            null,
            2,
          )}\n`,
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
      await rm(repoRoot, { recursive: true, force: true });
      currentTestBaseRevisionSha = undefined;
    });

    it("runs the reviewer agent and persists review artifacts", async () => {
      const runRecord = buildRunRecord({
        runId: "20251007-184454-vmtyf",
      });
      await writeRunRecord(repoRoot, runRecord);

      const result = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
        agentIds: ["reviewer"],
      });

      expect(result.body).toContain("```markdown");
      expect(result.body).toContain("## Recommendation");
      expect(result.body).not.toContain("## Resolved Recommendation");
      expect(result.body).toContain("**Preferred Candidate**: codex");
      expect(result.body).toContain("**Preferred Candidate**:");
      expect(result.body).toContain("**Next Actions**:");
      expect(result.body).toContain(
        "- `voratiq apply --run 20251007-184454-vmtyf --agent codex`",
      );
      expect(result.body).toContain(`Review: ${result.outputPath}`);
      expect(result.body).not.toContain("To integrate a solution:");
      expect(result.missingArtifacts).toEqual([]);
      expect(result.body).not.toContain("Warning: Missing artifacts:");
      expect(executeCompetitionWithAdapterMock).toHaveBeenCalledTimes(1);
      const hasReviewerCandidate = (
        executeCompetitionWithAdapterMock.mock.calls as unknown[]
      ).some((call) => {
        if (!Array.isArray(call) || call.length < 1) {
          return false;
        }
        const args = (call as unknown[])[0];
        if (!args || typeof args !== "object") {
          return false;
        }
        const argsRecord = args as Record<string, unknown>;
        if (argsRecord.maxParallel !== 1) {
          return false;
        }
        if (!Array.isArray(argsRecord.candidates)) {
          return false;
        }
        return argsRecord.candidates.some((candidate) => {
          if (!candidate || typeof candidate !== "object") {
            return false;
          }
          return (candidate as Record<string, unknown>).id === "reviewer";
        });
      });
      expect(hasReviewerCandidate).toBe(true);

      const sandboxInvocation = runSandboxedAgentMock.mock.calls.at(-1)?.[0];
      expect(sandboxInvocation).toBeDefined();
      const extraReadProtectedPaths =
        sandboxInvocation?.extraReadProtectedPaths ?? [];
      const extraWriteProtectedPaths =
        sandboxInvocation?.extraWriteProtectedPaths ?? [];
      expect(extraReadProtectedPaths).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/\/\.voratiq\/runs$/u),
          expect.stringMatching(/\/\.voratiq\/specs$/u),
          expect.stringMatching(/\/\.voratiq\/agents\.yaml$/u),
          expect.stringMatching(/\/\.voratiq\/orchestration\.yaml$/u),
        ]),
      );
      expect(extraWriteProtectedPaths).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/\/\.voratiq\/runs$/u),
          expect.stringMatching(/\/\.voratiq\/specs$/u),
          expect.stringMatching(/\/\.voratiq\/agents\.yaml$/u),
          expect.stringMatching(/\/\.voratiq\/orchestration\.yaml$/u),
        ]),
      );

      expect(seenManifestPath).toBeDefined();
      expect(seenManifestPath).toContain(
        join(
          ".voratiq",
          "reviews",
          "sessions",
          result.reviewId,
          "reviewer",
          "workspace",
          REVIEW_ARTIFACT_INFO_FILENAME,
        ),
      );
      expect(seenManifestPayload).toBeDefined();
      const manifest = JSON.parse(seenManifestPayload ?? "{}") as {
        run: { runId: string };
        candidates: Array<{ candidateId: string }>;
      };
      expect(manifest.run.runId).toBe(runRecord.runId);
      expect(manifest.candidates).toHaveLength(1);
      expect(manifest.candidates[0]?.candidateId).toMatch(
        /^r_[a-z0-9]{10,16}$/u,
      );

      const reviewOutputAbsolute = join(repoRoot, result.outputPath);
      await expect(readFile(reviewOutputAbsolute, "utf8")).resolves.toContain(
        "## Recommendation",
      );
      await expect(
        readFile(reviewOutputAbsolute, "utf8"),
      ).resolves.not.toContain("## Resolved Recommendation");
      await expect(
        readFile(reviewOutputAbsolute, "utf8"),
      ).resolves.not.toContain("codex");
      const recommendationOutputAbsolute = join(
        dirname(reviewOutputAbsolute),
        REVIEW_RECOMMENDATION_FILENAME,
      );
      const recommendationPayload = await readFile(
        recommendationOutputAbsolute,
        "utf8",
      );
      const recommendation = parseReviewRecommendation(recommendationPayload);
      expect(recommendation.preferred_agent).toMatch(/^r_[a-z0-9]{10,16}$/u);
      expect(recommendation.resolved_preferred_agent).toBe("codex");
      expect(recommendation.resolved_preferred_agent).not.toBe("bogus-agent");
      expect(recommendation.rationale).toMatch(
        /^Looks good via r_[a-z0-9]{10,16}\.$/u,
      );
      expect(recommendation.next_actions).toEqual([
        expect.stringMatching(
          /^- `voratiq apply --run 20251007-184454-vmtyf --agent r_[a-z0-9]{10,16}`$/u,
        ),
        expect.stringMatching(
          /^note: keep r_[a-z0-9]{10,16} for traceability$/u,
        ),
      ]);
      const blindedAlias = recommendation.preferred_agent;
      expect(blindedAlias).toBeDefined();
      expect(result.body).toContain("**Rationale**: Looks good via codex.");
      expect(result.body).toContain("note: keep codex for traceability");
      expect(result.body).not.toContain(
        `note: keep ${blindedAlias} for traceability`,
      );

      const recommendationArtifactFiles = (
        await readdir(dirname(reviewOutputAbsolute))
      )
        .filter(
          (file) =>
            file === "review.md" ||
            file === "review.blinded.md" ||
            file === "review-resolution.json" ||
            file === "recommendation.json",
        )
        .sort();
      expect(recommendationArtifactFiles).toEqual([
        "recommendation.json",
        "review.md",
      ]);
      await expect(
        readFile(
          join(dirname(reviewOutputAbsolute), "review.blinded.md"),
          "utf8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(
          join(dirname(reviewOutputAbsolute), "review-resolution.json"),
          "utf8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(
          join(dirname(reviewOutputAbsolute), "recommendation-resolved.json"),
          "utf8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });

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
        status: string;
        reviewers: Array<{
          agentId: string;
          status: string;
          outputPath: string;
          completedAt?: string;
        }>;
        completedAt?: string;
        blinded?: {
          enabled?: boolean;
          aliasMap?: Record<string, string>;
        };
      };
      expect(record.runId).toBe(runRecord.runId);
      expect(record.status).toBe("succeeded");
      expect(record.completedAt).toEqual(expect.any(String));
      expect(record.reviewers).toHaveLength(1);
      expect(record.reviewers[0]).toMatchObject({
        agentId: "reviewer",
        status: "succeeded",
        outputPath: result.outputPath,
      });
      expect(record.blinded?.enabled).toBe(true);
      expect(record.blinded?.aliasMap).toBeDefined();
      expect(Object.keys(record.blinded?.aliasMap ?? {})).toHaveLength(1);
      expect(Object.values(record.blinded?.aliasMap ?? {})).toEqual(["codex"]);
      expect(record.blinded).not.toHaveProperty("blindedOutputPath");
      expect(record.blinded).not.toHaveProperty("resolutionPath");

      const indexPath = join(repoRoot, ".voratiq", "reviews", "index.json");
      const indexPayload = JSON.parse(await readFile(indexPath, "utf8")) as {
        sessions: Array<{ sessionId: string; status: string }>;
      };
      expect(indexPayload.sessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sessionId: result.reviewId,
            status: "succeeded",
          }),
        ]),
      );

      await expect(
        readFile(seenManifestPath ?? "", "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("filters blinded review inputs to eligible candidates only", async () => {
      const runId = "20251007-184454-mixed";
      const runRecord = createRunRecord({
        runId,
        baseRevisionSha:
          currentTestBaseRevisionSha ??
          (() => {
            throw new Error("Missing test base revision sha.");
          })(),
        agents: [
          createAgentInvocationRecord({
            agentId: "agent-ok",
            model: "model-ok",
            status: "succeeded",
            evals: [],
            artifacts: { diffCaptured: true, diffAttempted: true },
          }),
          createAgentInvocationRecord({
            agentId: "agent-failed",
            model: "model-failed",
            status: "failed",
            error:
              "Agent process failed. ENOENT: open /tmp/voratiq/agent-failed/.summary.txt",
            evals: [],
            artifacts: { diffCaptured: true, diffAttempted: true },
          }),
          createAgentInvocationRecord({
            agentId: "agent-missing-diff",
            model: "model-missing",
            status: "succeeded",
            evals: [],
            artifacts: { diffCaptured: true, diffAttempted: true },
          }),
          createAgentInvocationRecord({
            agentId: "agent-empty-diff",
            model: "model-empty",
            status: "succeeded",
            evals: [],
            artifacts: { diffCaptured: true, diffAttempted: true },
          }),
          createAgentInvocationRecord({
            agentId: "agent-nodiff",
            model: "model-nodiff",
            status: "succeeded",
            evals: [],
            artifacts: { diffCaptured: false, diffAttempted: true },
          }),
        ],
      });
      await writeRunRecord(repoRoot, runRecord);

      await rm(
        join(
          repoRoot,
          ".voratiq",
          "runs",
          "sessions",
          runId,
          "agent-missing-diff",
          "artifacts",
          "diff.patch",
        ),
        { force: true },
      );
      await writeFile(
        join(
          repoRoot,
          ".voratiq",
          "runs",
          "sessions",
          runId,
          "agent-empty-diff",
          "artifacts",
          "diff.patch",
        ),
        "",
        "utf8",
      );

      const result = await runReviewInRepo(repoRoot, {
        runId,
        agentIds: ["reviewer"],
      });

      expect(result.missingArtifacts).toEqual([]);
      expect(runSandboxedAgentMock).toHaveBeenCalledTimes(1);
      expect(seenManifestPayload).toBeDefined();
      expect(seenManifestPayload).not.toContain("agent-failed");
      expect(seenManifestPayload).not.toContain("agent-missing-diff");
      expect(seenManifestPayload).not.toContain("agent-empty-diff");

      const manifest = JSON.parse(seenManifestPayload ?? "{}") as {
        candidates: Array<{ candidateId: string }>;
      };
      expect(manifest.candidates).toHaveLength(1);

      const sandboxInvocation = runSandboxedAgentMock.mock.calls.at(-1)?.[0];
      const prompt = sandboxInvocation?.prompt ?? "";
      expect(prompt.match(/^- r_[a-z0-9]{10,16}:/gmu)?.length ?? 0).toBe(1);
      expect(prompt).toContain("## Candidate Assessments");
      expect(prompt).toContain("## Ranking");
      expect(prompt).toContain("## Recommendation");
      expect(prompt).toContain("must be a strict best-to-worst list");
      expect(prompt).toContain(
        "`## Ranking` must appear before `## Recommendation`",
      );
      expect(prompt).toContain(
        "`preferred_agent` must be exactly one candidate id and must match ranking #1",
      );
    });

    it("fails fast when no eligible candidates exist", async () => {
      const runId = "20251007-184454-zero-eligible";
      const runRecord = createRunRecord({
        runId,
        agents: [
          createAgentInvocationRecord({
            agentId: "agent-nodiff",
            model: "model-nodiff",
            status: "succeeded",
            evals: [],
            artifacts: { diffCaptured: false, diffAttempted: true },
          }),
          createAgentInvocationRecord({
            agentId: "agent-failed",
            model: "model-failed",
            status: "failed",
            error:
              "Agent process failed. ENOENT: open /tmp/voratiq/agent-failed/.summary.txt",
            evals: [],
            artifacts: { diffCaptured: true, diffAttempted: true },
          }),
        ],
      });
      await writeRunRecord(repoRoot, runRecord);

      await expect(
        runReviewInRepo(repoRoot, { runId, agentIds: ["reviewer"] }),
      ).rejects.toThrow(
        "Review generation failed. No eligible candidates to review.",
      );
      expect(runSandboxedAgentMock).not.toHaveBeenCalled();
    });

    it("allows blinded review when reviewer/provider tokens overlap with run candidates", async () => {
      await writeAgentsConfig(repoRoot, [
        {
          id: "gpt-5-1-codex-mini",
          provider: "codex",
          model: "gpt-5.1-codex-mini",
          enabled: true,
          binary: process.execPath,
        },
        {
          id: "gpt-5-2-codex",
          provider: "codex",
          model: "gpt-5.2-codex",
          enabled: true,
          binary: process.execPath,
        },
      ]);
      const runRecord = buildRunRecord({
        runId: "20251007-184454-overlap",
        runAgentId: "gpt-5-2-codex",
        runAgentModel: "gpt-5.2-codex",
      });
      await writeRunRecord(repoRoot, runRecord);

      await expect(
        runReviewInRepo(repoRoot, {
          runId: runRecord.runId,
          agentIds: ["gpt-5-1-codex-mini"],
        }),
      ).resolves.toMatchObject({
        agentId: "gpt-5-1-codex-mini",
      });
    });

    it("allows blinded review when reviewer agent id equals a run candidate id", async () => {
      await writeAgentsConfig(repoRoot, [
        {
          id: "gpt-5-1-codex-mini",
          provider: "codex",
          model: "gpt-5.1-codex-mini",
          enabled: true,
          binary: process.execPath,
        },
      ]);
      const runRecord = buildRunRecord({
        runId: "20251007-184454-same-agent",
        runAgentId: "gpt-5-1-codex-mini",
        runAgentModel: "gpt-5.1-codex-mini",
      });
      await writeRunRecord(repoRoot, runRecord);

      await expect(
        runReviewInRepo(repoRoot, {
          runId: runRecord.runId,
          agentIds: ["gpt-5-1-codex-mini"],
        }),
      ).resolves.toMatchObject({
        agentId: "gpt-5-1-codex-mini",
      });
    });

    it("allows blinded review when reviewer id is a strict superset of a run candidate id", async () => {
      await writeAgentsConfig(repoRoot, [
        {
          id: "gpt-5-3-codex-high",
          provider: "codex",
          model: "gpt-5.3-codex",
          enabled: true,
          binary: process.execPath,
        },
        {
          id: "gpt-5-3-codex",
          provider: "codex",
          model: "gpt-5.3-codex",
          enabled: true,
          binary: process.execPath,
        },
      ]);
      const runRecord = buildRunRecord({
        runId: "20251007-184454-superset",
        runAgentId: "gpt-5-3-codex",
        runAgentModel: "gpt-5.3-codex",
      });
      await writeRunRecord(repoRoot, runRecord);

      await expect(
        runReviewInRepo(repoRoot, {
          runId: runRecord.runId,
          agentIds: ["gpt-5-3-codex-high"],
        }),
      ).resolves.toMatchObject({
        agentId: "gpt-5-3-codex-high",
      });
    });

    it("resolves reviewer from orchestration when --agent is omitted", async () => {
      const runRecord = buildRunRecord({
        runId: "20251007-184454-vmtyf",
      });
      await writeRunRecord(repoRoot, runRecord);
      await writeOrchestrationConfig(repoRoot, {
        reviewAgentIds: ["reviewer"],
      });

      const result = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
      });

      expect(result.agentId).toBe("reviewer");
      expect(executeCompetitionWithAdapterMock).toHaveBeenCalledWith(
        expect.objectContaining({
          maxParallel: 1,
          candidates: [expect.objectContaining({ id: "reviewer" })],
        }),
      );
    });

    it("resolves reviewer from selected profile when --profile is provided", async () => {
      const runRecord = buildRunRecord({
        runId: "20251007-184454-vmtyf",
      });
      await writeRunRecord(repoRoot, runRecord);
      await writeAgentsConfig(repoRoot, [
        {
          id: "reviewer",
          provider: "codex",
          model: "gpt-5.2-codex",
          enabled: true,
          binary: process.execPath,
        },
        {
          id: "second-reviewer",
          provider: "claude",
          model: "claude-haiku-4-5-20251001",
          enabled: true,
          binary: process.execPath,
        },
      ]);
      await writeOrchestrationConfig(repoRoot, {
        profiles: {
          default: {
            runAgentIds: [],
            reviewAgentIds: ["reviewer"],
            specAgentIds: [],
          },
          quality: {
            runAgentIds: [],
            reviewAgentIds: ["second-reviewer"],
            specAgentIds: [],
          },
        },
      });

      const result = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
        profile: "quality",
      });

      expect(result.agentId).toBe("second-reviewer");
      expect(executeCompetitionWithAdapterMock).toHaveBeenCalledWith(
        expect.objectContaining({
          maxParallel: 1,
          candidates: [expect.objectContaining({ id: "second-reviewer" })],
        }),
      );
    });

    it("uses --agent override instead of orchestration review defaults", async () => {
      const runRecord = buildRunRecord({
        runId: "20251007-184454-vmtyf",
      });
      await writeRunRecord(repoRoot, runRecord);
      await writeAgentsConfig(repoRoot, [
        {
          id: "reviewer",
          provider: "codex",
          model: "gpt-5.2-codex",
          enabled: true,
          binary: process.execPath,
        },
        {
          id: "second-reviewer",
          provider: "claude",
          model: "claude-haiku-4-5-20251001",
          enabled: true,
          binary: process.execPath,
        },
      ]);
      await writeOrchestrationConfig(repoRoot, {
        profiles: {
          default: {
            runAgentIds: [],
            reviewAgentIds: ["second-reviewer", "reviewer"],
            specAgentIds: [],
          },
          quality: {
            runAgentIds: [],
            reviewAgentIds: ["second-reviewer"],
            specAgentIds: [],
          },
        },
      });

      const result = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
        agentIds: ["reviewer"],
        profile: "quality",
      });

      expect(result.agentId).toBe("reviewer");
      expect(executeCompetitionWithAdapterMock).toHaveBeenCalledWith(
        expect.objectContaining({
          maxParallel: 1,
          candidates: [expect.objectContaining({ id: "reviewer" })],
        }),
      );
    });

    it("fails without --agent when orchestration review agents are empty", async () => {
      const runRecord = buildRunRecord({
        runId: "20251007-184454-vmtyf",
      });
      await writeRunRecord(repoRoot, runRecord);
      await writeOrchestrationConfig(repoRoot, {
        reviewAgentIds: [],
      });

      let caught: unknown;
      try {
        await runReviewInRepo(repoRoot, {
          runId: runRecord.runId,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(HintedError);
      const hinted = caught as HintedError;
      expect(hinted.headline).toBe('No agent found for stage "review".');
      expect(
        hinted.hintLines.some((line) => line.includes("Provide --agent <id>")),
      ).toBe(true);
      expect(
        hinted.hintLines.some((line) =>
          line.includes("profiles.default.review.agents"),
        ),
      ).toBe(true);
      expect(executeCompetitionWithAdapterMock).not.toHaveBeenCalled();
    });

    it("fans out without --agent when orchestration review agents contain multiple ids", async () => {
      const runRecord = buildRunRecord({
        runId: "20251007-184454-vmtyf",
      });
      await writeRunRecord(repoRoot, runRecord);
      await writeAgentsConfig(repoRoot, [
        {
          id: "reviewer",
          provider: "codex",
          model: "gpt-5.2-codex",
          enabled: true,
          binary: process.execPath,
        },
        {
          id: "second-reviewer",
          provider: "claude",
          model: "claude-haiku-4-5-20251001",
          enabled: true,
          binary: process.execPath,
        },
      ]);
      await writeOrchestrationConfig(repoRoot, {
        reviewAgentIds: ["reviewer", "second-reviewer"],
      });

      const result = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
      });

      expect(result.reviews).toHaveLength(2);
      expect(result.reviews.map((review) => review.agentId)).toEqual([
        "reviewer",
        "second-reviewer",
      ]);
      expect(result.body).toContain("Reviewer: reviewer");
      expect(result.body).toContain("Reviewer: second-reviewer");
      expect(result.body.indexOf("Reviewer: reviewer")).toBeLessThan(
        result.body.indexOf("Reviewer: second-reviewer"),
      );
      expect(result.body).toContain("---");
      expect(result.body).toContain(
        `Review: .voratiq/reviews/sessions/${result.reviewId}/reviewer/artifacts/review.md`,
      );
      expect(executeCompetitionWithAdapterMock).toHaveBeenCalledWith(
        expect.objectContaining({
          maxParallel: 2,
          candidates: [
            expect.objectContaining({ id: "reviewer" }),
            expect.objectContaining({ id: "second-reviewer" }),
          ],
        }),
      );
    });

    it("renders deterministic multi-review blocks from each reviewer artifact path", async () => {
      const runRecord = buildRunRecord({
        runId: "20251007-184454-deterministic",
      });
      await writeRunRecord(repoRoot, runRecord);
      await writeAgentsConfig(repoRoot, [
        {
          id: "reviewer",
          provider: "codex",
          model: "gpt-5.2-codex",
          enabled: true,
          binary: process.execPath,
        },
        {
          id: "second-reviewer",
          provider: "claude",
          model: "claude-haiku-4-5-20251001",
          enabled: true,
          binary: process.execPath,
        },
      ]);
      await writeOrchestrationConfig(repoRoot, {
        reviewAgentIds: ["reviewer", "second-reviewer"],
      });

      runSandboxedAgentMock.mockImplementation(async (options) => {
        const manifestPath = join(
          options.paths.workspacePath,
          REVIEW_ARTIFACT_INFO_FILENAME,
        );
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
          run?: { runId?: string };
          candidates?: Array<{ candidateId?: string }>;
        };
        const runId = manifest.run?.runId ?? "unknown-run";
        const candidateId =
          manifest.candidates?.[0]?.candidateId ?? "r_invalidcandidate";
        const reviewerId = options.agent.id;
        const rationale =
          reviewerId === "reviewer"
            ? "Primary reviewer rationale."
            : "Secondary reviewer rationale.";

        await writeValidReviewArtifacts({
          workspacePath: options.paths.workspacePath,
          runId,
          candidateId,
          rationale,
        });

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

      const result = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
      });

      const reviewerOnePath = `.voratiq/reviews/sessions/${result.reviewId}/reviewer/artifacts/review.md`;
      const reviewerTwoPath = `.voratiq/reviews/sessions/${result.reviewId}/second-reviewer/artifacts/review.md`;

      expect(result.body).toMatch(
        /Reviewer: reviewer[\s\S]*\*\*Rationale\*\*: Primary reviewer rationale\.[\s\S]*Review: .+/u,
      );
      expect(result.body).toMatch(
        /Reviewer: second-reviewer[\s\S]*\*\*Rationale\*\*: Secondary reviewer rationale\.[\s\S]*Review: .+/u,
      );
      expect(result.body).toContain(`Review: ${reviewerOnePath}`);
      expect(result.body).toContain(`Review: ${reviewerTwoPath}`);
      expect(result.body.match(/\n---\n/gu)?.length ?? 0).toBe(3);
      expect(result.body.indexOf(`Review: ${reviewerOnePath}`)).toBeLessThan(
        result.body.indexOf(`Review: ${reviewerTwoPath}`),
      );
    });

    it("persists mixed reviewer outcomes and leaves no reviewer running", async () => {
      const runRecord = buildRunRecord({
        runId: "20251007-184454-mixed-reviewers",
      });
      await writeRunRecord(repoRoot, runRecord);
      await writeAgentsConfig(repoRoot, [
        {
          id: "reviewer-a",
          provider: "codex",
          model: "gpt-5.2-codex",
          enabled: true,
          binary: process.execPath,
        },
        {
          id: "reviewer-b",
          provider: "claude",
          model: "claude-haiku-4-5-20251001",
          enabled: true,
          binary: process.execPath,
        },
      ]);

      runSandboxedAgentMock.mockImplementation(async (options) => {
        const manifestPath = join(
          options.paths.workspacePath,
          REVIEW_ARTIFACT_INFO_FILENAME,
        );
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
          run?: { runId?: string };
          candidates?: Array<{ candidateId?: string }>;
        };
        const runId = manifest.run?.runId ?? "unknown-run";
        const candidateId =
          manifest.candidates?.[0]?.candidateId ?? "r_invalidcandidate";

        if (options.agent.id === "reviewer-a") {
          await new Promise((resolve) => setTimeout(resolve, 50));
          await writeValidReviewArtifacts({
            workspacePath: options.paths.workspacePath,
            runId,
            candidateId,
            rationale: "Reviewer A completed successfully.",
          });
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
        }

        return {
          exitCode: 1,
          errorMessage: "reviewer-b failed",
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

      const mixedResult = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
        agentIds: ["reviewer-a", "reviewer-b"],
        maxParallel: 2,
      });
      const mixedBody = stripAnsi(mixedResult.body);
      expect(mixedResult.exitCode).toBe(1);
      expect(mixedBody).toContain("Reviewer: reviewer-b FAILED");
      expect(mixedBody).toContain("Error: reviewer-b failed");

      const indexPath = join(repoRoot, ".voratiq", "reviews", "index.json");
      const indexPayload = JSON.parse(await readFile(indexPath, "utf8")) as {
        sessions: Array<{ sessionId: string; status: string }>;
      };
      const reviewId = indexPayload.sessions[0]?.sessionId;
      expect(reviewId).toEqual(expect.any(String));

      const recordPath = join(
        repoRoot,
        ".voratiq",
        "reviews",
        "sessions",
        reviewId ?? "",
        "record.json",
      );
      const record = JSON.parse(await readFile(recordPath, "utf8")) as {
        status: string;
        reviewers: Array<{
          agentId: string;
          status: string;
          outputPath: string;
        }>;
      };

      expect(record.status).toBe("failed");
      expect(record.reviewers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            agentId: "reviewer-a",
            status: "succeeded",
          }),
          expect.objectContaining({
            agentId: "reviewer-b",
            status: "failed",
          }),
        ]),
      );
      expect(
        record.reviewers.some((reviewer) => reviewer.status === "running"),
      ).toBe(false);

      const reviewerAArtifact = join(
        repoRoot,
        ".voratiq",
        "reviews",
        "sessions",
        reviewId ?? "",
        "reviewer-a",
        "artifacts",
        "review.md",
      );
      await expect(readFile(reviewerAArtifact, "utf8")).resolves.toContain(
        "## Recommendation",
      );
    });

    it("omits missing-artifact warnings from transcript output", async () => {
      const runRecord = buildRunRecord({
        runId: "20251212-090000-zzz999",
        includeDiff: true,
        includeChatJsonl: true,
      });
      await writeRunRecord(repoRoot, runRecord);

      const result = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
        agentIds: ["reviewer"],
      });

      expect(result.missingArtifacts).toEqual([]);
      expect(result.body).not.toContain("Warning: Missing artifacts:");
    });

    it("preserves run lookup error shape when run is missing", async () => {
      await writeFile(
        join(repoRoot, ".voratiq", "runs", "index.json"),
        "",
        "utf8",
      );

      await expect(
        withRepoCwd(repoRoot, () =>
          runReviewCommand({ runId: "missing-run", agentIds: ["reviewer"] }),
        ),
      ).rejects.toBeInstanceOf(RunNotFoundCliError);

      await expect(
        withRepoCwd(repoRoot, () =>
          runReviewCommand({ runId: "missing-run", agentIds: ["reviewer"] }),
        ),
      ).rejects.toMatchObject({
        headline: "Run missing-run not found.",
        detailLines: ["To review past runs: voratiq list"],
      });
    });

    it("throws when the run index contains invalid JSON", async () => {
      const runsFilePath = join(repoRoot, ".voratiq", "runs", "index.json");
      await writeFile(runsFilePath, '{"invalid":', "utf8");

      await expect(
        withRepoCwd(repoRoot, () =>
          runReviewCommand({ runId: "any-run", agentIds: ["reviewer"] }),
        ),
      ).rejects.toThrow("Failed to parse .voratiq/runs/index.json:");
    });

    it("preserves reviewer process-failure error shape", async () => {
      const runRecord = buildRunRecord({
        runId: "20251007-184454-vmtyf",
      });
      await writeRunRecord(repoRoot, runRecord);

      runSandboxedAgentMock.mockResolvedValueOnce({
        exitCode: 1,
        errorMessage: "review process failed",
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
      });

      const failedResult = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
        agentIds: ["reviewer"],
      });
      const failedBody = stripAnsi(failedResult.body);
      expect(failedResult.exitCode).toBe(1);
      expect(failedBody).toContain("Reviewer: reviewer FAILED");
      expect(failedBody).toContain("Error: review process failed");

      const indexPath = join(repoRoot, ".voratiq", "reviews", "index.json");
      const indexPayload = JSON.parse(await readFile(indexPath, "utf8")) as {
        sessions: Array<{ sessionId: string; status: string }>;
      };
      expect(indexPayload.sessions).toHaveLength(1);
      expect(indexPayload.sessions[0]?.status).toBe("failed");

      const failedRecordPath = join(
        repoRoot,
        ".voratiq",
        "reviews",
        "sessions",
        indexPayload.sessions[0]?.sessionId ?? "",
        "record.json",
      );
      const failedRecord = JSON.parse(
        await readFile(failedRecordPath, "utf8"),
      ) as {
        status: string;
        error?: string;
      };
      expect(failedRecord.status).toBe("failed");
      expect(failedRecord.error).toBe("review process failed");
    });

    it("preserves missing-output failure shape", async () => {
      const runRecord = buildRunRecord({
        runId: "20251007-184454-vmtyf",
      });
      await writeRunRecord(repoRoot, runRecord);

      runSandboxedAgentMock.mockImplementationOnce(() =>
        Promise.resolve({
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
        }),
      );

      const missingOutputResult = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
        agentIds: ["reviewer"],
      });
      expect(missingOutputResult.exitCode).toBe(1);
      expect(stripAnsi(missingOutputResult.body)).toContain(
        "Error: Reviewer process failed. No review output detected.",
      );
    });

    it("preserves missing recommendation-output failure shape", async () => {
      const runRecord = buildRunRecord({
        runId: "20251007-184454-missing-recommendation",
      });
      await writeRunRecord(repoRoot, runRecord);

      runSandboxedAgentMock.mockImplementationOnce(async (options) => {
        const outputPath = join(options.paths.workspacePath, "review.md");
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, "## Recommendation\n", "utf8");
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

      const result = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
        agentIds: ["reviewer"],
      });
      expect(result.exitCode).toBe(1);
      expect(stripAnsi(result.body)).toContain(
        "Error: Reviewer process failed. No recommendation output detected.",
      );
    });

    it("fails when review markdown section order is invalid", async () => {
      const runRecord = buildRunRecord({
        runId: "20251007-184454-invalid-order",
      });
      await writeRunRecord(repoRoot, runRecord);

      runSandboxedAgentMock.mockImplementationOnce(async (options) => {
        const outputPath = join(options.paths.workspacePath, "review.md");
        const recommendationPath = join(
          options.paths.workspacePath,
          REVIEW_RECOMMENDATION_FILENAME,
        );
        const manifestPath = join(
          options.paths.workspacePath,
          REVIEW_ARTIFACT_INFO_FILENAME,
        );
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
          candidates?: Array<{ candidateId?: string }>;
        };
        const candidateId =
          manifest.candidates?.[0]?.candidateId ?? "r_invalidcandidate";

        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(
          outputPath,
          [
            "# Review",
            "",
            "## Specification",
            "**Summary**: summary",
            "",
            "## Key Requirements",
            "- R1: requirement",
            "",
            "## Candidate Assessments",
            `### ${candidateId}`,
            "Assessment text.",
            "",
            "## Comparison",
            "Comparison text.",
            "",
            "## Recommendation",
            `**Preferred Candidate**: ${candidateId}`,
            "**Rationale**: rationale",
            "**Next Actions**:",
            "none",
            "",
            "## Ranking",
            `1. ${candidateId}`,
            "",
          ].join("\n"),
          "utf8",
        );
        await writeFile(
          recommendationPath,
          `${JSON.stringify(
            {
              preferred_agent: candidateId,
              rationale: "rationale",
              next_actions: [],
            },
            null,
            2,
          )}\n`,
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

      const invalidOrderResult = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
        agentIds: ["reviewer"],
      });
      expect(invalidOrderResult.exitCode).toBe(1);
      expect(stripAnsi(invalidOrderResult.body)).toContain(
        "Error: Invalid output: review.md",
      );
    });

    it("fails when ranking contains duplicates", async () => {
      const runRecord = buildRunRecord({
        runId: "20251007-184454-invalid-ranking",
      });
      await writeRunRecord(repoRoot, runRecord);

      runSandboxedAgentMock.mockImplementationOnce(async (options) => {
        const outputPath = join(options.paths.workspacePath, "review.md");
        const recommendationPath = join(
          options.paths.workspacePath,
          REVIEW_RECOMMENDATION_FILENAME,
        );
        const manifestPath = join(
          options.paths.workspacePath,
          REVIEW_ARTIFACT_INFO_FILENAME,
        );
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
          candidates?: Array<{ candidateId?: string }>;
        };
        const candidateId =
          manifest.candidates?.[0]?.candidateId ?? "r_invalidcandidate";

        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(
          outputPath,
          [
            "# Review",
            "",
            "## Specification",
            "**Summary**: summary",
            "",
            "## Key Requirements",
            "- R1: requirement",
            "",
            "## Candidate Assessments",
            `### ${candidateId}`,
            "Assessment text.",
            "",
            "## Comparison",
            "Comparison text.",
            "",
            "## Ranking",
            `1. ${candidateId}`,
            `2. ${candidateId}`,
            "",
            "## Recommendation",
            `**Preferred Candidate**: ${candidateId}`,
            "**Rationale**: rationale",
            "**Next Actions**:",
            "none",
            "",
          ].join("\n"),
          "utf8",
        );
        await writeFile(
          recommendationPath,
          `${JSON.stringify(
            {
              preferred_agent: candidateId,
              rationale: "rationale",
              next_actions: [],
            },
            null,
            2,
          )}\n`,
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

      const invalidRankingResult = await runReviewInRepo(repoRoot, {
        runId: runRecord.runId,
        agentIds: ["reviewer"],
      });
      expect(invalidRankingResult.exitCode).toBe(1);
      expect(stripAnsi(invalidRankingResult.body)).toContain(
        "Error: Invalid output: review.md",
      );
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
  const templateDir = join(root, ".git-template");
  await mkdir(templateDir, { recursive: true });
  await execFileAsync("git", ["init", "--template", templateDir], {
    cwd: root,
  });
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

async function writeOrchestrationConfig(
  root: string,
  options: {
    runAgentIds?: readonly string[];
    reviewAgentIds?: readonly string[];
    specAgentIds?: readonly string[];
    profiles?: Record<
      string,
      {
        runAgentIds?: readonly string[];
        reviewAgentIds?: readonly string[];
        specAgentIds?: readonly string[];
      }
    >;
  } = {},
): Promise<void> {
  const profiles =
    options.profiles ??
    ({
      default: {
        runAgentIds: options.runAgentIds ?? [],
        reviewAgentIds: options.reviewAgentIds ?? [],
        specAgentIds: options.specAgentIds ?? [],
      },
    } satisfies Record<
      string,
      {
        runAgentIds?: readonly string[];
        reviewAgentIds?: readonly string[];
        specAgentIds?: readonly string[];
      }
    >);

  const lines = ["profiles:"];
  for (const [profileName, profileStages] of Object.entries(profiles)) {
    lines.push(`  ${profileName}:`);
    appendOrchestrationStage(lines, "run", profileStages.runAgentIds ?? []);
    appendOrchestrationStage(
      lines,
      "review",
      profileStages.reviewAgentIds ?? [],
    );
    appendOrchestrationStage(lines, "spec", profileStages.specAgentIds ?? []);
  }
  lines.push("");

  await writeFile(
    join(root, ".voratiq", "orchestration.yaml"),
    `${lines.join("\n")}\n`,
    "utf8",
  );
}

function appendOrchestrationStage(
  lines: string[],
  stageId: "run" | "review" | "spec",
  agentIds: readonly string[],
): void {
  lines.push(`    ${stageId}:`);
  if (agentIds.length === 0) {
    lines.push("      agents: []");
    return;
  }

  lines.push("      agents:");
  for (const agentId of agentIds) {
    lines.push(`        - id: ${JSON.stringify(agentId)}`);
  }
}

async function writeRunRecord(root: string, record: RunRecord): Promise<void> {
  const runsFilePath = join(root, ".voratiq", "runs", "index.json");
  await appendRunRecord({ root, runsFilePath, record });
  await writeRunDiffArtifacts(root, record);
}

function buildRunRecord(options: {
  runId: string;
  includeDiff?: boolean;
  includeChatJsonl?: boolean;
  baseRevisionSha?: string;
  runAgentId?: string;
  runAgentModel?: string;
}): RunRecord {
  const {
    runId,
    includeDiff = true,
    includeChatJsonl = false,
    baseRevisionSha,
    runAgentId = "codex",
    runAgentModel = "gpt-5.2-codex",
  } = options;

  const artifacts = includeDiff || includeChatJsonl ? {} : undefined;

  const agentRecord = createAgentInvocationRecord({
    agentId: runAgentId,
    model: runAgentModel,
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
    baseRevisionSha:
      baseRevisionSha ??
      currentTestBaseRevisionSha ??
      (() => {
        throw new Error("Missing test base revision sha.");
      })(),
  });
}

async function writeRunDiffArtifacts(
  root: string,
  record: RunRecord,
): Promise<void> {
  const diffPayload = "diff --git a/src/index.ts b/src/index.ts\n+test\n";
  await Promise.all(
    (record.agents ?? []).map(async (agent) => {
      const diffCaptured = agent.artifacts?.diffCaptured ?? false;
      if (!diffCaptured) {
        return;
      }
      const diffPath = join(
        root,
        ".voratiq",
        "runs",
        "sessions",
        record.runId,
        agent.agentId,
        "artifacts",
        "diff.patch",
      );
      await mkdir(dirname(diffPath), { recursive: true });
      await writeFile(diffPath, diffPayload, "utf8");
    }),
  );
}

async function writeValidReviewArtifacts(options: {
  workspacePath: string;
  runId: string;
  candidateId: string;
  rationale: string;
}): Promise<void> {
  const { workspacePath, runId, candidateId, rationale } = options;
  const reviewPath = join(workspacePath, "review.md");
  const recommendationPath = join(
    workspacePath,
    REVIEW_RECOMMENDATION_FILENAME,
  );

  await mkdir(dirname(reviewPath), { recursive: true });
  await writeFile(
    reviewPath,
    [
      "# Review",
      "",
      "## Specification",
      "**Summary**: summary",
      "",
      "## Key Requirements",
      "- R1: requirement",
      "",
      "## Candidate Assessments",
      `### ${candidateId}`,
      "**Status**: succeeded",
      "**Assessment**: Strong foundation",
      "**Quality**: High",
      "**Eval Signal**: none",
      "**Requirements Coverage**:",
      "- R1: Met — Evidence: artifact",
      "**Implementation Notes**: Looks good.",
      "**Follow-up (if applied)**: none",
      "",
      "## Comparison",
      "Only one candidate.",
      "",
      "## Ranking",
      `1. ${candidateId}`,
      "",
      "## Recommendation",
      `**Preferred Candidate**: ${candidateId}`,
      `**Rationale**: ${rationale}`,
      "**Next Actions**:",
      `voratiq apply --run ${runId} --agent ${candidateId}`,
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    recommendationPath,
    `${JSON.stringify(
      {
        preferred_agent: candidateId,
        resolved_preferred_agent: "bogus-agent",
        rationale,
        next_actions: [
          `- \`voratiq apply --run ${runId} --agent ${candidateId}\``,
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
