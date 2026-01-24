import { jest } from "@jest/globals";
import { CommanderError } from "commander";

import { createAutoCommand, runAutoCommand } from "../../src/cli/auto.js";
import * as reviewCli from "../../src/cli/review.js";
import * as runCli from "../../src/cli/run.js";
import * as specCli from "../../src/cli/spec.js";

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

jest.mock("../../src/cli/spec.js", () => ({
  runSpecCommand: jest.fn(),
}));

jest.mock("../../src/cli/run.js", () => ({
  runRunCommand: jest.fn(),
}));

jest.mock("../../src/cli/review.js", () => ({
  runReviewCommand: jest.fn(),
}));

describe("voratiq auto", () => {
  const runSpecCommandMock = jest.mocked(specCli.runSpecCommand);
  const runRunCommandMock = jest.mocked(runCli.runRunCommand);
  const runReviewCommandMock = jest.mocked(reviewCli.runReviewCommand);

  let originalExitCode: number | string | undefined;
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write> | undefined;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write> | undefined;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    runSpecCommandMock.mockReset();
    runRunCommandMock.mockReset();
    runReviewCommandMock.mockReset();
  });

  afterEach(() => {
    process.exitCode = originalExitCode ?? undefined;
    stdoutSpy?.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("enforces that one mode is selected", async () => {
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const command = createAutoCommand().exitOverride();
    await expect(
      command.parseAsync(["node", "voratiq", "--review-agent", "reviewer"]),
    ).rejects.toBeInstanceOf(CommanderError);
  });

  it("requires --spec-agent with --description", async () => {
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
        "--review-agent",
        "reviewer",
      ]),
    ).rejects.toBeInstanceOf(CommanderError);
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

    runSpecCommandMock.mockResolvedValue({
      body: "spec body",
      outputPath: ".voratiq/specs/generated.md",
    });

    runRunCommandMock.mockResolvedValue({
      report: {
        runId: "run-123",
        spec: { path: ".voratiq/specs/generated.md" },
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

    const originalDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY",
    );
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });

    await runAutoCommand({
      description: "write a spec",
      specAgent: "spec-agent",
      reviewerAgent: "reviewer",
    });

    if (originalDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", originalDescriptor);
    }

    expect(runSpecCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ yes: true }),
    );

    expect(runReviewCommandMock).toHaveBeenCalledWith({
      runId: "run-123",
      agentId: "reviewer",
      suppressHint: true,
    });

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

    runSpecCommandMock.mockResolvedValue({
      body: "spec body",
      outputPath: ".voratiq/specs/generated.md",
    });

    runRunCommandMock.mockResolvedValue({
      report: {
        runId: "run-123",
        spec: { path: ".voratiq/specs/generated.md" },
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
      description: "write a spec",
      specAgent: "spec-agent",
      reviewerAgent: "reviewer",
    });

    expect(stdout.join("")).toContain("Error:");
    expect(stdout.join("")).toContain("review exploded");
    expect(stripAnsi(stdout.join(""))).toContain("Auto FAILED");
    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toHaveLength(0);
  });

  it("aborts after spec failure (no run/review)", async () => {
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

    runSpecCommandMock.mockRejectedValue(new Error("spec exploded"));

    await runAutoCommand({
      description: "write a spec",
      specAgent: "spec-agent",
      reviewerAgent: "reviewer",
    });

    expect(runRunCommandMock).not.toHaveBeenCalled();
    expect(runReviewCommandMock).not.toHaveBeenCalled();
    expect(stdout.join("")).toContain("spec exploded");
    expect(stripAnsi(stdout.join(""))).toContain("Auto FAILED");
    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toHaveLength(0);
  });
});
