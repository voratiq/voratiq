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

import { runSandboxedAgent } from "../../src/agents/runtime/harness.js";
import { checkPlatformSupport } from "../../src/agents/runtime/sandbox.js";
import {
  createReviewCommand,
  type ReviewCommandOptions,
  runReviewCommand,
} from "../../src/cli/review.js";
import { RunNotFoundCliError } from "../../src/commands/errors.js";
import { ReviewGenerationFailedError } from "../../src/commands/review/errors.js";
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
      expect((received as { agent?: string }).agent).toBeUndefined();
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
            "## Recommendation",
            `**Preferred Candidate(s)**: ${candidateId}`,
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
              version: 1,
              preferred_agents: [candidateId],
              resolved_preferred_agents: ["bogus-agent"],
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
        agentId: "reviewer",
      });

      expect(result.body).toContain("```markdown");
      expect(result.body).toContain("## Recommendation");
      expect(result.body).not.toContain("## Resolved Recommendation");
      expect(result.body).toContain("**Preferred Candidate(s)**: codex");
      expect(result.body).toContain("**Preferred Candidate(s)**:");
      expect(result.body).toContain("**Rationale**: Looks good via codex.");
      expect(result.body).toContain("**Next Actions**:");
      expect(result.body).toContain(
        "- `voratiq apply --run 20251007-184454-vmtyf --agent codex`",
      );
      expect(result.body).toContain(`Full review here: ${result.outputPath}`);
      expect(result.body).not.toContain("To integrate a solution:");
      expect(result.missingArtifacts).toEqual(["diff.patch"]);
      expect(result.body).toContain(
        "Warning: Missing artifacts: diff.patch. Review may be incomplete.",
      );
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
      expect(recommendation.version).toBe(1);
      expect(recommendation.preferred_agents).toEqual([
        expect.stringMatching(/^r_[a-z0-9]{10,16}$/u),
      ]);
      expect(recommendation.resolved_preferred_agents).toEqual(["codex"]);
      expect(recommendation.resolved_preferred_agents).not.toContain(
        "bogus-agent",
      );
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
      const blindedAlias = recommendation.preferred_agents[0];
      expect(blindedAlias).toBeDefined();
      expect(result.body).toContain(
        `note: keep ${blindedAlias} for traceability`,
      );
      expect(result.body).not.toContain("note: keep codex for traceability");

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
        agentId: string;
        status: string;
        outputPath: string;
        completedAt?: string;
        blinded?: {
          enabled?: boolean;
          aliasMap?: Record<string, string>;
        };
      };
      expect(record.runId).toBe(runRecord.runId);
      expect(record.agentId).toBe("reviewer");
      expect(record.status).toBe("succeeded");
      expect(record.outputPath).toBe(result.outputPath);
      expect(record.completedAt).toEqual(expect.any(String));
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
          agentId: "gpt-5-1-codex-mini",
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
          agentId: "gpt-5-1-codex-mini",
        }),
      ).resolves.toMatchObject({
        agentId: "gpt-5-1-codex-mini",
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
        agentId: "reviewer",
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

    it("fails without --agent when orchestration review agents contain multiple ids", async () => {
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
      expect(hinted.headline).toBe('Multiple agents found for stage "review".');
      expect(hinted.detailLines).toContain(
        "Multi-agent review is not supported.",
      );
      expect(hinted.hintLines).toContain(
        "Configure exactly one agent under profiles.default.review.agents in .voratiq/orchestration.yaml.",
      );
      expect(executeCompetitionWithAdapterMock).not.toHaveBeenCalled();
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

      expect(result.missingArtifacts).toEqual(["diff.patch"]);
      expect(result.body).toContain(
        "Warning: Missing artifacts: diff.patch. Review may be incomplete.",
      );
    });

    it("preserves run lookup error shape when run is missing", async () => {
      await writeFile(
        join(repoRoot, ".voratiq", "runs", "index.json"),
        "",
        "utf8",
      );

      await expect(
        withRepoCwd(repoRoot, () =>
          runReviewCommand({ runId: "missing-run", agentId: "reviewer" }),
        ),
      ).rejects.toBeInstanceOf(RunNotFoundCliError);

      await expect(
        withRepoCwd(repoRoot, () =>
          runReviewCommand({ runId: "missing-run", agentId: "reviewer" }),
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
          runReviewCommand({ runId: "any-run", agentId: "reviewer" }),
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

      let caughtError: unknown;
      try {
        await runReviewInRepo(repoRoot, {
          runId: runRecord.runId,
          agentId: "reviewer",
        });
      } catch (error: unknown) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(ReviewGenerationFailedError);
      const failure = caughtError as ReviewGenerationFailedError;
      expect(failure).toBeInstanceOf(ReviewGenerationFailedError);
      expect(failure.detailLines).toEqual(["review process failed"]);
      expect(failure.hintLines).toHaveLength(1);
      expect(failure.hintLines.at(0)).toContain("See stderr:");

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

      let caughtError: unknown;
      try {
        await runReviewInRepo(repoRoot, {
          runId: runRecord.runId,
          agentId: "reviewer",
        });
      } catch (error: unknown) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(ReviewGenerationFailedError);
      const failure = caughtError as ReviewGenerationFailedError;
      expect(failure).toBeInstanceOf(ReviewGenerationFailedError);
      expect(failure.detailLines).toEqual(["Missing output: review.md"]);
      expect(failure.hintLines).toHaveLength(3);
      expect(failure.hintLines.at(0)).toMatch(/^Review session:/u);
      expect(failure.hintLines.at(2)).toContain("See stderr:");
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
    includeDiff = false,
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
