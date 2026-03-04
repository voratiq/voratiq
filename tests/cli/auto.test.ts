import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { jest } from "@jest/globals";

import { runCli } from "../../src/bin.js";
import * as applyCli from "../../src/cli/apply.js";
import { createAutoCommand, runAutoCommand } from "../../src/cli/auto.js";
import { writeCommandOutput } from "../../src/cli/output.js";
import * as reviewCli from "../../src/cli/review.js";
import * as runCliModule from "../../src/cli/run.js";
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
  const runRunCommandMock = jest.mocked(runCliModule.runRunCommand);
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
    expect(help).toContain("Existing spec to run");
    expect(help).toContain("--description <text>");
    expect(help).toContain("--run-agent <agent-id>");
    expect(help).toContain("--review-agent <agent-id>");
    expect(help).toContain("--profile <name>");
    expect(help).toContain("--apply");
    expect(help).toContain("--commit");
    expect(help).not.toContain("--spec-agent");
    expect(help).not.toContain("--auto-init");
    expect(help).not.toContain("--no-auto-init");
  });

  it("routes root --description through auto with equivalent outcomes", async () => {
    const fixedTimestamp = "2026-01-01T00:00:00.000Z";
    const nowSpy = jest
      .spyOn(Date, "now")
      .mockReturnValue(new Date(fixedTimestamp).getTime());

    runSpecCommandMock.mockResolvedValue({
      outputPath: ".voratiq/specs/generated.md",
      body: "Spec saved: .voratiq/specs/generated.md",
    });
    runRunCommandMock.mockResolvedValue({
      report: {
        runId: "run-flat-parity",
        spec: { path: ".voratiq/specs/generated.md" },
        status: "succeeded",
        createdAt: fixedTimestamp,
        baseRevisionSha: "deadbeef",
        agents: [{ agentId: "runner" } as never],
        hadAgentFailure: false,
        hadEvalFailure: false,
      },
      body: "run-flat-parity SUCCEEDED",
    });
    runReviewCommandMock.mockResolvedValue(
      buildReviewResult({
        reviewId: "review-flat-parity",
        outputPath:
          ".voratiq/reviews/sessions/review-flat-parity/reviewer/artifacts/review.md",
        body: "review-flat-parity SUCCEEDED",
      }),
    );

    try {
      const flatResult = await invokeCli([
        "--description",
        "Draft a migration plan",
        "--review-agent",
        "reviewer",
      ]);
      const autoResult = await invokeCli([
        "auto",
        "--description",
        "Draft a migration plan",
        "--review-agent",
        "reviewer",
      ]);

      expect(flatResult.exitCode).toBe(0);
      expect(flatResult.exitCode).toBe(autoResult.exitCode);
      expect(flatResult.stderr).toBe(autoResult.stderr);
      expect(stripAnsi(flatResult.stdout)).toBe(stripAnsi(autoResult.stdout));

      expect(runSpecCommandMock).toHaveBeenCalledTimes(2);
      expect(runRunCommandMock).toHaveBeenCalledTimes(2);
      expect(runReviewCommandMock).toHaveBeenCalledTimes(2);
      expect(runApplyCommandMock).not.toHaveBeenCalled();
      expect(runSpecCommandMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          description: "Draft a migration plan",
          suppressHint: true,
        }),
      );
      expect(runSpecCommandMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          description: "Draft a migration plan",
          suppressHint: true,
        }),
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("keeps root --description --apply behavior equivalent to auto --description --apply", async () => {
    const fixedTimestamp = "2026-01-01T00:00:00.000Z";
    const nowSpy = jest
      .spyOn(Date, "now")
      .mockReturnValue(new Date(fixedTimestamp).getTime());

    runSpecCommandMock.mockResolvedValue({
      outputPath: ".voratiq/specs/generated.md",
      body: "Spec saved: .voratiq/specs/generated.md",
    });
    runRunCommandMock.mockResolvedValue({
      report: {
        runId: "run-flat-apply-parity",
        spec: { path: ".voratiq/specs/generated.md" },
        status: "succeeded",
        createdAt: fixedTimestamp,
        baseRevisionSha: "deadbeef",
        agents: [{ agentId: "agent-good" } as never],
        hadAgentFailure: false,
        hadEvalFailure: false,
      },
      body: "run-flat-apply-parity SUCCEEDED",
    });
    runReviewCommandMock.mockResolvedValue(
      buildReviewResult({
        reviewId: "review-flat-apply-parity",
        outputPath:
          ".voratiq/reviews/sessions/review-flat-apply-parity/reviewer/artifacts/review.md",
        body: "review-flat-apply-parity SUCCEEDED",
      }),
    );
    runApplyCommandMock.mockResolvedValue({
      result: {} as never,
      body: "APPLY BODY",
    });

    try {
      await withTempRepo(async (repoRoot) => {
        await writeRecommendationArtifact(
          repoRoot,
          ".voratiq/reviews/sessions/review-flat-apply-parity/reviewer/artifacts/review.md",
          {
            preferred_agent: "agent-good",
            resolved_preferred_agent: "agent-good",
            rationale: "Best option",
            next_actions: [
              "voratiq apply --run run-flat-apply-parity --agent agent-good",
            ],
          },
        );

        const flatResult = await invokeCli([
          "--description",
          "Draft a migration plan",
          "--review-agent",
          "reviewer",
          "--apply",
        ]);
        const autoResult = await invokeCli([
          "auto",
          "--description",
          "Draft a migration plan",
          "--review-agent",
          "reviewer",
          "--apply",
        ]);

        expect(flatResult.exitCode).toBe(0);
        expect(flatResult.exitCode).toBe(autoResult.exitCode);
        expect(flatResult.stderr).toBe(autoResult.stderr);
        expect(stripAnsi(flatResult.stdout)).toBe(stripAnsi(autoResult.stdout));
      });

      expect(runSpecCommandMock).toHaveBeenCalledTimes(2);
      expect(runRunCommandMock).toHaveBeenCalledTimes(2);
      expect(runReviewCommandMock).toHaveBeenCalledTimes(2);
      expect(runApplyCommandMock).toHaveBeenCalledTimes(2);
      expect(runApplyCommandMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          runId: "run-flat-apply-parity",
          agentId: "agent-good",
          commit: false,
        }),
      );
      expect(runApplyCommandMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          runId: "run-flat-apply-parity",
          agentId: "agent-good",
          commit: false,
        }),
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("keeps root --description failure semantics equivalent to auto --description", async () => {
    runSpecCommandMock.mockRejectedValue(new Error("spec exploded"));

    const flatResult = await invokeCli([
      "--description",
      "Draft a migration plan",
      "--review-agent",
      "reviewer",
    ]);
    const autoResult = await invokeCli([
      "auto",
      "--description",
      "Draft a migration plan",
      "--review-agent",
      "reviewer",
    ]);

    expect(flatResult.exitCode).toBe(1);
    expect(flatResult.exitCode).toBe(autoResult.exitCode);
    expect(flatResult.stderr).toBe(autoResult.stderr);
    expect(stripAnsi(flatResult.stdout)).toBe(stripAnsi(autoResult.stdout));
    expect(stripAnsi(flatResult.stdout)).toContain("spec exploded");
    expect(stripAnsi(flatResult.stdout)).toContain("Auto FAILED");
    expect(runRunCommandMock).not.toHaveBeenCalled();
    expect(runReviewCommandMock).not.toHaveBeenCalled();
    expect(runApplyCommandMock).not.toHaveBeenCalled();
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
          "Next:",
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
    expect(runReviewCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-123",
        suppressHint: false,
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

  it("chains --description through spec -> run -> review -> apply when --apply is enabled", async () => {
    const stdout: string[] = [];

    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runSpecCommandMock.mockResolvedValue({
      outputPath: ".voratiq/specs/generated.md",
      body: "Spec saved: .voratiq/specs/generated.md",
    });
    runRunCommandMock.mockResolvedValue({
      report: {
        runId: "run-apply-123",
        spec: { path: ".voratiq/specs/generated.md" },
        status: "succeeded",
        createdAt: new Date().toISOString(),
        baseRevisionSha: "deadbeef",
        agents: [{ agentId: "agent-good" } as never],
        hadAgentFailure: false,
        hadEvalFailure: false,
      },
      body: "run-apply-123 SUCCEEDED",
    });
    runReviewCommandMock.mockResolvedValue(
      buildReviewResult({
        reviewId: "review-apply-123",
        outputPath:
          ".voratiq/reviews/sessions/review-apply-123/reviewer/artifacts/review.md",
        body: "review-apply-123 SUCCEEDED",
      }),
    );
    runApplyCommandMock.mockResolvedValue({
      result: {} as never,
      body: "APPLY BODY",
    });

    await withTempRepo(async (repoRoot) => {
      await writeRecommendationArtifact(
        repoRoot,
        ".voratiq/reviews/sessions/review-apply-123/reviewer/artifacts/review.md",
        {
          preferred_agent: "agent-good",
          resolved_preferred_agent: "agent-good",
          rationale: "Best option",
          next_actions: [
            "voratiq apply --run run-apply-123 --agent agent-good",
          ],
        },
      );

      const result = await runAutoCommand({
        description: "Generate and apply",
        reviewerAgentIds: ["reviewer"],
        apply: true,
      });

      expect(result.auto.status).toBe("succeeded");
      expect(result.apply.status).toBe("succeeded");
      expect(result.exitCode).toBe(0);
    });

    expect(runSpecCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Generate and apply",
        suppressHint: true,
      }),
    );
    expect(runRunCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        specPath: ".voratiq/specs/generated.md",
      }),
    );
    expect(runReviewCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-apply-123",
        suppressHint: true,
      }),
    );
    expect(runApplyCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-apply-123",
        agentId: "agent-good",
        commit: false,
      }),
    );

    const output = stripAnsi(stdout.join(""));
    expect(
      output.indexOf("Spec saved: .voratiq/specs/generated.md"),
    ).toBeLessThan(output.indexOf("run-apply-123 SUCCEEDED"));
    expect(output.indexOf("run-apply-123 SUCCEEDED")).toBeLessThan(
      output.indexOf("review-apply-123 SUCCEEDED"),
    );
    expect(output.indexOf("review-apply-123 SUCCEEDED")).toBeLessThan(
      output.indexOf("APPLY BODY"),
    );
    expect(output).toContain("Auto SUCCEEDED");
    expect(process.exitCode).toBe(0);
  });

  it("fails on --description spec errors without running downstream stages", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runSpecCommandMock.mockRejectedValue(new Error("spec exploded"));

    await runAutoCommand({
      description: "Generate failing spec",
      reviewerAgentIds: ["reviewer"],
      apply: true,
    });

    expect(runRunCommandMock).not.toHaveBeenCalled();
    expect(runReviewCommandMock).not.toHaveBeenCalled();
    expect(runApplyCommandMock).not.toHaveBeenCalled();

    const output = stripAnsi(stdout.join(""));
    expect(output).toContain("spec exploded");
    expect(output).toContain("Auto FAILED");
    expect(process.exitCode).toBe(1);
  });

  it("stops --description flow at run failure before review", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runSpecCommandMock.mockResolvedValue({
      outputPath: ".voratiq/specs/generated.md",
      specPath: ".voratiq/specs/generated.md",
      body: "Spec saved: .voratiq/specs/generated.md",
    });
    runRunCommandMock.mockResolvedValue({
      report: {
        runId: "run-desc-fail",
        spec: { path: ".voratiq/specs/generated.md" },
        status: "failed",
        createdAt: new Date().toISOString(),
        baseRevisionSha: "deadbeef",
        agents: [{ agentId: "agent-a" } as never],
        hadAgentFailure: true,
        hadEvalFailure: false,
      },
      body: "run-desc-fail FAILED",
      exitCode: 1,
    });

    await runAutoCommand({
      description: "Generate then fail run",
      reviewerAgentIds: ["reviewer"],
      apply: true,
    });

    expect(runReviewCommandMock).not.toHaveBeenCalled();
    expect(runApplyCommandMock).not.toHaveBeenCalled();

    const output = stripAnsi(stdout.join(""));
    expect(output).toContain("run-desc-fail FAILED");
    expect(output).toContain("Auto FAILED");
    expect(process.exitCode).toBe(1);
  });

  it("keeps --spec stage order deterministic through apply", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue({
      report: {
        runId: "run-spec-apply",
        spec: { path: ".voratiq/specs/existing.md" },
        status: "succeeded",
        createdAt: new Date().toISOString(),
        baseRevisionSha: "deadbeef",
        agents: [{ agentId: "agent-good" } as never],
        hadAgentFailure: false,
        hadEvalFailure: false,
      },
      body: "run-spec-apply SUCCEEDED",
    });
    runReviewCommandMock.mockResolvedValue(
      buildReviewResult({
        reviewId: "review-spec-apply",
        outputPath:
          ".voratiq/reviews/sessions/review-spec-apply/reviewer/artifacts/review.md",
        body: "review-spec-apply SUCCEEDED",
      }),
    );
    runApplyCommandMock.mockResolvedValue({
      result: {} as never,
      body: "SPEC APPLY BODY",
    });

    await withTempRepo(async (repoRoot) => {
      await writeRecommendationArtifact(
        repoRoot,
        ".voratiq/reviews/sessions/review-spec-apply/reviewer/artifacts/review.md",
        {
          preferred_agent: "agent-good",
          resolved_preferred_agent: "agent-good",
          rationale: "Best option",
          next_actions: [
            "voratiq apply --run run-spec-apply --agent agent-good",
          ],
        },
      );

      const result = await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgentIds: ["reviewer"],
        apply: true,
      });
      expect(result.auto.status).toBe("succeeded");
      expect(result.exitCode).toBe(0);
    });

    expect(runSpecCommandMock).not.toHaveBeenCalled();
    const runInvocation = runRunCommandMock.mock.invocationCallOrder.at(-1);
    const reviewInvocation =
      runReviewCommandMock.mock.invocationCallOrder.at(-1);
    const applyInvocation = runApplyCommandMock.mock.invocationCallOrder.at(-1);
    expect(runInvocation).toBeDefined();
    expect(reviewInvocation).toBeDefined();
    expect(applyInvocation).toBeDefined();
    expect(runInvocation).toBeLessThan(
      reviewInvocation ?? Number.POSITIVE_INFINITY,
    );
    expect(reviewInvocation).toBeLessThan(
      applyInvocation ?? Number.POSITIVE_INFINITY,
    );

    const output = stripAnsi(stdout.join(""));
    expect(output.indexOf("run-spec-apply SUCCEEDED")).toBeLessThan(
      output.indexOf("review-spec-apply SUCCEEDED"),
    );
    expect(output.indexOf("review-spec-apply SUCCEEDED")).toBeLessThan(
      output.indexOf("SPEC APPLY BODY"),
    );
    expect(output.indexOf("SPEC APPLY BODY")).toBeLessThan(
      output.indexOf("Auto SUCCEEDED"),
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

    expect(stripAnsi(stdout.join(""))).toContain("Auto FAILED");
    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toHaveLength(0);
  });

  it("fails the auto pipeline when run status and exit code contradict", async () => {
    const stdout: string[] = [];

    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue({
      report: {
        runId: "run-contradiction",
        spec: { path: ".voratiq/specs/existing.md" },
        status: "succeeded",
        createdAt: new Date().toISOString(),
        baseRevisionSha: "deadbeef",
        agents: [],
        hadAgentFailure: false,
        hadEvalFailure: false,
      },
      body: "run body",
      exitCode: 2,
    });

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      reviewerAgentIds: ["reviewer"],
    });

    const output = stripAnsi(stdout.join(""));
    expect(output).toContain("Run status/exit code mismatch.");
    expect(runReviewCommandMock).not.toHaveBeenCalled();
    expect(runApplyCommandMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
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

      const result = await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgentIds: ["reviewer"],
        apply: true,
      });

      expect(result.auto.status).toBe("succeeded");
      expect(result.apply.status).toBe("succeeded");
      expect(result.exitCode).toBe(0);
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

      const result = await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgentIds: ["reviewer-a", "reviewer-b"],
        apply: true,
      });

      expect(result.auto.status).toBe("succeeded");
      expect(result.apply.status).toBe("succeeded");
      expect(result.exitCode).toBe(0);
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
    expect(process.exitCode).toBe(0);
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

      const result = await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgentIds: ["reviewer-a", "reviewer-b"],
        apply: true,
      });

      expect(result.auto.status).toBe("action_required");
      expect(result.apply.status).toBe("skipped");
      expect(result.exitCode).toBe(1);
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    const output = stripAnsi(stdout.join(""));
    expect(output).toContain("To apply a solution:");
    expect(output).toContain("voratiq apply --run run-123 --agent <agent-id>");
    expect((output.match(/To apply a solution:/gu) ?? []).length).toBe(1);
    expect(output).toContain(
      "Warning: Reviewers disagreed. Review results and apply manually.",
    );
    expect(output).toContain("Auto ACTION REQUIRED");
    expect(process.exitCode).toBe(1);
  });

  it("marks no-shared multi-reviewer recommendation as action required", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-a", "agent-b"]));
    runReviewCommandMock.mockResolvedValue({
      ...buildReviewResult({
        reviewId: "review-999",
        outputPath:
          ".voratiq/reviews/sessions/review-999/reviewer-a/artifacts/review.md",
      }),
      reviews: [
        {
          agentId: "reviewer-a",
          outputPath:
            ".voratiq/reviews/sessions/review-999/reviewer-a/artifacts/review.md",
          status: "succeeded",
          missingArtifacts: [],
        },
        {
          agentId: "reviewer-b",
          outputPath:
            ".voratiq/reviews/sessions/review-999/reviewer-b/artifacts/review.md",
          status: "succeeded",
          missingArtifacts: [],
        },
      ],
    });

    await withTempRepo(async (repoRoot) => {
      await writeRecommendationArtifact(
        repoRoot,
        ".voratiq/reviews/sessions/review-999/reviewer-a/artifacts/review.md",
        {
          preferred_agent: "agent-a",
          rationale: "No resolved winner",
          next_actions: ["voratiq apply --run run-123 --agent agent-a"],
        },
      );
      await writeRecommendationArtifact(
        repoRoot,
        ".voratiq/reviews/sessions/review-999/reviewer-b/artifacts/review.md",
        {
          preferred_agent: "agent-b",
          resolved_preferred_agent: "agent-b",
          rationale: "Resolved winner",
          next_actions: ["voratiq apply --run run-123 --agent agent-b"],
        },
      );

      const result = await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgentIds: ["reviewer-a", "reviewer-b"],
        apply: true,
      });

      expect(result.auto.status).toBe("action_required");
      expect(result.apply.status).toBe("skipped");
      expect(result.exitCode).toBe(1);
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    const output = stripAnsi(stdout.join(""));
    expect(output).toContain(
      "Warning: No shared recommendation was resolved. Review results and apply manually.",
    );
    expect(output).toContain("Auto ACTION REQUIRED");
    expect(process.exitCode).toBe(1);
  });

  it("marks no-shared recommendation as action required when resolved_preferred_agent is missing", async () => {
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

      const result = await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgentIds: ["reviewer"],
        apply: true,
      });

      expect(result.auto.status).toBe("action_required");
      expect(result.apply.status).toBe("skipped");
      expect(result.exitCode).toBe(1);
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    expect(stripAnsi(stdout.join(""))).toContain(
      "Warning: No resolvable recommendation was produced. Review results and apply manually.",
    );
    expect(stripAnsi(stdout.join(""))).toContain("Auto ACTION REQUIRED");
    expect(process.exitCode).toBe(1);
  });

  it("marks aliased-only recommendation as action required when no resolved candidate is available", async () => {
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

      const result = await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgentIds: ["reviewer"],
        apply: true,
      });

      expect(result.auto.status).toBe("action_required");
      expect(result.apply.status).toBe("skipped");
      expect(result.exitCode).toBe(1);
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    expect(stripAnsi(stdout.join(""))).toContain(
      "Warning: No resolvable recommendation was produced. Review results and apply manually.",
    );
    expect(stripAnsi(stdout.join(""))).toContain("Auto ACTION REQUIRED");
    expect(process.exitCode).toBe(1);
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
      const result = await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        reviewerAgentIds: ["reviewer"],
        apply: true,
      });

      expect(result.auto.status).toBe("failed");
      expect(result.apply.status).toBe("failed");
      expect(result.exitCode).toBe(1);
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

async function invokeCli(args: readonly string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | string | undefined;
}> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutSpy = jest
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
  const stderrSpy = jest
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;

  try {
    await runCli(["node", "voratiq", ...args]);
    return {
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      exitCode: process.exitCode,
    };
  } finally {
    process.exitCode = originalExitCode ?? undefined;
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
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
