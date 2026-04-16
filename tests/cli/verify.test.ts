import { readFile } from "node:fs/promises";

import { Command } from "commander";

import { checkPlatformSupport } from "../../src/agents/runtime/sandbox.js";
import {
  createVerifyCommand,
  runVerifyCommand,
  type VerifyCommandOptions,
} from "../../src/cli/verify.js";
import {
  executeVerifyCommand,
  type VerifyCommandResult as VerifyExecutionResult,
} from "../../src/commands/verify/command.js";
import {
  ensureSandboxDependencies,
  resolveCliContext,
} from "../../src/preflight/index.js";
import { colorize } from "../../src/utils/colors.js";
import { silenceCommander } from "../support/commander.js";

const executeVerifyCommandMock = jest.mocked(executeVerifyCommand);
const checkPlatformSupportMock = jest.mocked(checkPlatformSupport);
const ensureSandboxDependenciesMock = jest.mocked(ensureSandboxDependencies);
const resolveCliContextMock = jest.mocked(resolveCliContext);
const readFileMock = jest.mocked(readFile);

jest.mock("../../src/commands/verify/command.js", () => {
  const actual = jest.requireActual<
    typeof import("../../src/commands/verify/command.js")
  >("../../src/commands/verify/command.js");
  return {
    ...actual,
    executeVerifyCommand: jest.fn(),
  };
});

jest.mock("../../src/preflight/index.js", () => {
  const actual = jest.requireActual<
    typeof import("../../src/preflight/index.js")
  >("../../src/preflight/index.js");
  return {
    ...actual,
    resolveCliContext: jest.fn(),
    ensureSandboxDependencies: jest.fn(),
  };
});

jest.mock("../../src/agents/runtime/sandbox.js", () => {
  const actual = jest.requireActual<
    typeof import("../../src/agents/runtime/sandbox.js")
  >("../../src/agents/runtime/sandbox.js");
  return {
    ...actual,
    checkPlatformSupport: jest.fn(),
  };
});

jest.mock("node:fs/promises", () => {
  const actual =
    jest.requireActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    readFile: jest.fn(),
  };
});

