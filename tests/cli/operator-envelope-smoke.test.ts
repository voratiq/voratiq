import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("../../src/utils/version.js", () => ({
  getVoratiqVersion: jest.fn(() => "0.1.0-test"),
}));

jest.mock("../../src/update-check/checker.js", () => ({
  startUpdateCheck: jest.fn(() => ({
    peekNotice: () => undefined,
    finish: jest.fn(),
  })),
}));

jest.mock("../../src/update-check/state-path.js", () => ({
  resolveUpdateStatePath: jest.fn(() => "/tmp/voratiq-update-state.json"),
}));

jest.mock("../../src/agents/runtime/sandbox.js", () => ({
  checkPlatformSupport: jest.fn(),
}));

jest.mock("../../src/competition/shared/extra-context.js", () => ({
  resolveExtraContextFiles: jest.fn(),
}));

jest.mock("../../src/preflight/index.js", () => ({
  ensureCleanWorkingTree: jest.fn(),
  ensureSandboxDependencies: jest.fn(),
  ensureSpecPath: jest.fn(),
  resolveCliContext: jest.fn(),
}));

jest.mock("../../src/commands/spec/command.js", () => ({
  executeSpecCommand: jest.fn(),
}));

jest.mock("../../src/domain/spec/model/output.js", () => ({
  readSpecData: jest.fn(),
}));

jest.mock("../../src/commands/run/command.js", () => ({
  executeRunCommand: jest.fn(),
}));

jest.mock("../../src/commands/verify/command.js", () => ({
  executeVerifyCommand: jest.fn(),
}));

jest.mock("../../src/policy/index.js", () => ({
  loadVerificationSelectionPolicyOutput: jest.fn(),
}));

import { checkPlatformSupport } from "../../src/agents/runtime/sandbox.js";
import { runCli } from "../../src/bin.js";
import { executeRunCommand } from "../../src/commands/run/command.js";
import { executeSpecCommand } from "../../src/commands/spec/command.js";
import { executeVerifyCommand } from "../../src/commands/verify/command.js";
import { resolveExtraContextFiles } from "../../src/competition/shared/extra-context.js";
import { readSpecData } from "../../src/domain/spec/model/output.js";
import { loadVerificationSelectionPolicyOutput } from "../../src/policy/index.js";
import {
  ensureCleanWorkingTree,
  ensureSandboxDependencies,
  ensureSpecPath,
  resolveCliContext,
} from "../../src/preflight/index.js";

interface CapturedCliResult {
  stdout: string;
  stderr: string;
  exitCode: number | string | undefined;
}

interface CapturedEnvelope {
  version: 1;
  operator: "spec" | "run" | "verify";
  status: "succeeded" | "failed" | "unresolved";
  timestamp: string;
  ids?: {
    sessionId?: string;
    runId?: string;
    verificationId?: string;
  };
  artifacts: Array<{
    kind: string;
    path: string;
    role?: string;
    agentId?: string;
  }>;
}

const checkPlatformSupportMock = jest.mocked(checkPlatformSupport);
const resolveExtraContextFilesMock = jest.mocked(resolveExtraContextFiles);
const resolveCliContextMock = jest.mocked(resolveCliContext);
const ensureSandboxDependenciesMock = jest.mocked(ensureSandboxDependencies);
const ensureCleanWorkingTreeMock = jest.mocked(ensureCleanWorkingTree);
const ensureSpecPathMock = jest.mocked(ensureSpecPath);
const executeSpecCommandMock = jest.mocked(executeSpecCommand);
const readSpecDataMock = jest.mocked(readSpecData);
const executeRunCommandMock = jest.mocked(executeRunCommand);
const executeVerifyCommandMock = jest.mocked(executeVerifyCommand);
const loadVerificationSelectionPolicyOutputMock = jest.mocked(
  loadVerificationSelectionPolicyOutput,
);

