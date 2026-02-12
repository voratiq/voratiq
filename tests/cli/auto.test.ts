import { jest } from "@jest/globals";
import { CommanderError } from "commander";

import { createAutoCommand, runAutoCommand } from "../../src/cli/auto.js";
import * as reviewCli from "../../src/cli/review.js";
import * as runCli from "../../src/cli/run.js";

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

describe("voratiq auto", () => {
  const runRunCommandMock = jest.mocked(runCli.runRunCommand);
  const runReviewCommandMock = jest.mocked(reviewCli.runReviewCommand);

  let originalExitCode: number | string | undefined;
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write> | undefined;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write> | undefined;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    runRunCommandMock.mockReset();
    runReviewCommandMock.mockReset();
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

  it("help reflects existing-spec contract", () => {
    const help = createAutoCommand().helpInformation();
    expect(help).toContain("--spec <path>");
    expect(help).toContain("existing spec file");
    expect(help).not.toContain("--description");
    expect(help).not.toContain("--spec-agent");
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
  });
});
