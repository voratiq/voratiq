import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { jest } from "@jest/globals";
import { CommanderError } from "commander";

import * as applyCli from "../../src/cli/apply.js";
import { createAutoCommand, runAutoCommand } from "../../src/cli/auto.js";
import * as reviewCli from "../../src/cli/review.js";
import * as runCli from "../../src/cli/run.js";
import { appendReviewRecord } from "../../src/reviews/records/persistence.js";
import { HintedError } from "../../src/utils/errors.js";
import { REVIEW_RECOMMENDATION_FILENAME } from "../../src/workspace/structure.js";

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

jest.mock("../../src/cli/run.js", () => ({
  runRunCommand: jest.fn(),
}));

jest.mock("../../src/cli/review.js", () => ({
  runReviewCommand: jest.fn(),
}));

jest.mock("../../src/cli/apply.js", () => ({
  runApplyCommand: jest.fn(),
}));

describe("voratiq auto", () => {
  const runRunCommandMock = jest.mocked(runCli.runRunCommand);
  const runReviewCommandMock = jest.mocked(reviewCli.runReviewCommand);
  const runApplyCommandMock = jest.mocked(applyCli.runApplyCommand);

  let originalExitCode: number | string | undefined;
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write> | undefined;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write> | undefined;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    runRunCommandMock.mockReset();
    runReviewCommandMock.mockReset();
    runApplyCommandMock.mockReset();
  });

  afterEach(() => {
    process.exitCode = originalExitCode ?? undefined;
    stdoutSpy?.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("requires --spec", async () => {
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const command = createAutoCommand().exitOverride();
    await expect(
      command.parseAsync(["node", "voratiq", "--review-agent", "reviewer"]),
    ).rejects.toBeInstanceOf(CommanderError);
  });

  it("does not accept legacy spec-generation flags", async () => {
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const command = createAutoCommand().exitOverride();
    await expect(
      command.parseAsync([
        "node",
        "voratiq",
        "--description",
        "write a spec",
        "--spec",
        ".voratiq/specs/existing.md",
        "--review-agent",
        "reviewer",
      ]),
    ).rejects.toBeInstanceOf(CommanderError);
  });

  it("help reflects existing-spec contract and apply flags", () => {
    const help = createAutoCommand().helpInformation();
    expect(help).toContain("--spec <path>");
    expect(help).toContain("Path to the spec file");
    expect(help).toContain("--run-agent <agent-id>");
    expect(help).toContain("--review-agent <agent-id>");
    expect(help).toContain("--profile <name>");
    expect(help).toContain("--apply");
    expect(help).toContain("--commit");
    expect(help).not.toContain("--description");
    expect(help).not.toContain("--spec-agent");
  });

  it("parses --profile", async () => {
    let received: unknown;
    const command = createAutoCommand();
    command.exitOverride().action((options) => {
      received = options;
    });

    await command.parseAsync([
      "node",
      "voratiq",
      "--spec",
      ".voratiq/specs/existing.md",
      "--profile",
      "quality",
    ]);

    expect((received as { profile?: string }).profile).toBe("quality");
  });

  it("parses repeatable --run-agent preserving order", async () => {
    let received: unknown;
    const command = createAutoCommand();
    command.exitOverride().action((options) => {
      received = options;
    });

    await command.parseAsync([
      "node",
      "voratiq",
      "--spec",
      ".voratiq/specs/existing.md",
      "--run-agent",
      "gamma",
      "--run-agent",
      "alpha",
    ]);

    expect((received as { runAgent?: string[] }).runAgent).toEqual([
      "gamma",
      "alpha",
    ]);
  });

  it("allows omitting --review-agent", async () => {
    let received: unknown;
    const command = createAutoCommand();
    command.exitOverride().action((options) => {
      received = options;
    });

    await command.parseAsync([
      "node",
      "voratiq",
      "--spec",
      ".voratiq/specs/existing.md",
    ]);

    expect((received as { reviewAgent?: string }).reviewAgent).toBeUndefined();
  });

  it("fails usage when --commit is provided without --apply", async () => {
    const command = createAutoCommand().exitOverride();
    await expect(
      command.parseAsync([
        "node",
        "voratiq",
        "--spec",
        ".voratiq/specs/existing.md",
        "--review-agent",
        "reviewer",
        "--commit",
      ]),
    ).rejects.toThrow("Option `--commit` requires `--apply`.");
    expect(runRunCommandMock).not.toHaveBeenCalled();
    expect(runApplyCommandMock).not.toHaveBeenCalled();
  });

  it("runs review even when run reports agent failure", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        stderr.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue({
      report: {
        runId: "run-123",
        spec: { path: ".voratiq/specs/existing.md" },
        status: "failed",
        createdAt: new Date().toISOString(),
        baseRevisionSha: "deadbeef",
        agents: [],
        hadAgentFailure: true,
        hadEvalFailure: false,
      },
      body: "run body",
      exitCode: 1,
    });

    runReviewCommandMock.mockResolvedValue({
      reviewId: "review-456",
      runRecord: {} as never,
      agentId: "reviewer",
      outputPath: ".voratiq/reviews/review.md",
      missingArtifacts: [],
      body: "review body",
    });

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      reviewerAgent: "reviewer",
    });

    expect(runRunCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        specPath: ".voratiq/specs/existing.md",
        agentOverrideFlag: "--run-agent",
      }),
    );
    expect(runReviewCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-123",
        agentId: "reviewer",
        agentOverrideFlag: "--review-agent",
        suppressHint: true,
      }),
    );
    expect(runApplyCommandMock).not.toHaveBeenCalled();

    expect(stripAnsi(stdout.join(""))).toContain("Auto SUCCEEDED");
    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toHaveLength(0);
  });

  it("prints summary even if review fails", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        stderr.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue({
      report: {
        runId: "run-123",
        spec: { path: ".voratiq/specs/existing.md" },
        status: "succeeded",
        createdAt: new Date().toISOString(),
        baseRevisionSha: "deadbeef",
        agents: [],
        hadAgentFailure: false,
        hadEvalFailure: false,
      },
      body: "run body",
    });

    runReviewCommandMock.mockRejectedValue(new Error("review exploded"));

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      reviewerAgent: "reviewer",
    });

    expect(stdout.join("")).toContain("Error:");
    expect(stdout.join("")).toContain("review exploded");
    expect(stripAnsi(stdout.join(""))).toContain("Auto FAILED");
    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toHaveLength(0);
    expect(runApplyCommandMock).not.toHaveBeenCalled();
  });

  it("passes run-stage overrides to run and allows orchestration-backed review resolution", async () => {
    runRunCommandMock.mockResolvedValue({
      report: {
        runId: "run-123",
        spec: { path: ".voratiq/specs/existing.md" },
        status: "succeeded",
        createdAt: new Date().toISOString(),
        baseRevisionSha: "deadbeef",
        agents: [{ agentId: "alpha" } as never, { agentId: "beta" } as never],
        hadAgentFailure: false,
        hadEvalFailure: false,
      },
      body: "run body",
    });
    runReviewCommandMock.mockResolvedValue({
      reviewId: "review-456",
      runRecord: {} as never,
      agentId: "reviewer",
      outputPath: ".voratiq/reviews/review.md",
      missingArtifacts: [],
      body: "review body",
    });

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      runAgentIds: ["beta", "alpha"],
      profile: "quality",
    });

    expect(runRunCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        specPath: ".voratiq/specs/existing.md",
        agentIds: ["beta", "alpha"],
        agentOverrideFlag: "--run-agent",
        profile: "quality",
      }),
    );
    expect(runReviewCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-123",
        agentId: undefined,
        agentOverrideFlag: "--review-agent",
        profile: "quality",
      }),
    );
  });

  it("surfaces run-stage resolution failures with auto override guidance", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockRejectedValue(
      new HintedError('No agent found for stage "run".', {
        detailLines: [
          "Resolved agents: (none).",
          "Checked profiles.default.run.agents in .voratiq/orchestration.yaml.",
        ],
        hintLines: [
          "Provide --run-agent <id> to run run with an explicit agent.",
          "Configure at least one agent under profiles.default.run.agents in .voratiq/orchestration.yaml.",
        ],
      }),
    );

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
    });

    const output = stripAnsi(stdout.join(""));
    expect(output).toContain('No agent found for stage "run".');
    expect(output).toContain("--run-agent <id>");
    expect(output).toContain("profiles.default.run.agents");
    expect(output).toContain("Auto FAILED");
    expect(runReviewCommandMock).not.toHaveBeenCalled();
  });

  it("surfaces duplicate --run-agent failures in auto output", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockRejectedValue(
      new HintedError(
        'Duplicate --run-agent values are not allowed for stage "run".',
        {
          detailLines: ["Duplicate agent ids: codex."],
          hintLines: [
            "Pass each --run-agent id at most once, preserving your intended order.",
          ],
        },
      ),
    );

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      runAgentIds: ["codex", "codex"],
    });

    const output = stripAnsi(stdout.join(""));
    expect(output).toContain(
      'Duplicate --run-agent values are not allowed for stage "run".',
    );
    expect(output).toContain("Duplicate agent ids: codex.");
    expect(output).toContain(
      "Pass each --run-agent id at most once, preserving your intended order.",
    );
    expect(output).toContain("Auto FAILED");
    expect(runReviewCommandMock).not.toHaveBeenCalled();
  });

  it("surfaces review-stage missing resolution when --review-agent is omitted", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["codex"]));
    runReviewCommandMock.mockRejectedValue(
      new HintedError('No agent found for stage "review".', {
        detailLines: [
          "Resolved agents: (none).",
          "Checked profiles.default.review.agents in .voratiq/orchestration.yaml.",
        ],
        hintLines: [
          "Provide --review-agent <id> to run review with an explicit agent.",
          "Configure exactly one agent under profiles.default.review.agents in .voratiq/orchestration.yaml.",
        ],
      }),
    );

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
    });

    const output = stripAnsi(stdout.join(""));
    expect(output).toContain('No agent found for stage "review".');
    expect(output).toContain("--review-agent <id>");
    expect(output).toContain("profiles.default.review.agents");
    expect(output).toContain("Auto FAILED");
  });

  it("surfaces temporary review single-agent guardrail failures", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["codex"]));
    runReviewCommandMock.mockRejectedValue(
      new HintedError('Multiple agents found for stage "review".', {
        detailLines: ["Multi-agent review is not supported."],
        hintLines: [
          "Provide --review-agent <id> to run review with an explicit agent.",
          "Configure exactly one agent under profiles.default.review.agents in .voratiq/orchestration.yaml.",
        ],
      }),
    );

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
    });

    const output = stripAnsi(stdout.join(""));
    expect(output).toContain('Multiple agents found for stage "review".');
    expect(output).toContain("Multi-agent review is not supported.");
    expect(output).toContain("--review-agent <id>");
    expect(output).toContain("Auto FAILED");
  });

  it("keeps single-blank separation between chained transcripts", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        stderr.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue({
      report: {
        runId: "run-xyz",
        spec: { path: ".voratiq/specs/existing.md" },
        status: "succeeded",
        createdAt: new Date().toISOString(),
        baseRevisionSha: "deadbeef",
        agents: [],
        hadAgentFailure: false,
        hadEvalFailure: false,
      },
      body: "RUN BODY",
    });

    runReviewCommandMock.mockResolvedValue({
      reviewId: "review-xyz",
      runRecord: {} as never,
      agentId: "reviewer",
      outputPath: ".voratiq/reviews/review.md",
      missingArtifacts: [],
      body: "REVIEW BODY",
    });

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      reviewerAgent: "reviewer",
    });

    const output = stripAnsi(stdout.join(""));
    expect(output.startsWith("\n")).toBe(true);
    expect(output).not.toContain("\n\n\n");
    expect(output).toContain("\nRUN BODY");
    expect(output).toContain("RUN BODY\n\nREVIEW BODY");
    expect(output).toContain("REVIEW BODY\n\nAuto SUCCEEDED");
    expect(runApplyCommandMock).not.toHaveBeenCalled();
  });

  it("prefers resolved_preferred_agent from recommendation.json", async () => {
    const stdout: string[] = [];

    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-good"]));
    runReviewCommandMock.mockResolvedValue({
      reviewId: "review-123",
      runRecord: {} as never,
      agentId: "reviewer",
      outputPath:
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
      missingArtifacts: [],
      // Intentionally conflicting markdown text to ensure auto does not parse it.
      body: "## Recommendation\n**Preferred Candidate**: wrong-agent",
    });
    runApplyCommandMock.mockResolvedValue({
      result: {} as never,
      body: "APPLY BODY",
    });

    await withTempRepo(async (repoRoot) => {
      await writeRecommendationArtifact(
        repoRoot,
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
        {
          preferred_agent: "wrong-agent",
          resolved_preferred_agent: "agent-good",
          rationale: "Best option",
          next_actions: ["voratiq apply --run run-123 --agent agent-good"],
        },
      );

      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgent: "reviewer",
        apply: true,
      });
    });

    expect(runApplyCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-123",
        agentId: "agent-good",
        commit: false,
      }),
    );

    const output = stripAnsi(stdout.join(""));
    expect(output).toContain("APPLY BODY");
    expect(output).toContain("Auto SUCCEEDED");
  });

  it("uses preferred_agent when resolved_preferred_agent is missing", async () => {
    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-good"]));
    runReviewCommandMock.mockResolvedValue({
      reviewId: "review-123",
      runRecord: {} as never,
      agentId: "reviewer",
      outputPath:
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
      missingArtifacts: [],
      body: "review body",
    });
    runApplyCommandMock.mockResolvedValue({
      result: {} as never,
      body: "APPLY BODY",
    });

    await withTempRepo(async (repoRoot) => {
      await writeRecommendationArtifact(
        repoRoot,
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
        {
          preferred_agent: "agent-good",
          rationale: "Best option",
          next_actions: ["voratiq apply --run run-123 --agent agent-good"],
        },
      );

      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgent: "reviewer",
        apply: true,
      });
    });

    expect(runApplyCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-123",
        agentId: "agent-good",
      }),
    );
  });

  it("resolves preferred_agent aliases via the review record alias map", async () => {
    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-good"]));
    runReviewCommandMock.mockResolvedValue({
      reviewId: "review-123",
      runRecord: {} as never,
      agentId: "reviewer",
      outputPath:
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
      missingArtifacts: [],
      body: "review body",
    });
    runApplyCommandMock.mockResolvedValue({
      result: {} as never,
      body: "APPLY BODY",
    });

    await withTempRepo(async (repoRoot) => {
      await writeRecommendationArtifact(
        repoRoot,
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
        {
          preferred_agent: "r_aaaaaaaaaa",
          rationale: "Best option",
          next_actions: ["voratiq apply --run run-123 --agent r_aaaaaaaaaa"],
        },
      );
      await writeReviewAliasRecord({
        repoRoot,
        reviewId: "review-123",
        runId: "run-123",
        aliasMap: { r_aaaaaaaaaa: "agent-good" },
      });

      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgent: "reviewer",
        apply: true,
      });
    });

    expect(runApplyCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-123",
        agentId: "agent-good",
      }),
    );
  });

  it("passes --commit through to apply when --apply is enabled", async () => {
    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-good"]));
    runReviewCommandMock.mockResolvedValue({
      reviewId: "review-123",
      runRecord: {} as never,
      agentId: "reviewer",
      outputPath:
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
      missingArtifacts: [],
      body: "review body",
    });
    runApplyCommandMock.mockResolvedValue({
      result: {} as never,
      body: "APPLY BODY",
    });

    await withTempRepo(async (repoRoot) => {
      await writeRecommendationArtifact(
        repoRoot,
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
        {
          preferred_agent: "agent-good",
          rationale: "Best option",
          next_actions: ["voratiq apply --run run-123 --agent agent-good"],
        },
      );

      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgent: "reviewer",
        apply: true,
        commit: true,
      });
    });

    expect(runApplyCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commit: true,
      }),
    );
  });

  it("fails safely when recommendation.json is missing", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-good"]));
    runReviewCommandMock.mockResolvedValue({
      reviewId: "review-123",
      runRecord: {} as never,
      agentId: "reviewer",
      outputPath:
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
      missingArtifacts: [],
      body: "review body",
    });

    await withTempRepo(async () => {
      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgent: "reviewer",
        apply: true,
      });
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    expect(stripAnsi(stdout.join(""))).toContain(
      "Failed to load structured review recommendation.",
    );
    expect(stripAnsi(stdout.join(""))).toContain("Auto FAILED");
    expect(process.exitCode).toBe(1);
  });

  it("fails safely when recommendation shape is invalid", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-a", "agent-b"]));
    runReviewCommandMock.mockResolvedValue({
      reviewId: "review-123",
      runRecord: {} as never,
      agentId: "reviewer",
      outputPath:
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
      missingArtifacts: [],
      body: "review body",
    });

    await withTempRepo(async (repoRoot) => {
      await writeRecommendationArtifact(
        repoRoot,
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
        {
          preferred_agent: "   ",
          rationale: "Invalid",
          next_actions: [],
        },
      );

      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgent: "reviewer",
        apply: true,
      });
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    expect(stripAnsi(stdout.join(""))).toContain(
      "Failed to load structured review recommendation.",
    );
    expect(stripAnsi(stdout.join(""))).toContain("preferred_agent");
    expect(stripAnsi(stdout.join(""))).toContain("Auto FAILED");
    expect(process.exitCode).toBe(1);
  });

  it("fails safely when recommendation preferred_agent is none", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-a", "agent-b"]));
    runReviewCommandMock.mockResolvedValue({
      reviewId: "review-123",
      runRecord: {} as never,
      agentId: "reviewer",
      outputPath:
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
      missingArtifacts: [],
      body: "review body",
    });

    await withTempRepo(async (repoRoot) => {
      await writeRecommendationArtifact(
        repoRoot,
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
        {
          preferred_agent: "none",
          rationale: "Invalid",
          next_actions: [],
        },
      );

      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgent: "reviewer",
        apply: true,
      });
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    expect(stripAnsi(stdout.join(""))).toContain(
      "Failed to load structured review recommendation.",
    );
    expect(stripAnsi(stdout.join(""))).toContain("preferred_agent");
    expect(stripAnsi(stdout.join(""))).toContain("Auto FAILED");
    expect(process.exitCode).toBe(1);
  });

  it("propagates apply failures", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-good"]));
    runReviewCommandMock.mockResolvedValue({
      reviewId: "review-123",
      runRecord: {} as never,
      agentId: "reviewer",
      outputPath:
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
      missingArtifacts: [],
      body: "review body",
    });
    runApplyCommandMock.mockRejectedValue(new Error("apply exploded"));

    await withTempRepo(async (repoRoot) => {
      await writeRecommendationArtifact(
        repoRoot,
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
        {
          preferred_agent: "agent-good",
          rationale: "Best option",
          next_actions: [],
        },
      );

      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgent: "reviewer",
        apply: true,
      });
    });

    expect(stripAnsi(stdout.join(""))).toContain("apply exploded");
    expect(stripAnsi(stdout.join(""))).toContain("Auto FAILED");
    expect(process.exitCode).toBe(1);
  });
});