describe("operator envelope json smoke chain", () => {
  let originalExitCode: number | string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    checkPlatformSupportMock.mockImplementation(() => {});
    ensureSandboxDependenciesMock.mockImplementation(() => {});
    ensureCleanWorkingTreeMock.mockResolvedValue({
      cleanWorkingTree: true,
    });
    resolveExtraContextFilesMock.mockResolvedValue([]);
    resolveCliContextMock.mockResolvedValue({
      root: "/repo",
      workspaceAutoInitialized: false,
      workspacePaths: {
        root: "/repo",
        workspaceDir: "/repo/.voratiq",
        specsDir: "/repo/.voratiq/spec",
        specsFile: "/repo/.voratiq/spec/index.json",
        runsDir: "/repo/.voratiq/run",
        runsFile: "/repo/.voratiq/run/index.json",
        reductionsDir: "/repo/.voratiq/reduce",
        reductionsFile: "/repo/.voratiq/reduce/index.json",
        verificationsDir: "/repo/.voratiq/verify",
        verificationsFile: "/repo/.voratiq/verify/index.json",
      },
    });
    readSpecDataMock.mockResolvedValue({
      title: "Task",
      objective: "Complete the task.",
      scope: ["Implement the task."],
      acceptanceCriteria: ["Task works."],
      constraints: ["Keep it deterministic."],
      exitSignal: "Ready for run.",
    });
    loadVerificationSelectionPolicyOutputMock.mockResolvedValue({
      input: {} as never,
      decision: {
        state: "resolvable",
        applyable: true,
        selectedCanonicalAgentId: "agent-a",
        unresolvedReasons: [],
      },
    });
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("chains spec -> run -> verify using only parsed envelope fields", async () => {
    const specArtifactPath = ".voratiq/spec/sessions/spec-123/agent-a/spec.md";

    executeSpecCommandMock.mockResolvedValue({
      sessionId: "spec-123",
      status: "succeeded",
      record: {
        sessionId: "spec-123",
        createdAt: "2026-03-27T12:00:00.000Z",
        startedAt: "2026-03-27T12:00:00.000Z",
        completedAt: "2026-03-27T12:00:05.000Z",
        status: "succeeded",
        description: "Build task",
        agents: [
          {
            agentId: "agent-a",
            status: "succeeded",
            startedAt: "2026-03-27T12:00:00.000Z",
            completedAt: "2026-03-27T12:00:05.000Z",
            outputPath: specArtifactPath,
            dataPath: ".voratiq/spec/sessions/spec-123/agent-a/spec.json",
          },
        ],
      },
      agents: [
        {
          agentId: "agent-a",
          status: "succeeded",
          startedAt: "2026-03-27T12:00:00.000Z",
          completedAt: "2026-03-27T12:00:05.000Z",
          outputPath: specArtifactPath,
          dataPath: ".voratiq/spec/sessions/spec-123/agent-a/spec.json",
        },
      ],
    });

    ensureSpecPathMock.mockResolvedValue({
      absolutePath: "/repo/.voratiq/spec/sessions/spec-123/agent-a/spec.md",
      displayPath: specArtifactPath,
    });

    executeRunCommandMock.mockImplementation((input) =>
      Promise.resolve({
        runId: "run-456",
        spec: { path: input.specDisplayPath },
        status: "succeeded",
        createdAt: "2026-03-27T12:01:00.000Z",
        startedAt: "2026-03-27T12:01:00.000Z",
        completedAt: "2026-03-27T12:02:00.000Z",
        baseRevisionSha: "abc123",
        agents: [],
        hadAgentFailure: false,
      }),
    );

    executeVerifyCommandMock.mockImplementation((input) =>
      Promise.resolve({
        verificationId: "verify-789",
        record: {
          sessionId: "verify-789",
          createdAt: "2026-03-27T12:03:00.000Z",
          startedAt: "2026-03-27T12:03:00.000Z",
          completedAt: "2026-03-27T12:04:00.000Z",
          status: "succeeded",
          target: {
            kind: input.target.kind,
            sessionId: input.target.sessionId,
            candidateIds: ["agent-a"],
          },
          methods: [],
        },
      }),
    );

    const specResult = await invokeCli([
      "spec",
      "--description",
      "Build task",
      "--json",
    ]);
    const specEnvelope = parseEnvelope(specResult, "spec");
    const specArtifact = findArtifact(specEnvelope, {
      kind: "spec",
      role: "candidate",
    });

    expect(specEnvelope.status).toBe("succeeded");
    expect(specEnvelope.ids?.sessionId).toBe("spec-123");
    expect(specArtifact?.path).toBe(specArtifactPath);

    const runResult = await invokeCli([
      "run",
      "--spec",
      specArtifact?.path ?? "",
      "--json",
    ]);
    const runEnvelope = parseEnvelope(runResult, "run");
    const runSpecArtifact = findArtifact(runEnvelope, {
      kind: "spec",
      role: "input",
    });

    expect(ensureSpecPathMock).toHaveBeenLastCalledWith(
      specArtifactPath,
      "/repo",
    );
    expect(runEnvelope.status).toBe("succeeded");
    expect(runEnvelope.ids?.runId).toBe("run-456");
    expect(runSpecArtifact?.path).toBe(specArtifact?.path);

    const verifyResult = await invokeCli([
      "verify",
      "--run",
      runEnvelope.ids?.runId ?? "",
      "--json",
    ]);
    const verifyEnvelope = parseEnvelope(verifyResult, "verify");
    const verifySessionArtifact = findArtifact(verifyEnvelope, {
      kind: "session",
      role: "session",
    });

    expect(executeVerifyCommandMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: {
          kind: "run",
          sessionId: runEnvelope.ids?.runId,
        },
      }),
    );
    expect(verifyEnvelope.status).toBe("succeeded");
    expect(verifyEnvelope.ids?.sessionId).toBe("verify-789");
    expect(verifyEnvelope.ids?.runId).toBe(runEnvelope.ids?.runId);
    expect(verifySessionArtifact?.path).toBe(
      ".voratiq/verify/sessions/verify-789",
    );
  });
});

async function invokeCli(args: readonly string[]): Promise<CapturedCliResult> {
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

  process.exitCode = undefined;

  try {
    await runCli(["node", "voratiq", ...args]);
    return {
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      exitCode: process.exitCode,
    };
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

function parseEnvelope(
  result: CapturedCliResult,
  operator: CapturedEnvelope["operator"],
): CapturedEnvelope {
  expect(result.stderr).toBe("");
  expect([undefined, 0]).toContain(result.exitCode);

  const parsed = JSON.parse(result.stdout.trim()) as CapturedEnvelope;
  expect(parsed.version).toBe(1);
  expect(parsed.operator).toBe(operator);
  return parsed;
}

function findArtifact(
  envelope: CapturedEnvelope,
  options: { kind: string; role?: string },
) {
  const { kind, role } = options;
  return envelope.artifacts.find(
    (artifact) =>
      artifact.kind === kind && (role === undefined || artifact.role === role),
  );
}
