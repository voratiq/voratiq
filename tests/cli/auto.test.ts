import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { jest } from "@jest/globals";

import { runCli } from "../../src/bin.js";
import * as applyCli from "../../src/cli/apply.js";
import { createAutoCommand, runAutoCommand } from "../../src/cli/auto.js";
import { writeCommandOutput } from "../../src/cli/output.js";
import * as runCliModule from "../../src/cli/run.js";
import * as specCli from "../../src/cli/spec.js";
import * as verifyCli from "../../src/cli/verify.js";
import { HintedError } from "../../src/utils/errors.js";

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
const selectionByVerificationPath = new Map<
  string,
  {
    state: "resolvable" | "unresolved";
    applyable: boolean;
    selectedCanonicalAgentId?: string;
    unresolvedReasons: readonly unknown[];
  }
>();

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

jest.mock("../../src/cli/run.js", () => ({
  runRunCommand: jest.fn(),
}));

jest.mock("../../src/cli/spec.js", () => ({
  runSpecCommand: jest.fn(),
}));

jest.mock("../../src/cli/verify.js", () => ({
  runVerifyCommand: jest.fn(),
}));

jest.mock("../../src/cli/apply.js", () => ({
  runApplyCommand: jest.fn(),
}));

describe("voratiq auto", () => {
  const runRunCommandMock = jest.mocked(runCliModule.runRunCommand);
  const runSpecCommandMock = jest.mocked(specCli.runSpecCommand);
  const runVerifyCommandMock = jest.mocked(verifyCli.runVerifyCommand);
  const runApplyCommandMock = jest.mocked(applyCli.runApplyCommand);

  function mockRunVerifyResolvedValue(value: unknown): void {
    runVerifyCommandMock.mockResolvedValue(
      withAutoVerifyCompat(value) as Awaited<
        ReturnType<typeof verifyCli.runVerifyCommand>
      >,
    );
  }

  function mockRunVerifyImplementation(
    implementation: (
      ...args: Parameters<typeof verifyCli.runVerifyCommand>
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  ): void {
    const wrapped = async (
      ...args: Parameters<typeof verifyCli.runVerifyCommand>
    ): Promise<Awaited<ReturnType<typeof verifyCli.runVerifyCommand>>> =>
      withAutoVerifyCompat(await implementation(...args)) as unknown as Awaited<
        ReturnType<typeof verifyCli.runVerifyCommand>
      >;

    runVerifyCommandMock.mockImplementation(wrapped);
  }

  let originalExitCode: number | string | undefined;
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write> | undefined;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write> | undefined;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    selectionByVerificationPath.clear();
    runRunCommandMock.mockReset();
    runSpecCommandMock.mockReset();
    runVerifyCommandMock.mockReset();
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
      command.parseAsync(["node", "voratiq", "--verify-agent", "reviewer"]),
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
        "--verify-agent",
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
    expect(help).toContain("--verify-agent <agent-id>");
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
      sessionId: "spec-session-flat-parity",
      generatedSpecPaths: [".voratiq/specs/generated.md"],
      specPath: ".voratiq/specs/generated.md",
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
      },
      body: "run-flat-parity SUCCEEDED",
    });
    mockRunVerifyResolvedValue(
      buildVerifyResult({
        verificationId: "verify-flat-parity",
        outputPath: ".voratiq/verifications/sessions/verify-flat-parity",
        body: "review-flat-parity SUCCEEDED",
      }),
    );

    try {
      const flatResult = await invokeCli([
        "--description",
        "Draft a migration plan",
        "--verify-agent",
        "reviewer",
      ]);
      const autoResult = await invokeCli([
        "auto",
        "--description",
        "Draft a migration plan",
        "--verify-agent",
        "reviewer",
      ]);

      expect(flatResult.exitCode).toBe(0);
      expect(flatResult.exitCode).toBe(autoResult.exitCode);
      expect(flatResult.stderr).toBe(autoResult.stderr);
      expect(stripAnsi(flatResult.stdout)).toBe(stripAnsi(autoResult.stdout));

      expect(runSpecCommandMock).toHaveBeenCalledTimes(2);
      expect(runRunCommandMock).toHaveBeenCalledTimes(2);
      expect(runVerifyCommandMock).toHaveBeenCalledTimes(4);
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
      sessionId: "spec-session-flat-apply-parity",
      generatedSpecPaths: [".voratiq/specs/generated.md"],
      specPath: ".voratiq/specs/generated.md",
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
      },
      body: "run-flat-apply-parity SUCCEEDED",
    });
    mockRunVerifyResolvedValue(
      buildVerifyResult({
        verificationId: "verify-flat-apply-parity",
        outputPath: ".voratiq/verifications/sessions/verify-flat-apply-parity",
        body: "review-flat-apply-parity SUCCEEDED",
        selection: {
          state: "resolvable",
          applyable: true,
          selectedCanonicalAgentId: "agent-good",
          unresolvedReasons: [],
        },
      }),
    );
    runApplyCommandMock.mockResolvedValue({
      result: {} as never,
      body: "APPLY BODY",
    });

    try {
      await withTempRepo(async () => {
        const flatResult = await invokeCli([
          "--description",
          "Draft a migration plan",
          "--verify-agent",
          "reviewer",
          "--apply",
        ]);
        const autoResult = await invokeCli([
          "auto",
          "--description",
          "Draft a migration plan",
          "--verify-agent",
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
      expect(runVerifyCommandMock).toHaveBeenCalledTimes(4);
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
      "--verify-agent",
      "reviewer",
    ]);
    const autoResult = await invokeCli([
      "auto",
      "--description",
      "Draft a migration plan",
      "--verify-agent",
      "reviewer",
    ]);

    expect(flatResult.exitCode).toBe(1);
    expect(flatResult.exitCode).toBe(autoResult.exitCode);
    expect(flatResult.stderr).toBe(autoResult.stderr);
    expect(stripAnsi(flatResult.stdout)).toBe(stripAnsi(autoResult.stdout));
    expect(stripAnsi(flatResult.stdout)).toContain("spec exploded");
    expect(stripAnsi(flatResult.stdout)).toContain("Auto FAILED");
    expect(runRunCommandMock).not.toHaveBeenCalled();
    expect(runVerifyCommandMock).not.toHaveBeenCalled();
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

  it("allows omitting --verify-agent", async () => {
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

    expect((received as { verifyAgent?: string[] }).verifyAgent).toEqual([]);
  });

  it("fails usage when --commit is provided without --apply", async () => {
    const command = createAutoCommand().exitOverride();
    await expect(
      command.parseAsync([
        "node",
        "voratiq",
        "--spec",
        ".voratiq/specs/existing.md",
        "--verify-agent",
        "reviewer",
        "--commit",
      ]),
    ).rejects.toThrow("Option `--commit` requires `--apply`.");
    expect(runRunCommandMock).not.toHaveBeenCalled();
    expect(runApplyCommandMock).not.toHaveBeenCalled();
  });

  it("chains --description through spec -> verify(spec) -> run -> verify(run) in order without duplicate stage starts", async () => {
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
        sessionId: "spec-session-123",
        generatedSpecPaths: [".voratiq/specs/generated.md"],
        specPath: ".voratiq/specs/generated.md",
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
        },
        body: ["run-123 SUCCEEDED", "", "AGENT", "codex"].join("\n"),
      });
    });
    let verifyInvocationCount = 0;
    mockRunVerifyImplementation((input) => {
      verifyInvocationCount += 1;
      writeCommandOutput({
        alerts: [{ severity: "info", message: "Generating verification…" }],
      });
      if (input.target.kind === "spec") {
        return Promise.resolve({
          ...buildVerifyResult({
            verificationId: "verify-spec-123",
            outputPath: ".voratiq/verifications/sessions/verify-spec-123",
            body: [
              "spec-review-123 SUCCEEDED",
              "",
              "VERIFIER",
              "reviewer",
            ].join("\n"),
          }),
          selectedSpecPath: ".voratiq/specs/generated.md",
          exitCode: 0,
        });
      }
      return Promise.resolve({
        ...buildVerifyResult({
          verificationId: "verify-123",
          outputPath: ".voratiq/verifications/sessions/verify-123",
          body: [
            "verify-run-123 SUCCEEDED",
            "",
            "VERIFIER",
            "reviewer",
            "",
            "---",
            "",
            "Verifier: reviewer",
          ].join("\n"),
        }),
        exitCode: 0,
      });
    });

    await runAutoCommand({
      description: "Generate a run spec",
      verifyAgentIds: ["reviewer"],
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
    expect(runVerifyCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "spec", sessionId: "spec-session-123" },
        suppressHint: true,
      }),
    );
    expect(runVerifyCommandMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        target: { kind: "run", sessionId: "run-123" },
        suppressHint: false,
      }),
    );
    expect((output.match(/Generating specification…/gu) ?? []).length).toBe(1);
    expect((output.match(/Executing run…/gu) ?? []).length).toBe(1);
    expect((output.match(/Generating verification…/gu) ?? []).length).toBe(2);
    expect(
      (output.match(/Spec saved: \.voratiq\/specs\/generated\.md/gu) ?? [])
        .length,
    ).toBe(1);
    expect((output.match(/spec-review-123 SUCCEEDED/gu) ?? []).length).toBe(1);
    expect(output).toContain("run-123 SUCCEEDED");
    expect((output.match(/\nverify-run-123 SUCCEEDED/gu) ?? []).length).toBe(1);
    expect(verifyInvocationCount).toBe(2);

    expect(output.indexOf("Generating specification…")).toBeLessThan(
      output.indexOf("Spec saved: .voratiq/specs/generated.md"),
    );
    expect(
      output.indexOf("Spec saved: .voratiq/specs/generated.md"),
    ).toBeLessThan(output.indexOf("Generating verification…"));
    expect(output.indexOf("Generating verification…")).toBeLessThan(
      output.indexOf("spec-review-123 SUCCEEDED"),
    );
    expect(output.indexOf("spec-review-123 SUCCEEDED")).toBeLessThan(
      output.indexOf("Executing run…"),
    );
    expect(output.indexOf("Executing run…")).toBeLessThan(
      output.indexOf("run-123 SUCCEEDED"),
    );
    expect(output.indexOf("run-123 SUCCEEDED")).toBeLessThan(
      output.lastIndexOf("Generating verification…"),
    );
    expect(output.lastIndexOf("Generating verification…")).toBeLessThan(
      output.indexOf("\nverify-run-123 SUCCEEDED"),
    );
  });

  it("chains --description through spec -> verify(spec) -> run -> verify(run) -> apply when --apply is enabled", async () => {
    const stdout: string[] = [];

    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runSpecCommandMock.mockResolvedValue({
      sessionId: "spec-session-apply-123",
      generatedSpecPaths: [".voratiq/specs/generated.md"],
      specPath: ".voratiq/specs/generated.md",
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
      },
      body: "run-apply-123 SUCCEEDED",
    });
    mockRunVerifyImplementation((input) => {
      if (input.target.kind === "spec") {
        return Promise.resolve(
          buildVerifyResult({
            verificationId: "verify-spec-apply-123",
            outputPath: ".voratiq/verifications/sessions/verify-spec-apply-123",
            body: "verify-spec-apply-123 SUCCEEDED",
          }),
        );
      }

      return Promise.resolve(
        buildVerifyResult({
          verificationId: "verify-apply-123",
          outputPath: ".voratiq/verifications/sessions/verify-apply-123",
          body: "verify-run-apply-123 SUCCEEDED",
        }),
      );
    });
    runApplyCommandMock.mockResolvedValue({
      result: {} as never,
      body: "APPLY BODY",
    });

    await withTempRepo(async (repoRoot) => {
      writeVerificationSelection(
        repoRoot,
        ".voratiq/verifications/sessions/verify-apply-123",
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
        verifyAgentIds: ["reviewer"],
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
    expect(runVerifyCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "run", sessionId: "run-apply-123" },
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
      output.indexOf("verify-run-apply-123 SUCCEEDED"),
    );
    expect(output.indexOf("verify-run-apply-123 SUCCEEDED")).toBeLessThan(
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
      verifyAgentIds: ["reviewer"],
      apply: true,
    });

    expect(runRunCommandMock).not.toHaveBeenCalled();
    expect(runVerifyCommandMock).not.toHaveBeenCalled();
    expect(runApplyCommandMock).not.toHaveBeenCalled();

    const output = stripAnsi(stdout.join(""));
    expect(output).toContain("spec exploded");
    expect(output).toContain("Auto FAILED");
    expect(process.exitCode).toBe(1);
  });

  it("stops --description flow at run failure before verify(run)", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runSpecCommandMock.mockResolvedValue({
      sessionId: "spec-session-desc-fail",
      generatedSpecPaths: [".voratiq/specs/generated.md"],
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
      },
      body: "run-desc-fail FAILED",
      exitCode: 1,
    });
    mockRunVerifyResolvedValue({
      ...buildVerifyResult({
        verificationId: "verify-spec-desc-fail",
        outputPath: ".voratiq/verifications/sessions/verify-spec-desc-fail",
        body: "verify-spec-desc-fail SUCCEEDED",
      }),
      selectedSpecPath: ".voratiq/specs/generated.md",
      exitCode: 0,
    });

    await runAutoCommand({
      description: "Generate then fail run",
      verifyAgentIds: ["reviewer"],
      apply: true,
    });

    expect(runVerifyCommandMock).toHaveBeenCalledTimes(1);
    expect(runVerifyCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "spec", sessionId: "spec-session-desc-fail" },
        suppressHint: true,
      }),
    );
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
      },
      body: "run-spec-apply SUCCEEDED",
    });
    mockRunVerifyResolvedValue(
      buildVerifyResult({
        verificationId: "verify-spec-apply",
        outputPath: ".voratiq/verifications/sessions/verify-spec-apply",
        body: "review-spec-apply SUCCEEDED",
      }),
    );
    runApplyCommandMock.mockResolvedValue({
      result: {} as never,
      body: "SPEC APPLY BODY",
    });

    await withTempRepo(async (repoRoot) => {
      writeVerificationSelection(
        repoRoot,
        ".voratiq/verifications/sessions/verify-spec-apply",
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
        verifyAgentIds: ["reviewer"],
        apply: true,
      });
      expect(result.auto.status).toBe("succeeded");
      expect(result.exitCode).toBe(0);
    });

    expect(runSpecCommandMock).not.toHaveBeenCalled();
    const runInvocation = runRunCommandMock.mock.invocationCallOrder.at(-1);
    const reviewInvocation =
      runVerifyCommandMock.mock.invocationCallOrder.at(-1);
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
        },
        body: ["run-456 SUCCEEDED", "", "AGENT", "runner"].join("\n"),
      });
    });
    mockRunVerifyImplementation(() => {
      writeCommandOutput({
        alerts: [{ severity: "info", message: "Generating verification…" }],
      });
      return Promise.resolve({
        ...buildVerifyResult({
          verificationId: "verify-456",
          body: ["review-456 ABORTED", "", "AGENT", "reviewer"].join("\n"),
        }),
        exitCode: 1,
      });
    });

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      verifyAgentIds: ["reviewer"],
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
        },
        body: ["run-789 SUCCEEDED", "", "AGENT", "runner"].join("\n"),
      });
    });
    mockRunVerifyImplementation(() => {
      writeCommandOutput({
        alerts: [{ severity: "info", message: "Generating verification…" }],
      });
      return Promise.resolve({
        ...buildVerifyResult({
          verificationId: "verify-789",
          body: ["review-789 SUCCEEDED", "", "AGENT", "reviewer"].join("\n"),
        }),
        exitCode: 0,
      });
    });

    try {
      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        verifyAgentIds: ["reviewer"],
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
      },
      body: "run body",
      exitCode: 1,
    });

    mockRunVerifyResolvedValue(
      buildVerifyResult({
        verificationId: "verify-456",
        outputPath: ".voratiq/verifications/sessions/verify-456",
      }),
    );

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      verifyAgentIds: ["reviewer"],
    });

    expect(runRunCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        specPath: ".voratiq/specs/existing.md",
        agentOverrideFlag: "--run-agent",
      }),
    );
    expect(runVerifyCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "run", sessionId: "run-123" },
        agentIds: ["reviewer"],
        agentOverrideFlag: "--verify-agent",
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
      },
      body: "run body",
      exitCode: 2,
    });

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      verifyAgentIds: ["reviewer"],
    });

    const output = stripAnsi(stdout.join(""));
    expect(output).toContain("Run status/exit code mismatch.");
    expect(runVerifyCommandMock).not.toHaveBeenCalled();
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
      },
      body: "run body",
    });

    runVerifyCommandMock.mockRejectedValue(new Error("review exploded"));

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      verifyAgentIds: ["reviewer"],
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
      },
      body: "run body",
    });
    mockRunVerifyResolvedValue(
      buildVerifyResult({
        verificationId: "verify-456",
        outputPath: ".voratiq/verifications/sessions/verify-456",
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
    expect(runVerifyCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "run", sessionId: "run-123" },
        agentIds: undefined,
        agentOverrideFlag: "--verify-agent",
        profile: "quality",
      }),
    );
  });

  it("passes --max-parallel through to review execution", async () => {
    runRunCommandMock.mockResolvedValue(buildRunResult(["alpha"]));
    mockRunVerifyResolvedValue(buildVerifyResult());

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      verifyAgentIds: ["reviewer"],
      maxParallel: 2,
    });

    expect(runVerifyCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "run", sessionId: "run-123" },
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
    expect(runVerifyCommandMock).not.toHaveBeenCalled();
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
    expect(runVerifyCommandMock).not.toHaveBeenCalled();
  });

  it("surfaces verify-stage missing resolution when --verify-agent is omitted", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["codex"]));
    runVerifyCommandMock.mockRejectedValue(
      new HintedError('No agent found for stage "verify".', {
        detailLines: [
          "Resolved agents: (none).",
          "Checked profiles.default.verify.agents in .voratiq/orchestration.yaml.",
        ],
        hintLines: [
          "Provide --verify-agent <id> to run verification with an explicit agent.",
          "Configure at least one agent under profiles.default.verify.agents in .voratiq/orchestration.yaml.",
        ],
      }),
    );

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
    });

    const output = stripAnsi(stdout.join(""));
    expect(output).toContain('No agent found for stage "verify".');
    expect(output).toContain("--verify-agent <id>");
    expect(output).toContain("profiles.default.verify.agents");
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
    mockRunVerifyResolvedValue({
      ...buildVerifyResult({
        verificationId: "verify-789",
        outputPath:
          ".voratiq/verifications/sessions/verify-789/reviewer-a/run-review/artifacts/result.json",
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
          "Artifact: .voratiq/verifications/sessions/verify-789/reviewer-a/run-review/artifacts/result.json",
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
        buildVerificationExecution({
          agentId: "reviewer-a",
          outputPath:
            ".voratiq/verifications/sessions/verify-789/reviewer-a/run-review/artifacts/result.json",
        }),
        buildVerificationExecution({
          agentId: "reviewer-b",
          outputPath:
            ".voratiq/verifications/sessions/verify-789/reviewer-b/run-review/artifacts/result.json",
          status: "failed",
          error: "reviewer violated output contract",
        }),
      ],
    });

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      verifyAgentIds: ["reviewer-a", "reviewer-b"],
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
      },
      body: "RUN BODY",
    });

    mockRunVerifyResolvedValue(
      buildVerifyResult({
        verificationId: "verify-xyz",
        outputPath: ".voratiq/verifications/sessions/verify-xyz",
        body: "REVIEW BODY",
      }),
    );

    await runAutoCommand({
      specPath: ".voratiq/specs/existing.md",
      verifyAgentIds: ["reviewer"],
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
    mockRunVerifyResolvedValue(
      buildVerifyResult({
        verificationId: "verify-123",
        // Intentionally conflicting markdown text to ensure auto does not parse it.
        body: "## Recommendation\n**Preferred Candidate**: wrong-agent",
        selection: {
          state: "resolvable",
          applyable: true,
          selectedCanonicalAgentId: "agent-good",
          unresolvedReasons: [],
        },
      }),
    );
    runApplyCommandMock.mockResolvedValue({
      result: {} as never,
      body: "APPLY BODY",
    });

    await withTempRepo(async () => {
      const result = await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        verifyAgentIds: ["reviewer"],
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
    mockRunVerifyResolvedValue({
      ...buildVerifyResult({
        verificationId: "verify-123",
        outputPath:
          ".voratiq/verifications/sessions/verify-123/reviewer-a/run-review/artifacts/result.json",
        selection: {
          state: "resolvable",
          applyable: true,
          selectedCanonicalAgentId: "agent-good",
          unresolvedReasons: [],
        },
      }),
      reviews: [
        buildVerificationExecution({
          agentId: "reviewer-a",
          outputPath:
            ".voratiq/verifications/sessions/verify-123/reviewer-a/run-review/artifacts/result.json",
        }),
        buildVerificationExecution({
          agentId: "reviewer-b",
          outputPath:
            ".voratiq/verifications/sessions/verify-123/reviewer-b/run-review/artifacts/result.json",
        }),
      ],
    });

    runApplyCommandMock.mockResolvedValue({
      result: {} as never,
      body: "APPLY BODY",
    });

    await withTempRepo(async () => {
      const result = await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        verifyAgentIds: ["reviewer-a", "reviewer-b"],
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
    mockRunVerifyResolvedValue({
      ...buildVerifyResult({
        verificationId: "verify-123",
        outputPath:
          ".voratiq/verifications/sessions/verify-123/reviewer-a/run-review/artifacts/result.json",
        body: [
          "REVIEW BODY",
          "",
          "---",
          "",
          "To apply a solution:",
          "    voratiq apply --run run-123 --agent <agent-id>",
        ].join("\n"),
        selection: {
          state: "unresolved",
          applyable: false,
          unresolvedReasons: [
            {
              code: "reviewer_disagreement",
              selections: [
                {
                  reviewerAgentId: "reviewer-a",
                  selectedCanonicalAgentId: "agent-a",
                },
                {
                  reviewerAgentId: "reviewer-b",
                  selectedCanonicalAgentId: "agent-b",
                },
              ],
            },
          ],
        },
      }),
      reviews: [
        buildVerificationExecution({
          agentId: "reviewer-a",
          outputPath:
            ".voratiq/verifications/sessions/verify-123/reviewer-a/run-review/artifacts/result.json",
        }),
        buildVerificationExecution({
          agentId: "reviewer-b",
          outputPath:
            ".voratiq/verifications/sessions/verify-123/reviewer-b/run-review/artifacts/result.json",
        }),
      ],
    });

    await withTempRepo(async () => {
      const result = await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        verifyAgentIds: ["reviewer-a", "reviewer-b"],
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
      "---\n\nAction required: Verification did not produce a resolvable candidate; manual selection required.",
    );
    expect(output).toContain(
      "Action required: Verification did not produce a resolvable candidate; manual selection required.",
    );
    expect(output).toContain("Auto ACTION_REQUIRED");
    expect(process.exitCode).toBe(1);
  });

  it("marks multi-reviewer disagreement as action required even without resolved_preferred_agent on every reviewer", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-a", "agent-b"]));
    mockRunVerifyResolvedValue({
      ...buildVerifyResult({
        verificationId: "verify-999",
        outputPath:
          ".voratiq/verifications/sessions/verify-999/reviewer-a/run-review/artifacts/result.json",
        selection: {
          state: "unresolved",
          applyable: false,
          unresolvedReasons: [
            {
              code: "reviewer_disagreement",
              selections: [
                {
                  reviewerAgentId: "reviewer-a",
                  selectedCanonicalAgentId: "agent-a",
                },
                {
                  reviewerAgentId: "reviewer-b",
                  selectedCanonicalAgentId: "agent-b",
                },
              ],
            },
          ],
        },
      }),
      reviews: [
        buildVerificationExecution({
          agentId: "reviewer-a",
          outputPath:
            ".voratiq/verifications/sessions/verify-999/reviewer-a/run-review/artifacts/result.json",
        }),
        buildVerificationExecution({
          agentId: "reviewer-b",
          outputPath:
            ".voratiq/verifications/sessions/verify-999/reviewer-b/run-review/artifacts/result.json",
        }),
      ],
    });

    await withTempRepo(async () => {
      const result = await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        verifyAgentIds: ["reviewer-a", "reviewer-b"],
        apply: true,
      });

      expect(result.auto.status).toBe("action_required");
      expect(result.apply.status).toBe("skipped");
      expect(result.exitCode).toBe(1);
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    const output = stripAnsi(stdout.join(""));
    expect(output).toContain(
      "Action required: Verification did not produce a resolvable candidate; manual selection required.",
    );
    expect(output).toContain("Auto ACTION_REQUIRED");
    expect(process.exitCode).toBe(1);
  });

  it("marks unresolved verify(run) as action required even without apply", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-a", "agent-b"]));
    mockRunVerifyResolvedValue({
      ...buildVerifyResult({
        verificationId: "verify-321",
        outputPath:
          ".voratiq/verifications/sessions/verify-321/reviewer-a/run-review/artifacts/result.json",
        body: [
          "REVIEW BODY",
          "",
          "---",
          "",
          "To apply a solution:",
          "    voratiq apply --run run-123 --agent <agent-id>",
        ].join("\n"),
        selection: {
          state: "unresolved",
          applyable: false,
          unresolvedReasons: [
            {
              code: "reviewer_disagreement",
              selections: [
                {
                  reviewerAgentId: "reviewer-a",
                  selectedCanonicalAgentId: "agent-a",
                },
                {
                  reviewerAgentId: "reviewer-b",
                  selectedCanonicalAgentId: "agent-b",
                },
              ],
            },
          ],
        },
      }),
      reviews: [
        buildVerificationExecution({
          agentId: "reviewer-a",
          outputPath:
            ".voratiq/verifications/sessions/verify-321/reviewer-a/run-review/artifacts/result.json",
        }),
        buildVerificationExecution({
          agentId: "reviewer-b",
          outputPath:
            ".voratiq/verifications/sessions/verify-321/reviewer-b/run-review/artifacts/result.json",
        }),
      ],
    });

    await withTempRepo(async () => {
      const result = await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        verifyAgentIds: ["reviewer-a", "reviewer-b"],
      });

      expect(result.auto.status).toBe("action_required");
      expect(result.apply.status).toBe("skipped");
      expect(result.exitCode).toBe(1);
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    const output = stripAnsi(stdout.join(""));
    expect(output).toContain("REVIEW BODY");
    expect(output).toContain(
      "Action required: Verification did not produce a resolvable candidate; manual selection required.",
    );
    expect(output).toContain("Auto ACTION_REQUIRED");
    expect(process.exitCode).toBe(1);
  });

  it("marks multi-draft spec generation as action required", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runSpecCommandMock.mockResolvedValue({
      sessionId: "spec-session-123",
      generatedSpecPaths: [
        ".voratiq/specs/sessions/spec-123/alpha/artifacts/spec.md",
        ".voratiq/specs/sessions/spec-123/beta/artifacts/spec.md",
      ],
      body: "SPEC BODY",
    });

    const result = await runAutoCommand({
      description: "Draft a migration plan",
      apply: true,
    });

    expect(result.auto.status).toBe("action_required");
    expect(result.apply.status).toBe("skipped");
    expect(result.exitCode).toBe(1);
    expect(runRunCommandMock).not.toHaveBeenCalled();
    const output = stripAnsi(stdout.join(""));
    expect(output).toContain("SPEC BODY");
    expect(output).toContain(
      "Action required: Multiple specs generated; manual selection required.",
    );
    expect(output).toContain("Auto ACTION_REQUIRED");
    expect(process.exitCode).toBe(1);
  });

  it("auto-applies when preferred_agent already matches a canonical run agent id", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-good"]));
    mockRunVerifyResolvedValue(
      buildVerifyResult({
        selection: {
          state: "resolvable",
          applyable: true,
          selectedCanonicalAgentId: "agent-good",
          unresolvedReasons: [],
        },
      }),
    );
    runApplyCommandMock.mockResolvedValue({
      result: {} as never,
      body: "APPLY BODY",
    });

    await withTempRepo(async () => {
      const result = await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        verifyAgentIds: ["reviewer"],
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

  it("marks aliased-only recommendation as action required when no resolved candidate is available", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-good"]));
    mockRunVerifyResolvedValue(
      buildVerifyResult({
        selection: {
          state: "unresolved",
          applyable: false,
          unresolvedReasons: [
            {
              code: "selector_unresolved",
              selector: "r_aaaaaaaaaa",
              availableCanonicalAgentIds: ["agent-good"],
              availableAliases: [],
            },
          ],
        },
      }),
    );

    await withTempRepo(async () => {
      const result = await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        verifyAgentIds: ["reviewer"],
        apply: true,
      });

      expect(result.auto.status).toBe("action_required");
      expect(result.apply.status).toBe("skipped");
      expect(result.exitCode).toBe(1);
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    expect(stripAnsi(stdout.join(""))).toContain(
      "Action required: Verification did not produce a resolvable candidate; manual selection required.",
    );
    expect(stripAnsi(stdout.join(""))).toContain("Auto ACTION_REQUIRED");
    expect(process.exitCode).toBe(1);
  });

  it("passes --commit through to apply when --apply is enabled", async () => {
    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-good"]));
    mockRunVerifyResolvedValue(buildVerifyResult());
    runApplyCommandMock.mockResolvedValue({
      result: {} as never,
      body: "APPLY BODY",
    });

    await withTempRepo(async (repoRoot) => {
      writeVerificationSelection(
        repoRoot,
        ".voratiq/verifications/sessions/verify-123",
        {
          preferred_agent: "agent-good",
          resolved_preferred_agent: "agent-good",
          rationale: "Best option",
          next_actions: ["voratiq apply --run run-123 --agent agent-good"],
        },
      );

      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        verifyAgentIds: ["reviewer"],
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

  it("fails safely when verify stage does not return a selection policy", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-good"]));
    mockRunVerifyResolvedValue(buildVerifyResult());

    await withTempRepo(async () => {
      const result = await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        verifyAgentIds: ["reviewer"],
        apply: true,
      });

      expect(result.auto.status).toBe("failed");
      expect(result.apply.status).toBe("failed");
      expect(result.exitCode).toBe(1);
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    expect(stripAnsi(stdout.join(""))).toContain(
      "Verify stage did not return a selection policy.",
    );
    expect(stripAnsi(stdout.join(""))).toContain("Auto FAILED");
    expect(process.exitCode).toBe(1);
  });

  it("marks unresolved selector policies as action required", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-a", "agent-b"]));
    mockRunVerifyResolvedValue(
      buildVerifyResult({
        selection: {
          state: "unresolved",
          applyable: false,
          unresolvedReasons: [
            {
              code: "selector_unresolved",
              selector: "",
              availableCanonicalAgentIds: ["agent-a", "agent-b"],
              availableAliases: [],
            },
          ],
        },
      }),
    );

    await withTempRepo(async () => {
      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        verifyAgentIds: ["reviewer"],
        apply: true,
      });
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    expect(stripAnsi(stdout.join(""))).toContain(
      "Verification did not produce a resolvable candidate; manual selection required.",
    );
    expect(stripAnsi(stdout.join(""))).toContain("Auto ACTION_REQUIRED");
    expect(process.exitCode).toBe(1);
  });

  it("marks unresolved none-like selections as action required", async () => {
    const stdout: string[] = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    runRunCommandMock.mockResolvedValue(buildRunResult(["agent-a", "agent-b"]));
    mockRunVerifyResolvedValue(
      buildVerifyResult({
        selection: {
          state: "unresolved",
          applyable: false,
          unresolvedReasons: [
            {
              code: "selector_unresolved",
              selector: "none",
              availableCanonicalAgentIds: ["agent-a", "agent-b"],
              availableAliases: [],
            },
          ],
        },
      }),
    );

    await withTempRepo(async () => {
      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        verifyAgentIds: ["reviewer"],
        apply: true,
      });
    });

    expect(runApplyCommandMock).not.toHaveBeenCalled();
    expect(stripAnsi(stdout.join(""))).toContain(
      "Verification did not produce a resolvable candidate; manual selection required.",
    );
    expect(stripAnsi(stdout.join(""))).toContain("Auto ACTION_REQUIRED");
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
    mockRunVerifyResolvedValue(buildVerifyResult());
    runApplyCommandMock.mockRejectedValue(new Error("apply exploded"));

    await withTempRepo(async (repoRoot) => {
      writeVerificationSelection(
        repoRoot,
        ".voratiq/verifications/sessions/verify-123",
        {
          preferred_agent: "agent-good",
          resolved_preferred_agent: "agent-good",
          rationale: "Best option",
          next_actions: [],
        },
      );

      await runAutoCommand({
        specPath: ".voratiq/specs/existing.md",
        verifyAgentIds: ["reviewer"],
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

function buildVerifyResult(
  options: {
    verificationId?: string;
    agentId?: string;
    outputPath?: string;
    body?: string;
    selection?: {
      state: "resolvable" | "unresolved";
      applyable: boolean;
      selectedCanonicalAgentId?: string;
      unresolvedReasons: readonly unknown[];
    };
  } = {},
) {
  const verificationId = options.verificationId ?? "verify-123";
  const outputPath =
    options.outputPath ?? `.voratiq/verifications/sessions/${verificationId}`;
  const body = options.body ?? "verify body";
  return {
    verificationId,
    outputPath,
    body,
    ...(options.selection ? { selection: options.selection } : {}),
  };
}

function buildVerificationExecution(
  overrides: {
    agentId?: string;
    outputPath?: string;
    status?: "succeeded" | "failed";
    error?: string;
  } = {},
) {
  return {
    agentId: overrides.agentId ?? "reviewer",
    outputPath:
      overrides.outputPath ??
      ".voratiq/verifications/sessions/verify-123/reviewer/run-review/artifacts/result.json",
    status: overrides.status ?? ("succeeded" as const),
    missingArtifacts: [],
    tokenUsageResult: {
      status: "unavailable" as const,
      reason: "chat_not_captured" as const,
      provider: "unknown",
      modelId: "unknown",
    },
    ...(overrides.error ? { error: overrides.error } : {}),
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

function writeVerificationSelection(
  repoRoot: string,
  verifyOutputPath: string,
  recommendation: {
    preferred_agent: string;
    ranking?: string[];
    resolved_preferred_agent?: string;
    rationale: string;
    next_actions: string[];
  },
): void {
  const preferredAgent = recommendation.preferred_agent.trim();
  const selectedCanonicalAgentId =
    recommendation.resolved_preferred_agent?.trim() || preferredAgent;
  selectionByVerificationPath.set(
    verifyOutputPath,
    !preferredAgent || preferredAgent === "none"
      ? {
          state: "unresolved",
          applyable: false,
          unresolvedReasons: [
            {
              code: "selector_unresolved",
              selector: preferredAgent || recommendation.preferred_agent,
              availableCanonicalAgentIds: [],
              availableAliases: [],
            },
          ],
        }
      : {
          state: "resolvable",
          applyable: true,
          selectedCanonicalAgentId,
          unresolvedReasons: [],
        },
  );
  void repoRoot;
}

function withAutoVerifyCompat<T>(value: T): T {
  if (!value || typeof value !== "object") {
    return value;
  }

  return new Proxy(value as Record<string, unknown>, {
    get(target, prop, receiver) {
      if (prop === "verificationId") {
        return Reflect.get(target, prop, receiver);
      }
      if (prop === "selectedSpecPath") {
        return (
          Reflect.get(target, prop, receiver) ?? ".voratiq/specs/generated.md"
        );
      }
      if (prop === "selection") {
        const selection =
          Reflect.get(target, prop, receiver) ??
          (typeof target["outputPath"] === "string"
            ? selectionByVerificationPath.get(target["outputPath"])
            : undefined);
        if (selection === undefined) {
          return undefined;
        }
        if (
          typeof selection === "object" &&
          selection !== null &&
          "decision" in selection
        ) {
          return selection;
        }
        return { decision: selection };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  }) as T;
}