describe("voratiq verify", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    checkPlatformSupportMock.mockReturnValue(undefined);
    ensureSandboxDependenciesMock.mockReturnValue(undefined);
    resolveCliContextMock.mockResolvedValue({
      root: "/repo",
      workspacePaths: {
        root: "/repo",
        workspaceDir: "/repo/.voratiq",
        runsDir: "/repo/.voratiq/run",
        runsFile: "/repo/.voratiq/run/index.json",
        reductionsDir: "/repo/.voratiq/reduce",
        reductionsFile: "/repo/.voratiq/reduce/index.json",
        specsDir: "/repo/.voratiq/spec",
        specsFile: "/repo/.voratiq/spec/index.json",
        verificationsDir: "/repo/.voratiq/verify",
        verificationsFile: "/repo/.voratiq/verify/index.json",
      },
    });
    readFileMock.mockRejectedValue(new Error("missing"));
  });

  it("requires exactly one target flag", async () => {
    const verifyCommand = silenceCommander(createVerifyCommand());
    verifyCommand.exitOverride();

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(verifyCommand);

    await expect(
      program.parseAsync(["node", "voratiq", "verify"]),
    ).rejects.toThrow(
      /exactly one target flag is required: `--spec`, `--run`, `--reduce`, or `--message`/iu,
    );
  });

  it("parses --run and repeatable --agent options", async () => {
    let received: unknown;
    const verifyCommand = silenceCommander(createVerifyCommand());
    verifyCommand.exitOverride().action((options) => {
      received = options;
    });

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(verifyCommand);

    await program.parseAsync([
      "node",
      "voratiq",
      "verify",
      "--run",
      "run-123",
      "--agent",
      "verifier-a",
      "--agent",
      "verifier-b",
    ]);

    expect((received as { run?: string }).run).toBe("run-123");
    expect((received as { agent?: string[] }).agent).toEqual([
      "verifier-a",
      "verifier-b",
    ]);
  });

  it("parses --message target selection", async () => {
    let received: unknown;
    const verifyCommand = silenceCommander(createVerifyCommand());
    verifyCommand.exitOverride().action((options) => {
      received = options;
    });

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(verifyCommand);

    await program.parseAsync([
      "node",
      "voratiq",
      "verify",
      "--message",
      "message-123",
    ]);

    expect((received as { message?: string }).message).toBe("message-123");
  });

  it("returns verification id and transcript for run-target verification", async () => {
    readFileMock.mockImplementation((path) => {
      const displayPath = normalizeReadFilePath(path);
      if (
        displayPath.endsWith(
          "/.voratiq/verify/sessions/verify-123/programmatic/artifacts/result.json",
        )
      ) {
        return Promise.resolve(
          JSON.stringify({
            method: "programmatic",
            generatedAt: "2026-03-19T20:00:03.000Z",
            target: {
              kind: "run",
              sessionId: "run-123",
              candidateIds: ["agent-a", "agent-b"],
            },
            scope: "run",
            candidates: [
              {
                candidateId: "agent-a",
                results: [{ slug: "format", status: "succeeded" }],
              },
              {
                candidateId: "agent-b",
                results: [{ slug: "format", status: "failed" }],
              },
            ],
          }),
        );
      }
      if (
        displayPath.endsWith(
          "/.voratiq/verify/sessions/verify-123/gpt-5-4/run-verification/artifacts/result.json",
        )
      ) {
        return Promise.resolve(
          JSON.stringify({
            method: "rubric",
            template: "run-verification",
            verifierId: "gpt-5-4",
            generatedAt: "2026-03-19T20:00:05.000Z",
            status: "succeeded",
            result: {
              assessments: [
                { candidate_id: "v_aaaaaaaaaa", outcome: "best" },
                { candidate_id: "v_bbbbbbbbbb", outcome: "second" },
              ],
              preferred: "v_aaaaaaaaaa",
              ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
              rationale: "v_aaaaaaaaaa is the strongest candidate.",
              next_actions: [
                "voratiq apply --run run-123 --agent v_aaaaaaaaaa",
              ],
            },
          }),
        );
      }
      throw new Error(`Unexpected read: ${displayPath}`);
    });

    const execution: VerifyExecutionResult = {
      verificationId: "verify-123",
      record: {
        sessionId: "verify-123",
        createdAt: "2026-03-19T20:00:00.000Z",
        startedAt: "2026-03-19T20:00:01.000Z",
        completedAt: "2026-03-19T20:00:05.000Z",
        status: "succeeded",
        target: {
          kind: "run",
          sessionId: "run-123",
          candidateIds: ["agent-a", "agent-b"],
        },
        blinded: {
          enabled: true,
          aliasMap: {
            v_aaaaaaaaaa: "agent-a",
            v_bbbbbbbbbb: "agent-b",
          },
        },
        methods: [
          {
            method: "programmatic",
            scope: { kind: "run" },
            status: "succeeded",
            artifactPath:
              ".voratiq/verify/sessions/verify-123/programmatic/artifacts/result.json",
            startedAt: "2026-03-19T20:00:01.000Z",
            completedAt: "2026-03-19T20:00:03.000Z",
          },
          {
            method: "rubric",
            template: "run-verification",
            verifierId: "gpt-5-4",
            scope: { kind: "run" },
            status: "succeeded",
            artifactPath:
              ".voratiq/verify/sessions/verify-123/gpt-5-4/run-verification/artifacts/result.json",
            startedAt: "2026-03-19T20:00:03.000Z",
            completedAt: "2026-03-19T20:00:05.000Z",
          },
        ],
      },
    };
    executeVerifyCommandMock.mockResolvedValue(execution);

    const result = await runVerifyCommand({
      target: { kind: "run", sessionId: "run-123" },
      stdout: { write: () => true, isTTY: false },
    } satisfies VerifyCommandOptions);

    expect(result.verificationId).toBe("verify-123");
    expect(result.exitCode).toBe(0);
    expect(result.body).toContain("AGENT");
    expect(result.body).toContain("VERIFIER");
    expect(result.body).toContain("Agent: gpt-5-4");
    expect(result.body).toContain("Verifier: run-verification");
    expect(result.body).toContain("```markdown");
    expect(result.body).toContain("**Preferred**: agent-a");
    expect(result.body).toContain(
      "**Rationale**: agent-a is the strongest candidate.",
    );
    expect(result.body).toContain("**Next Actions**:");
    expect(result.body).toContain(
      "voratiq apply --run run-123 --agent agent-a",
    );
    expect(result.body).toContain(
      "Output: .voratiq/verify/sessions/verify-123/gpt-5-4/run-verification/artifacts/result.json",
    );
    expect(result.body).toContain(
      "---\n\nTo apply a solution:\n  voratiq apply --run run-123 --agent agent-a",
    );
    expect(result.body).not.toContain("Method:");
    expect(result.body).not.toContain("Summary:");
  });

  it("keeps mixed-outcome verification sessions succeeded while preserving failed method rows", async () => {
    readFileMock.mockImplementation((path) => {
      const displayPath = normalizeReadFilePath(path);
      if (
        displayPath.endsWith(
          "/.voratiq/verify/sessions/verify-mixed/gpt-5-4/run-verification/artifacts/result.json",
        )
      ) {
        return Promise.resolve(
          JSON.stringify({
            method: "rubric",
            template: "run-verification",
            verifierId: "gpt-5-4",
            generatedAt: "2026-03-19T20:00:05.000Z",
            status: "succeeded",
            result: {
              preferred: "agent-a",
              ranking: ["agent-a", "agent-b"],
              rationale: "agent-a is strongest.",
            },
          }),
        );
      }
      throw new Error(`Unexpected read: ${displayPath}`);
    });

    executeVerifyCommandMock.mockResolvedValue({
      verificationId: "verify-mixed",
      record: {
        sessionId: "verify-mixed",
        createdAt: "2026-03-19T20:00:00.000Z",
        startedAt: "2026-03-19T20:00:01.000Z",
        completedAt: "2026-03-19T20:00:05.000Z",
        status: "succeeded",
        target: {
          kind: "run",
          sessionId: "run-123",
          candidateIds: ["agent-a", "agent-b"],
        },
        methods: [
          {
            method: "rubric",
            template: "run-verification",
            verifierId: "gpt-5-4",
            scope: { kind: "run" },
            status: "succeeded",
            artifactPath:
              ".voratiq/verify/sessions/verify-mixed/gpt-5-4/run-verification/artifacts/result.json",
            startedAt: "2026-03-19T20:00:01.000Z",
            completedAt: "2026-03-19T20:00:03.000Z",
          },
          {
            method: "rubric",
            template: "failure-modes",
            verifierId: "failure-modes",
            scope: { kind: "run" },
            status: "failed",
            artifactPath:
              ".voratiq/verify/sessions/verify-mixed/failure-modes/failure-modes/artifacts/result.json",
            startedAt: "2026-03-19T20:00:03.000Z",
            completedAt: "2026-03-19T20:00:05.000Z",
            error: "verifier violated output contract",
          },
        ],
      },
    });

    const result = await runVerifyCommand({
      target: { kind: "run", sessionId: "run-123" },
      stdout: { write: () => true, isTTY: false },
    } satisfies VerifyCommandOptions);

    expect(result.exitCode).toBe(0);
    expect(result.body).toContain("verify-mixed SUCCEEDED");
    expect(result.body).toContain("FAILED");
    expect(result.body).toContain("Error: verifier violated output contract");
  });

  it("suppresses the apply hint when mixed run verification is unresolved", async () => {
    readFileMock.mockImplementation((path) => {
      const displayPath = normalizeReadFilePath(path);
      if (
        displayPath.endsWith(
          "/.voratiq/verify/sessions/verify-unresolved/gpt-5-4/run-verification/artifacts/result.json",
        )
      ) {
        return Promise.resolve(
          JSON.stringify({
            method: "rubric",
            template: "run-verification",
            verifierId: "gpt-5-4",
            generatedAt: "2026-03-19T20:00:05.000Z",
            status: "succeeded",
            result: {
              preferred: "agent-a",
              ranking: ["agent-a", "agent-b"],
              rationale: "agent-a is strongest.",
            },
          }),
        );
      }
      if (
        displayPath.endsWith(
          "/.voratiq/verify/sessions/verify-unresolved/failure-modes/failure-modes/artifacts/result.json",
        )
      ) {
        return Promise.resolve(
          JSON.stringify({
            method: "rubric",
            template: "failure-modes",
            verifierId: "failure-modes",
            generatedAt: "2026-03-19T20:00:05.000Z",
            status: "failed",
            result: {
              preferred: "agent-b",
              ranking: ["agent-b", "agent-a"],
              rationale: "agent-b has a hidden failure mode.",
            },
            error: "verifier violated output contract",
          }),
        );
      }
      throw new Error(`Unexpected read: ${displayPath}`);
    });

    executeVerifyCommandMock.mockResolvedValue({
      verificationId: "verify-unresolved",
      record: {
        sessionId: "verify-unresolved",
        createdAt: "2026-03-19T20:00:00.000Z",
        startedAt: "2026-03-19T20:00:01.000Z",
        completedAt: "2026-03-19T20:00:05.000Z",
        status: "succeeded",
        target: {
          kind: "run",
          sessionId: "run-123",
          candidateIds: ["agent-a", "agent-b"],
        },
        methods: [
          {
            method: "rubric",
            template: "run-verification",
            verifierId: "gpt-5-4",
            scope: { kind: "run" },
            status: "succeeded",
            artifactPath:
              ".voratiq/verify/sessions/verify-unresolved/gpt-5-4/run-verification/artifacts/result.json",
            startedAt: "2026-03-19T20:00:01.000Z",
            completedAt: "2026-03-19T20:00:03.000Z",
          },
          {
            method: "rubric",
            template: "failure-modes",
            verifierId: "failure-modes",
            scope: { kind: "run" },
            status: "failed",
            artifactPath:
              ".voratiq/verify/sessions/verify-unresolved/failure-modes/failure-modes/artifacts/result.json",
            startedAt: "2026-03-19T20:00:03.000Z",
            completedAt: "2026-03-19T20:00:05.000Z",
            error: "verifier violated output contract",
          },
        ],
      },
    });

    const result = await runVerifyCommand({
      target: { kind: "run", sessionId: "run-123" },
      stdout: { write: () => true, isTTY: false },
    } satisfies VerifyCommandOptions);

    expect(result.exitCode).toBe(1);
    expect(result.status).toBe("unresolved");
    expect(result.body).toContain("verify-unresolved UNRESOLVED");
    expect(result.warningMessage).toContain(
      "Verification did not produce a resolvable candidate; manual review required.",
    );
    expect(result.body).toContain(
      "Verification did not produce a resolvable candidate; manual review required.",
    );
    expect(result.body).not.toContain("To apply a solution:");
  });

  it("surfaces selection warnings while keeping the apply hint for a resolved rubric winner", async () => {
    readFileMock.mockImplementation((path) => {
      const displayPath = normalizeReadFilePath(path);
      if (
        displayPath.endsWith(
          "/.voratiq/verify/sessions/verify-123/programmatic/artifacts/result.json",
        )
      ) {
        return Promise.resolve(
          JSON.stringify({
            method: "programmatic",
            generatedAt: "2026-03-19T20:00:03.000Z",
            target: {
              kind: "run",
              sessionId: "run-123",
              candidateIds: ["agent-a", "agent-b"],
            },
            scope: "run",
            candidates: [
              {
                candidateId: "agent-a",
                results: [{ slug: "format", status: "failed" }],
              },
              {
                candidateId: "agent-b",
                results: [{ slug: "format", status: "failed" }],
              },
            ],
          }),
        );
      }
      if (
        displayPath.endsWith(
          "/.voratiq/verify/sessions/verify-123/gpt-5-4/run-verification/artifacts/result.json",
        )
      ) {
        return Promise.resolve(
          JSON.stringify({
            method: "rubric",
            template: "run-verification",
            verifierId: "gpt-5-4",
            generatedAt: "2026-03-19T20:00:05.000Z",
            status: "succeeded",
            result: {
              preferred: "v_aaaaaaaaaa",
              ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
              rationale: "v_aaaaaaaaaa is the strongest candidate.",
              next_actions: [
                "voratiq apply --run run-123 --agent v_aaaaaaaaaa",
              ],
            },
          }),
        );
      }
      throw new Error(`Unexpected read: ${displayPath}`);
    });

    executeVerifyCommandMock.mockResolvedValue({
      verificationId: "verify-123",
      record: {
        sessionId: "verify-123",
        createdAt: "2026-03-19T20:00:00.000Z",
        startedAt: "2026-03-19T20:00:01.000Z",
        completedAt: "2026-03-19T20:00:05.000Z",
        status: "succeeded",
        target: {
          kind: "run",
          sessionId: "run-123",
          candidateIds: ["agent-a", "agent-b"],
        },
        blinded: {
          enabled: true,
          aliasMap: {
            v_aaaaaaaaaa: "agent-a",
            v_bbbbbbbbbb: "agent-b",
          },
        },
        methods: [
          {
            method: "programmatic",
            scope: { kind: "run" },
            status: "succeeded",
            artifactPath:
              ".voratiq/verify/sessions/verify-123/programmatic/artifacts/result.json",
            startedAt: "2026-03-19T20:00:01.000Z",
            completedAt: "2026-03-19T20:00:03.000Z",
          },
          {
            method: "rubric",
            template: "run-verification",
            verifierId: "gpt-5-4",
            scope: { kind: "run" },
            status: "succeeded",
            artifactPath:
              ".voratiq/verify/sessions/verify-123/gpt-5-4/run-verification/artifacts/result.json",
            startedAt: "2026-03-19T20:00:03.000Z",
            completedAt: "2026-03-19T20:00:05.000Z",
          },
        ],
      },
    });

    const result = await runVerifyCommand({
      target: { kind: "run", sessionId: "run-123" },
    } satisfies VerifyCommandOptions);

    expect(result.body).toContain(
      "Warning: No run candidate passed programmatic verification; proceeding with run-verification consensus.",
    );
    expect(result.body).toContain(
      "voratiq apply --run run-123 --agent agent-a",
    );
    expect(result.warningMessage).toContain(
      "Warning: No run candidate passed programmatic verification; proceeding with run-verification consensus.",
    );
  });

  it("does not render the apply hint when verification status is failed", async () => {
    readFileMock.mockImplementation((path) => {
      const displayPath = normalizeReadFilePath(path);
      if (
        displayPath.endsWith(
          "/.voratiq/verify/sessions/verify-123/gpt-5-4/run-verification/artifacts/result.json",
        )
      ) {
        return Promise.resolve(
          JSON.stringify({
            method: "rubric",
            template: "run-verification",
            verifierId: "gpt-5-4",
            generatedAt: "2026-03-19T20:00:05.000Z",
            status: "failed",
            result: {
              preferred: "v_aaaaaaaaaa",
              ranking: ["v_aaaaaaaaaa", "v_bbbbbbbbbb"],
              rationale: "v_aaaaaaaaaa is the strongest candidate.",
              next_actions: [
                "voratiq apply --run run-123 --agent v_aaaaaaaaaa",
              ],
            },
          }),
        );
      }
      throw new Error(`Unexpected read: ${displayPath}`);
    });

    executeVerifyCommandMock.mockResolvedValue({
      verificationId: "verify-123",
      record: {
        sessionId: "verify-123",
        createdAt: "2026-03-19T20:00:00.000Z",
        startedAt: "2026-03-19T20:00:01.000Z",
        completedAt: "2026-03-19T20:00:05.000Z",
        status: "failed",
        target: {
          kind: "run",
          sessionId: "run-123",
          candidateIds: ["agent-a", "agent-b"],
        },
        blinded: {
          enabled: true,
          aliasMap: {
            v_aaaaaaaaaa: "agent-a",
            v_bbbbbbbbbb: "agent-b",
          },
        },
        methods: [
          {
            method: "rubric",
            template: "run-verification",
            verifierId: "gpt-5-4",
            scope: { kind: "run" },
            status: "failed",
            artifactPath:
              ".voratiq/verify/sessions/verify-123/gpt-5-4/run-verification/artifacts/result.json",
            startedAt: "2026-03-19T20:00:03.000Z",
            completedAt: "2026-03-19T20:00:05.000Z",
          },
          {
            method: "rubric",
            template: "failure-modes",
            verifierId: "failure-modes",
            scope: { kind: "run" },
            status: "failed",
            artifactPath:
              ".voratiq/verify/sessions/verify-123/failure-modes/failure-modes/artifacts/result.json",
            startedAt: "2026-03-19T20:00:03.000Z",
            completedAt: "2026-03-19T20:00:05.000Z",
            error: "advisory verifier failed",
          },
        ],
      },
    });

    const result = await runVerifyCommand({
      target: { kind: "run", sessionId: "run-123" },
    } satisfies VerifyCommandOptions);

    expect(result.exitCode).toBe(1);
    expect(result.body).not.toContain("To apply a solution:");
  });

  it("colors programmatic check slugs per status in TTY transcripts without recoloring the verifier label", async () => {
    readFileMock.mockImplementation((path) => {
      const displayPath = normalizeReadFilePath(path);
      if (
        displayPath.endsWith(
          "/.voratiq/verify/sessions/verify-123/programmatic/artifacts/result.json",
        )
      ) {
        return Promise.resolve(
          JSON.stringify({
            method: "programmatic",
            generatedAt: "2026-03-19T20:00:03.000Z",
            target: {
              kind: "run",
              sessionId: "run-123",
              candidateIds: ["agent-a"],
            },
            scope: "run",
            candidates: [
              {
                candidateId: "agent-a",
                results: [
                  { slug: "format", status: "succeeded" },
                  { slug: "tests", status: "failed" },
                ],
              },
            ],
          }),
        );
      }
      throw new Error(`Unexpected read: ${displayPath}`);
    });

    executeVerifyCommandMock.mockResolvedValue({
      verificationId: "verify-123",
      record: {
        sessionId: "verify-123",
        createdAt: "2026-03-19T20:00:00.000Z",
        startedAt: "2026-03-19T20:00:01.000Z",
        completedAt: "2026-03-19T20:00:05.000Z",
        status: "succeeded",
        target: {
          kind: "run",
          sessionId: "run-123",
          candidateIds: ["agent-a"],
        },
        methods: [
          {
            method: "programmatic",
            scope: { kind: "run" },
            status: "succeeded",
            artifactPath:
              ".voratiq/verify/sessions/verify-123/programmatic/artifacts/result.json",
            startedAt: "2026-03-19T20:00:01.000Z",
            completedAt: "2026-03-19T20:00:03.000Z",
          },
        ],
      },
    });

    const result = await runVerifyCommand({
      target: { kind: "run", sessionId: "run-123" },
      stdout: { write: () => true, isTTY: true },
    } satisfies VerifyCommandOptions);

    expect(result.body).toContain("AGENT");
    expect(result.body).toContain("CHECKS");
    expect(result.body).toContain(
      `${colorize("format", "green")} ${colorize("tests", "red")}`,
    );
    expect(result.body).not.toContain(colorize("programmatic", "green"));
  });

  it("does not surface unknown blinded aliases as canonical ids in transcripts or apply hints", async () => {
    readFileMock.mockImplementation((path) => {
      const displayPath = normalizeReadFilePath(path);
      if (
        displayPath.endsWith(
          "/.voratiq/verify/sessions/verify-123/programmatic/artifacts/result.json",
        )
      ) {
        return Promise.resolve(
          JSON.stringify({
            method: "programmatic",
            generatedAt: "2026-03-19T20:00:03.000Z",
            target: {
              kind: "run",
              sessionId: "run-123",
              candidateIds: ["agent-a", "agent-b"],
            },
            scope: "run",
            candidates: [
              {
                candidateId: "agent-a",
                results: [{ slug: "format", status: "succeeded" }],
              },
              {
                candidateId: "agent-b",
                results: [{ slug: "format", status: "failed" }],
              },
            ],
          }),
        );
      }
      if (
        displayPath.endsWith(
          "/.voratiq/verify/sessions/verify-123/gpt-5-4/run-verification/artifacts/result.json",
        )
      ) {
        return Promise.resolve(
          JSON.stringify({
            method: "rubric",
            template: "run-verification",
            verifierId: "gpt-5-4",
            generatedAt: "2026-03-19T20:00:05.000Z",
            status: "succeeded",
            result: {
              preferred: "v_zzzzzzzzzz",
              ranking: ["v_zzzzzzzzzz", "v_aaaaaaaaaa"],
              rationale: "v_zzzzzzzzzz looked strongest at first glance.",
            },
          }),
        );
      }
      throw new Error(`Unexpected read: ${displayPath}`);
    });

    executeVerifyCommandMock.mockResolvedValue({
      verificationId: "verify-123",
      record: {
        sessionId: "verify-123",
        createdAt: "2026-03-19T20:00:00.000Z",
        startedAt: "2026-03-19T20:00:01.000Z",
        completedAt: "2026-03-19T20:00:05.000Z",
        status: "succeeded",
        target: {
          kind: "run",
          sessionId: "run-123",
          candidateIds: ["agent-a", "agent-b"],
        },
        blinded: {
          enabled: true,
          aliasMap: {
            v_aaaaaaaaaa: "agent-a",
            v_bbbbbbbbbb: "agent-b",
          },
        },
        methods: [
          {
            method: "programmatic",
            scope: { kind: "run" },
            status: "succeeded",
            artifactPath:
              ".voratiq/verify/sessions/verify-123/programmatic/artifacts/result.json",
            startedAt: "2026-03-19T20:00:01.000Z",
            completedAt: "2026-03-19T20:00:03.000Z",
          },
          {
            method: "rubric",
            template: "run-verification",
            verifierId: "gpt-5-4",
            scope: { kind: "run" },
            status: "succeeded",
            artifactPath:
              ".voratiq/verify/sessions/verify-123/gpt-5-4/run-verification/artifacts/result.json",
            startedAt: "2026-03-19T20:00:03.000Z",
            completedAt: "2026-03-19T20:00:05.000Z",
          },
        ],
      },
    });

    const result = await runVerifyCommand({
      target: { kind: "run", sessionId: "run-123" },
      stdout: { write: () => true, isTTY: false },
    } satisfies VerifyCommandOptions);

    expect(result.body).toContain("```markdown");
    expect(result.body).toContain("[unknown blinded alias: v_zzzzzzzzzz]");
    expect(result.body).toContain(
      "**Preferred**: [unknown blinded alias: v_zzzzzzzzzz]",
    );
    expect(result.body).toContain(
      "**Rationale**: [unknown blinded alias: v_zzzzzzzzzz] looked strongest at first glance.",
    );
    expect(result.body).toContain(
      "Warning: failed to load verification selection policy output; apply hint unavailable.",
    );
    expect(result.body).toContain(
      "Verification artifact `.voratiq/verify/sessions/verify-123/gpt-5-4/run-verification/artifacts/result.json` contains unknown blinded selector(s): `v_zzzzzzzzzz`",
    );
    expect(result.body).not.toContain("To apply a solution:");
    expect(result.body).not.toContain(
      "voratiq apply --run run-123 --agent v_zzzzzzzzzz",
    );
  });

  it("surfaces selection-policy load failures as a warning instead of silently degrading", async () => {
    readFileMock.mockImplementation((path) => {
      const displayPath = normalizeReadFilePath(path);
      if (
        displayPath.endsWith(
          "/.voratiq/verify/sessions/verify-123/programmatic/artifacts/result.json",
        )
      ) {
        return Promise.resolve(
          JSON.stringify({
            method: "programmatic",
            generatedAt: "2026-03-19T20:00:03.000Z",
            target: {
              kind: "run",
              sessionId: "run-other",
              candidateIds: ["agent-a"],
            },
            scope: "run",
            candidates: [
              {
                candidateId: "agent-a",
                results: [{ slug: "format", status: "succeeded" }],
              },
            ],
          }),
        );
      }
      throw new Error(`Unexpected read: ${displayPath}`);
    });

    executeVerifyCommandMock.mockResolvedValue({
      verificationId: "verify-123",
      record: {
        sessionId: "verify-123",
        createdAt: "2026-03-19T20:00:00.000Z",
        startedAt: "2026-03-19T20:00:01.000Z",
        completedAt: "2026-03-19T20:00:05.000Z",
        status: "succeeded",
        target: {
          kind: "run",
          sessionId: "run-123",
          candidateIds: ["agent-a"],
        },
        methods: [
          {
            method: "programmatic",
            scope: { kind: "run" },
            status: "succeeded",
            artifactPath:
              ".voratiq/verify/sessions/verify-123/programmatic/artifacts/result.json",
            startedAt: "2026-03-19T20:00:01.000Z",
            completedAt: "2026-03-19T20:00:03.000Z",
          },
        ],
      },
    });

    const result = await runVerifyCommand({
      target: { kind: "run", sessionId: "run-123" },
      stdout: { write: () => true, isTTY: false },
    } satisfies VerifyCommandOptions);

    expect(result.exitCode).toBe(0);
    expect(result.body).toContain(
      "Warning: failed to load verification selection policy output; apply hint unavailable.",
    );
    expect(result.body).toContain(
      "Verification artifact `.voratiq/verify/sessions/verify-123/programmatic/artifacts/result.json` target mismatch",
    );
    expect(result.body).not.toContain("To apply a solution:");
  });

  it("does not render an empty programmatic block when no programmatic method was recorded", async () => {
    readFileMock.mockImplementation((path) => {
      const displayPath = normalizeReadFilePath(path);
      if (
        displayPath.endsWith(
          "/.voratiq/verify/sessions/verify-123/gpt-5-4/spec-verification/artifacts/result.json",
        )
      ) {
        return Promise.resolve(
          JSON.stringify({
            method: "rubric",
            template: "spec-verification",
            verifierId: "gpt-5-4",
            generatedAt: "2026-03-19T20:00:05.000Z",
            status: "succeeded",
            result: {
              comparison: "Spec draft evidence was sufficient.",
            },
          }),
        );
      }
      throw new Error(`Unexpected read: ${displayPath}`);
    });

    executeVerifyCommandMock.mockResolvedValue({
      verificationId: "verify-123",
      record: {
        sessionId: "verify-123",
        createdAt: "2026-03-19T20:00:00.000Z",
        startedAt: "2026-03-19T20:00:01.000Z",
        completedAt: "2026-03-19T20:00:05.000Z",
        status: "succeeded",
        target: {
          kind: "spec",
          sessionId: "spec-123",
        },
        methods: [
          {
            method: "rubric",
            template: "spec-verification",
            verifierId: "gpt-5-4",
            scope: { kind: "target" },
            status: "succeeded",
            artifactPath:
              ".voratiq/verify/sessions/verify-123/gpt-5-4/spec-verification/artifacts/result.json",
            startedAt: "2026-03-19T20:00:03.000Z",
            completedAt: "2026-03-19T20:00:05.000Z",
          },
        ],
      },
    });

    const result = await runVerifyCommand({
      target: { kind: "spec", sessionId: "spec-123" },
      stdout: { write: () => true, isTTY: false },
    } satisfies VerifyCommandOptions);

    expect(result.body).toContain("Spec draft evidence was sufficient.");
    expect(result.body).not.toContain("Results: 0");
    expect(result.body).not.toContain("programmatic/artifacts/result.json");
  });

  it("returns non-success for spec verification without a selected spec path", async () => {
    readFileMock.mockImplementation((path) => {
      const displayPath = normalizeReadFilePath(path);
      if (
        displayPath.endsWith(
          "/.voratiq/verify/sessions/verify-spec-unresolved/gpt-5-4/spec-verification/artifacts/result.json",
        )
      ) {
        return Promise.resolve(
          JSON.stringify({
            method: "rubric",
            template: "spec-verification",
            verifierId: "gpt-5-4",
            generatedAt: "2026-03-19T20:00:05.000Z",
            status: "succeeded",
            result: {
              preferred: "draft-a",
              ranking: ["draft-a", "draft-b"],
              rationale: "draft-a is strongest.",
            },
          }),
        );
      }
      if (
        displayPath.endsWith(
          "/.voratiq/verify/sessions/verify-spec-unresolved/failure-modes/failure-modes/artifacts/result.json",
        )
      ) {
        return Promise.resolve(
          JSON.stringify({
            method: "rubric",
            template: "failure-modes",
            verifierId: "failure-modes",
            generatedAt: "2026-03-19T20:00:05.000Z",
            status: "failed",
            result: {
              preferred: "draft-b",
              ranking: ["draft-b", "draft-a"],
              rationale: "draft-a carries a defect.",
            },
            error: "verifier violated output contract",
          }),
        );
      }
      throw new Error(`Unexpected read: ${displayPath}`);
    });

    executeVerifyCommandMock.mockResolvedValue({
      verificationId: "verify-spec-unresolved",
      record: {
        sessionId: "verify-spec-unresolved",
        createdAt: "2026-03-19T20:00:00.000Z",
        startedAt: "2026-03-19T20:00:01.000Z",
        completedAt: "2026-03-19T20:00:05.000Z",
        status: "succeeded",
        target: {
          kind: "spec",
          sessionId: "spec-123",
        },
        methods: [
          {
            method: "rubric",
            template: "spec-verification",
            verifierId: "gpt-5-4",
            scope: { kind: "target" },
            status: "succeeded",
            artifactPath:
              ".voratiq/verify/sessions/verify-spec-unresolved/gpt-5-4/spec-verification/artifacts/result.json",
            startedAt: "2026-03-19T20:00:01.000Z",
            completedAt: "2026-03-19T20:00:03.000Z",
          },
          {
            method: "rubric",
            template: "failure-modes",
            verifierId: "failure-modes",
            scope: { kind: "target" },
            status: "failed",
            artifactPath:
              ".voratiq/verify/sessions/verify-spec-unresolved/failure-modes/failure-modes/artifacts/result.json",
            startedAt: "2026-03-19T20:00:03.000Z",
            completedAt: "2026-03-19T20:00:05.000Z",
            error: "verifier violated output contract",
          },
        ],
      },
    });

    const result = await runVerifyCommand({
      target: { kind: "spec", sessionId: "spec-123" },
      stdout: { write: () => true, isTTY: false },
    } satisfies VerifyCommandOptions);

    expect(result.exitCode).toBe(1);
    expect(result.status).toBe("unresolved");
    expect(result.selectedSpecPath).toBeUndefined();
    expect(result.warningMessage).toContain(
      "Verification did not produce a resolvable candidate; manual review required.",
    );
    expect(result.body).toContain(
      "Verification did not produce a resolvable candidate; manual review required.",
    );
    expect(result.body).toContain("verify-spec-unresolved UNRESOLVED");
  });
});

function normalizeReadFilePath(path: Parameters<typeof readFile>[0]): string {
  if (typeof path === "string") {
    return path;
  }
  if (path instanceof URL) {
    return path.pathname;
  }
  if (path instanceof Uint8Array) {
    return new TextDecoder().decode(path);
  }
  return "<unknown>";
}