function buildRunResult(agentIds: readonly string[]) {
  return {
    report: {
      runId: "run-123",
      spec: { path: ".voratiq/specs/existing.md" },
      status: "succeeded" as const,
      createdAt: new Date().toISOString(),
      baseRevisionSha: "deadbeef",
      agents: agentIds.map((agentId) => ({ agentId }) as never),
      hadAgentFailure: false,
      hadEvalFailure: false,
    },
    body: "RUN BODY",
  };
}

async function withTempRepo<T>(
  fn: (repoRoot: string) => Promise<T>,
): Promise<T> {
  const repoRoot = await mkdtemp(join(tmpdir(), "voratiq-auto-"));
  const originalCwd = process.cwd();
  try {
    process.chdir(repoRoot);
    return await fn(repoRoot);
  } finally {
    process.chdir(originalCwd);
    await rm(repoRoot, { recursive: true, force: true });
  }
}

async function writeRecommendationArtifact(
  repoRoot: string,
  reviewOutputPath: string,
  recommendation: {
    preferred_agent: string;
    resolved_preferred_agent?: string;
    rationale: string;
    next_actions: string[];
  },
): Promise<void> {
  const recommendationPath = join(
    repoRoot,
    dirname(reviewOutputPath),
    REVIEW_RECOMMENDATION_FILENAME,
  );
  await mkdir(dirname(recommendationPath), { recursive: true });
  await writeFile(
    recommendationPath,
    `${JSON.stringify(recommendation, null, 2)}\n`,
    "utf8",
  );
}

async function writeReviewAliasRecord(options: {
  repoRoot: string;
  reviewId: string;
  runId: string;
  aliasMap: Record<string, string>;
}): Promise<void> {
  const { repoRoot, reviewId, runId, aliasMap } = options;
  const now = new Date().toISOString();
  await appendReviewRecord({
    root: repoRoot,
    reviewsFilePath: join(repoRoot, ".voratiq", "reviews", "index.json"),
    record: {
      sessionId: reviewId,
      runId,
      createdAt: now,
      completedAt: now,
      status: "succeeded",
      agentId: "reviewer",
      outputPath: `.voratiq/reviews/sessions/${reviewId}/reviewer/artifacts/review.md`,
      blinded: {
        enabled: true,
        aliasMap,
      },
    },
  });
}
