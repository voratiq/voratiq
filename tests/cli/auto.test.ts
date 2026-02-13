import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { jest } from "@jest/globals";
import { CommanderError } from "commander";

import * as applyCli from "../../src/cli/apply.js";
import { createAutoCommand, runAutoCommand } from "../../src/cli/auto.js";
import * as reviewCli from "../../src/cli/review.js";
import * as runCli from "../../src/cli/run.js";
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
    expect(help).toContain("existing spec file");
    expect(help).toContain("--apply");
    expect(help).toContain("--commit");
    expect(help).not.toContain("--description");
    expect(help).not.toContain("--spec-agent");
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
      }),
    );
    expect(runReviewCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-123",
        agentId: "reviewer",
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

  it("applies recommendation from recommendation.json", async () => {
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
      body: "## Recommendation\n**Preferred Agent(s)**: wrong-agent",
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
          version: 1,
          preferred_agents: ["agent-good"],
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
          version: 1,
          preferred_agents: ["agent-good"],
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

  it("fails safely when recommendation resolves to multiple agents", async () => {
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
          version: 1,
          preferred_agents: ["agent-a", "agent-b"],
          rationale: "Tie",
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
    expect(stripAnsi(stdout.join(""))).toContain("Recommendation is ambiguous");
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
          version: 1,
          preferred_agents: ["agent-good"],
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
    version: 1;
    preferred_agents: string[];
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
