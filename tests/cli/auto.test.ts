import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { jest } from "@jest/globals";

import * as applyCli from "../../src/cli/apply.js";
import { createAutoCommand, runAutoCommand } from "../../src/cli/auto.js";
import { writeCommandOutput } from "../../src/cli/output.js";
import * as reviewCli from "../../src/cli/review.js";
import * as runCli from "../../src/cli/run.js";
import * as specCli from "../../src/cli/spec.js";
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

jest.mock("../../src/cli/spec.js", () => ({
  runSpecCommand: jest.fn(),
}));

jest.mock("../../src/cli/review.js", () => ({
  runReviewCommand: jest.fn(),
}));

jest.mock("../../src/cli/apply.js", () => ({
  runApplyCommand: jest.fn(),
}));

describe("voratiq auto", () => {
  const runRunCommandMock = jest.mocked(runCli.runRunCommand);
  const runSpecCommandMock = jest.mocked(specCli.runSpecCommand);
  const runReviewCommandMock = jest.mocked(reviewCli.runReviewCommand);
  const runApplyCommandMock = jest.mocked(applyCli.runApplyCommand);

  let originalExitCode: number | string | undefined;
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write> | undefined;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write> | undefined;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    runRunCommandMock.mockReset();
    runSpecCommandMock.mockReset();
    runReviewCommandMock.mockReset();
    runApplyCommandMock.mockReset();
  });

  afterEach(() => {
    process.exitCode = originalExitCode ?? undefined;
    stdoutSpy?.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("requires exactly one of --spec or --description", async () => {
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const command = createAutoCommand().exitOverride();
    await expect(
      command.parseAsync(["node", "voratiq", "--review-agent", "reviewer"]),
    ).rejects.toThrow(
      "Exactly one of `--spec` or `--description` is required.",
    );
  });

  it("rejects using --spec and --description together", async () => {
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
    ).rejects.toThrow(
      "Exactly one of `--spec` or `--description` is required.",
    );
  });

  it("help reflects spec-or-description contract and apply flags", () => {
    const help = createAutoCommand().helpInformation();
    expect(help).toContain("--spec <path>");
    expect(help).toContain("Path to an existing spec file");
    expect(help).toContain("--description <text>");
    expect(help).toContain("--run-agent <agent-id>");
    expect(help).toContain("--review-agent <agent-id>");
    expect(help).toContain("--profile <name>");
    expect(help).toContain("--apply");
    expect(help).toContain("--commit");
    expect(help).not.toContain("--spec-agent");
  });

  it("parses --description", async () => {
    let received: unknown;
    const command = createAutoCommand();
    command.exitOverride().action((options) => {
      received = options;
    });

    await command.parseAsync([
      "node",
      "voratiq",
      "--description",
      "Draft a migration spec",
      "--profile",
      "quality",
    ]);

    expect((received as { description?: string }).description).toBe(
      "Draft a migration spec",
    );
    expect((received as { profile?: string }).profile).toBe("quality");
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

    expect((received as { reviewAgent?: string[] }).reviewAgent).toEqual([]);
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

  it("chains --description through spec -> run -> review in order without duplicate stage starts", async () => {
    const stdout: string[] = [];

    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runSpecCommandMock.mockImplementation((options) => {
      options.writeOutput?.({
        alerts: [{ severity: "info", message: "Generating specification…" }],
      });
      return Promise.resolve({
        outputPath: ".voratiq/specs/generated.md",
        body: [
          "Spec saved: .voratiq/specs/generated.md",
          "",
          "---",
          "",
          "To begin a run:",
          "  voratiq run --spec .voratiq/specs/generated.md",
        ].join("\n"),
      });
    });
    runRunCommandMock.mockImplementation((options) => {
      options.writeOutput?.({
        alerts: [{ severity: "info", message: "Executing run…" }],
      });
      return Promise.resolve({
        report: {
          runId: "run-123",
          spec: { path: ".voratiq/specs/generated.md" },
          status: "succeeded",
          createdAt: new Date().toISOString(),
          baseRevisionSha: "deadbeef",
          agents: [{ agentId: "codex" } as never],
          hadAgentFailure: false,
          hadEvalFailure: false,
        },
        body: ["run-123 SUCCEEDED", "", "AGENT", "codex"].join("\n"),
      });
    });
    runReviewCommandMock.mockImplementation(() => {
      writeCommandOutput({
        alerts: [{ severity: "info", message: "Generating review…" }],
      });
      return Promise.resolve({
        ...buildReviewResult({
          reviewId: "review-123",
          outputPath:
            ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
          body: [
            "review-123 SUCCEEDED",
            "",
            "AGENT",
            "reviewer",
            "",
            "---",
            "",
            "Reviewer: reviewer",
          ].join("\n"),
        }),
        exitCode: 0,
      });
    });

    await runAutoCommand({
      description: "Generate a run spec",
      reviewerAgentIds: ["reviewer"],
    });

    const output = stripAnsi(stdout.join(""));
    expect(runSpecCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Generate a run spec",
        suppressHint: true,
      }),
    );
    expect(runRunCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        specPath: ".voratiq/specs/generated.md",
      }),
    );
    expect((output.match(/Generating specification…/gu) ?? []).length).toBe(1);
    expect((output.match(/Executing run…/gu) ?? []).length).toBe(1);
    expect((output.match(/Generating review…/gu) ?? []).length).toBe(1);
    expect(
      (output.match(/Spec saved: \.voratiq\/specs\/generated\.md/gu) ?? [])
        .length,
    ).toBe(1);
    expect((output.match(/run-123 SUCCEEDED/gu) ?? []).length).toBe(1);
    expect((output.match(/review-123 SUCCEEDED/gu) ?? []).length).toBe(1);

    expect(output.indexOf("Generating specification…")).toBeLessThan(
      output.indexOf("Spec saved: .voratiq/specs/generated.md"),
    );
    expect(
      output.indexOf("Spec saved: .voratiq/specs/generated.md"),
    ).toBeLessThan(output.indexOf("Executing run…"));
    expect(output.indexOf("Executing run…")).toBeLessThan(
      output.indexOf("run-123 SUCCEEDED"),
    );
    expect(output.indexOf("run-123 SUCCEEDED")).toBeLessThan(
      output.indexOf("Generating review…"),
    );
    expect(output.indexOf("Generating review…")).toBeLessThan(
      output.indexOf("review-123 SUCCEEDED"),
    );
  });

  it("keeps per-phase final frames stable for auto --spec and non-success review output", async () => {
    const stdout: string[] = [];

    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockImplementation((options) => {
      options.writeOutput?.({
        alerts: [{ severity: "info", message: "Executing run…" }],
      });
      return Promise.resolve({
        report: {
          runId: "run-456",
          spec: { path: ".voratiq/specs/existing.md" },
          status: "succeeded",
          createdAt: new Date().toISOString(),
          baseRevisionSha: "cafebabe",
          agents: [{ agentId: "runner" } as never],
          hadAgentFailure: false,
          hadEvalFailure: false,
        },
        body: ["run-456 SUCCEEDED", "", "AGENT", "runner"].join("\n"),
      });
    });
    runReviewCommandMock.mockImplementation(() => {
      writeCommandOutput({
        alerts: [{ severity: "info", message: "Generating review…" }],
      });
      return Promise.resolve({
        ...buildReviewResult({
          reviewId: "review-456",
          body: ["review-456 ABORTED", "", "AGENT", "reviewer"].join("\n"),
        }),
        exitCode: 1,
      });
    });

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      reviewerAgentIds: ["reviewer"],
    });

    const output = stripAnsi(stdout.join(""));
    expect((output.match(/run-456 SUCCEEDED/gu) ?? []).length).toBe(1);
    expect((output.match(/review-456 ABORTED/gu) ?? []).length).toBe(1);
    expect(output).toContain("Auto FAILED");
    expect(output.indexOf("run-456 SUCCEEDED")).toBeLessThan(
      output.indexOf("review-456 ABORTED"),
    );
    expect(output.indexOf("review-456 ABORTED")).toBeLessThan(
      output.indexOf("Auto FAILED"),
    );
  });

  it("does not emit redraw artifacts in chained non-TTY output", async () => {
    const stdout: string[] = [];
    const originalStdoutIsTty = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY",
    );

    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });

    runRunCommandMock.mockImplementation((options) => {
      expect(options.stdout?.isTTY).toBe(false);
      options.writeOutput?.({
        alerts: [{ severity: "info", message: "Executing run…" }],
      });
      return Promise.resolve({
        report: {
          runId: "run-789",
          spec: { path: ".voratiq/specs/existing.md" },
          status: "succeeded",
          createdAt: new Date().toISOString(),
          baseRevisionSha: "deadbeef",
          agents: [{ agentId: "runner" } as never],
          hadAgentFailure: false,
          hadEvalFailure: false,
        },
        body: ["run-789 SUCCEEDED", "", "AGENT", "runner"].join("\n"),
      });
    });
    runReviewCommandMock.mockImplementation(() => {
      writeCommandOutput({
        alerts: [{ severity: "info", message: "Generating review…" }],
      });
      return Promise.resolve({
        ...buildReviewResult({
          reviewId: "review-789",
          body: ["review-789 SUCCEEDED", "", "AGENT", "reviewer"].join("\n"),
        }),
        exitCode: 0,
      });
    });

    try {
      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgentIds: ["reviewer"],
      });
    } finally {
      if (originalStdoutIsTty) {
        Object.defineProperty(process.stdout, "isTTY", originalStdoutIsTty);
      }
    }

    const output = stdout.join("");
    expect(output).not.toContain("\u001b[2K");
    expect(output).not.toContain("\u001b[0G");
    const cursorUpPattern = new RegExp(`${ESC}\\[\\d+F`, "u");
    expect(output).not.toMatch(cursorUpPattern);
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

    runReviewCommandMock.mockResolvedValue(
      buildReviewResult({
        reviewId: "review-456",
        outputPath: ".voratiq/reviews/review.md",
      }),
    );

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      reviewerAgentIds: ["reviewer"],
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
        agentIds: ["reviewer"],
        agentOverrideFlag: "--review-agent",
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
      reviewerAgentIds: ["reviewer"],
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
    runReviewCommandMock.mockResolvedValue(
      buildReviewResult({
        reviewId: "review-456",
        outputPath: ".voratiq/reviews/review.md",
      }),
    );

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
        agentIds: undefined,
        agentOverrideFlag: "--review-agent",
        profile: "quality",
      }),
    );
  });

  it("passes --max-parallel through to review execution", async () => {
    runRunCommandMock.mockResolvedValue(buildRunResult(["alpha"]));
    runReviewCommandMock.mockResolvedValue(buildReviewResult());

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      reviewerAgentIds: ["reviewer"],
      maxParallel: 2,
    });

    expect(runReviewCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-123",
        agentIds: ["reviewer"],
        maxParallel: 2,
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
          "Configure at least one agent under profiles.default.review.agents in .voratiq/orchestration.yaml.",
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

  it("surfaces mixed-outcome review transcript when review returns exitCode 1", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["codex"]));
    runReviewCommandMock.mockResolvedValue({
      ...buildReviewResult({
        reviewId: "review-789",
        outputPath:
          ".voratiq/reviews/sessions/review-789/reviewer-a/artifacts/review.md",
        body: [
          "review-789 FAILED",
          "",
          "AGENT       STATUS",
          "reviewer-a  SUCCEEDED",
          "reviewer-b  FAILED",
          "",
          "Reviewer: reviewer-a",
          "",
          "```markdown",
          "## Recommendation",
          "**Preferred Candidate**: codex",
          "**Rationale**: good",
          "**Next Actions**:",
          "voratiq apply --run run-123 --agent codex",
          "```",
          "",
          "Review: .voratiq/reviews/sessions/review-789/reviewer-a/artifacts/review.md",
          "",
          "---",
          "",
          "Reviewer: reviewer-b",
          "",
          "Error: reviewer violated output contract",
        ].join("\n"),
      }),
      exitCode: 1,
      reviews: [
        {
          agentId: "reviewer-a",
          outputPath:
            ".voratiq/reviews/sessions/review-789/reviewer-a/artifacts/review.md",
          status: "succeeded",
          missingArtifacts: [],
        },
        {
          agentId: "reviewer-b",
          outputPath:
            ".voratiq/reviews/sessions/review-789/reviewer-b/artifacts/review.md",
          status: "failed",
          missingArtifacts: [],
          error: "reviewer violated output contract",
        },
      ],
    });

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      reviewerAgentIds: ["reviewer-a", "reviewer-b"],
    });

    const output = stripAnsi(stdout.join(""));
    expect(output).toContain("review-789 FAILED");
    expect(output).toContain("Reviewer: reviewer-b");
    expect(output).toContain("Error: reviewer violated output contract");
    expect(output).toContain("Auto FAILED");
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

    runReviewCommandMock.mockResolvedValue(
      buildReviewResult({
        reviewId: "review-xyz",
        outputPath: ".voratiq/reviews/review.md",
        body: "REVIEW BODY",
      }),
    );

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      reviewerAgentIds: ["reviewer"],
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
    runReviewCommandMock.mockResolvedValue(
      buildReviewResult({
        reviewId: "review-123",
        // Intentionally conflicting markdown text to ensure auto does not parse it.
        body: "## Recommendation\n**Preferred Candidate**: wrong-agent",
      }),
    );
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
        reviewerAgentIds: ["reviewer"],
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

  it("auto-applies when multiple reviewers unanimously select the same agent", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-good"]));
    runReviewCommandMock.mockResolvedValue({
      ...buildReviewResult({
        reviewId: "review-123",
        outputPath:
          ".voratiq/reviews/sessions/review-123/reviewer-a/artifacts/review.md",
      }),
      reviews: [
        {
          agentId: "reviewer-a",
          outputPath:
            ".voratiq/reviews/sessions/review-123/reviewer-a/artifacts/review.md",
          status: "succeeded",
          missingArtifacts: [],
        },
        {
          agentId: "reviewer-b",
          outputPath:
            ".voratiq/reviews/sessions/review-123/reviewer-b/artifacts/review.md",
          status: "succeeded",
          missingArtifacts: [],
        },
      ],
    });

    runApplyCommandMock.mockResolvedValue({
      result: {} as never,
      body: "APPLY BODY",
    });

    await withTempRepo(async (repoRoot) => {
      await writeRecommendationArtifact(
        repoRoot,
        ".voratiq/reviews/sessions/review-123/reviewer-a/artifacts/review.md",
        {
          preferred_agent: "agent-good",
          resolved_preferred_agent: "agent-good",
          rationale: "Best option",
          next_actions: ["voratiq apply --run run-123 --agent agent-good"],
        },
      );
      await writeRecommendationArtifact(
        repoRoot,
        ".voratiq/reviews/sessions/review-123/reviewer-b/artifacts/review.md",
        {
          preferred_agent: "agent-good",
          resolved_preferred_agent: "agent-good",
          rationale: "Best option",
          next_actions: ["voratiq apply --run run-123 --agent agent-good"],
        },
      );

      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgentIds: ["reviewer-a", "reviewer-b"],
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
    expect(stripAnsi(stdout.join(""))).toContain("APPLY BODY");
    expect(stripAnsi(stdout.join(""))).toContain("Auto SUCCEEDED");
  });

  it("skips auto-apply and requests arbitration when reviewers disagree", async () => {
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

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-a", "agent-b"]));
    runReviewCommandMock.mockResolvedValue({
      ...buildReviewResult({
        reviewId: "review-123",
        outputPath:
          ".voratiq/reviews/sessions/review-123/reviewer-a/artifacts/review.md",
        body: [
          "REVIEW BODY",
          "",
          "---",
          "",
          "To apply a solution:",
          "    voratiq apply --run run-123 --agent <agent-id>",
        ].join("\n"),
      }),
      reviews: [
        {
          agentId: "reviewer-a",
          outputPath:
            ".voratiq/reviews/sessions/review-123/reviewer-a/artifacts/review.md",
          status: "succeeded",
          missingArtifacts: [],
        },
        {
          agentId: "reviewer-b",
          outputPath:
            ".voratiq/reviews/sessions/review-123/reviewer-b/artifacts/review.md",
          status: "succeeded",
          missingArtifacts: [],
        },
      ],
    });

    await withTempRepo(async (repoRoot) => {
      await writeRecommendationArtifact(
        repoRoot,
        ".voratiq/reviews/sessions/review-123/reviewer-a/artifacts/review.md",
        {
          preferred_agent: "agent-a",
          resolved_preferred_agent: "agent-a",
          rationale: "Best option",
          next_actions: ["voratiq apply --run run-123 --agent agent-a"],
        },
      );
      await writeRecommendationArtifact(
        repoRoot,
        ".voratiq/reviews/sessions/review-123/reviewer-b/artifacts/review.md",
        {
          preferred_agent: "agent-b",
          resolved_preferred_agent: "agent-b",
          rationale: "Best option",
          next_actions: ["voratiq apply --run run-123 --agent agent-b"],
        },
      );

      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgentIds: ["reviewer-a", "reviewer-b"],
        apply: true,
      });
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    const output = stripAnsi(stdout.join(""));
    expect(output).toContain("To apply a solution:");
    expect(output).toContain("voratiq apply --run run-123 --agent <agent-id>");
    expect((output.match(/To apply a solution:/gu) ?? []).length).toBe(1);
    expect(output).toContain(
      "Warning: Reviewers disagreed. Review manually and apply the best solution.",
    );
    expect(output).toContain("Auto SUCCEEDED");
  });

  it("fails when resolved_preferred_agent is missing", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-good"]));
    runReviewCommandMock.mockResolvedValue(buildReviewResult());

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
        reviewerAgentIds: ["reviewer"],
        apply: true,
      });
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    expect(stripAnsi(stdout.join(""))).toContain(
      "Recommendation is missing `resolved_preferred_agent`.",
    );
    expect(stripAnsi(stdout.join(""))).toContain("Auto FAILED");
  });

  it("fails when only aliased preferred_agent is present", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-good"]));
    runReviewCommandMock.mockResolvedValue(buildReviewResult());

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

      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgentIds: ["reviewer"],
        apply: true,
      });
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    expect(stripAnsi(stdout.join(""))).toContain(
      "Recommendation is missing `resolved_preferred_agent`.",
    );
    expect(stripAnsi(stdout.join(""))).toContain("Auto FAILED");
  });

  it("passes --commit through to apply when --apply is enabled", async () => {
    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-good"]));
    runReviewCommandMock.mockResolvedValue(buildReviewResult());
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
          resolved_preferred_agent: "agent-good",
          rationale: "Best option",
          next_actions: ["voratiq apply --run run-123 --agent agent-good"],
        },
      );

      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgentIds: ["reviewer"],
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
    runReviewCommandMock.mockResolvedValue(buildReviewResult());

    await withTempRepo(async () => {
      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgentIds: ["reviewer"],
        apply: true,
      });
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    expect(stripAnsi(stdout.join(""))).toContain(
      "Failed to load `recommendation.json`.",
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
    runReviewCommandMock.mockResolvedValue(buildReviewResult());

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
        reviewerAgentIds: ["reviewer"],
        apply: true,
      });
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    expect(stripAnsi(stdout.join(""))).toContain(
      "Failed to load `recommendation.json`.",
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
    runReviewCommandMock.mockResolvedValue(buildReviewResult());

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
        reviewerAgentIds: ["reviewer"],
        apply: true,
      });
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    expect(stripAnsi(stdout.join(""))).toContain(
      "Failed to load `recommendation.json`.",
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
    runReviewCommandMock.mockResolvedValue(buildReviewResult());
    runApplyCommandMock.mockRejectedValue(new Error("apply exploded"));

    await withTempRepo(async (repoRoot) => {
      await writeRecommendationArtifact(
        repoRoot,
        ".voratiq/reviews/sessions/review-123/reviewer/artifacts/review.md",
        {
          preferred_agent: "agent-good",
          resolved_preferred_agent: "agent-good",
          rationale: "Best option",
          next_actions: [],
        },
      );

      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgentIds: ["reviewer"],
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

function buildReviewResult(
  options: {
    reviewId?: string;
    agentId?: string;
    outputPath?: string;
    body?: string;
  } = {},
) {
  const reviewId = options.reviewId ?? "review-123";
  const agentId = options.agentId ?? "reviewer";
  const outputPath =
    options.outputPath ??
    `.voratiq/reviews/sessions/${reviewId}/${agentId}/artifacts/review.md`;
  const body = options.body ?? "review body";
  return {
    reviewId,
    runRecord: {} as never,
    reviews: [
      {
        agentId,
        outputPath,
        status: "succeeded" as const,
        missingArtifacts: [],
      },
    ],
    agentId,
    outputPath,
    missingArtifacts: [],
    body,
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
    ranking?: string[];
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
    `${JSON.stringify(
      {
        ...recommendation,
        ranking: recommendation.ranking ?? [recommendation.preferred_agent],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
