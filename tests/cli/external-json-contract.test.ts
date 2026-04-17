import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { checkPlatformSupport } from "../../src/agents/runtime/sandbox.js";
import { createConfirmationWorkflow } from "../../src/cli/confirmation.js";
import { executeApplyCommand } from "../../src/commands/apply/command.js";
import { ApplyBaseMismatchError } from "../../src/commands/apply/errors.js";
import { executeListCommand } from "../../src/commands/list/command.js";
import { executeMessageCommand } from "../../src/commands/message/command.js";
import { executePruneAllCommand } from "../../src/commands/prune/command.js";
import { executeReduceCommand } from "../../src/commands/reduce/command.js";
import { executeRunCommand } from "../../src/commands/run/command.js";
import { executeSpecCommand } from "../../src/commands/spec/command.js";
import { executeVerifyCommand } from "../../src/commands/verify/command.js";
import { resolveExtraContextFiles } from "../../src/competition/shared/extra-context.js";
import { readReductionRecords } from "../../src/domain/reduce/persistence/adapter.js";
import { readSpecData } from "../../src/domain/spec/model/output.js";
import { loadVerificationSelectionPolicyOutput } from "../../src/policy/index.js";
import { DirtyWorkingTreeError } from "../../src/preflight/errors.js";
import {
  ensureCleanWorkingTree,
  ensureSandboxDependencies,
  ensureSpecPath,
  resolveCliContext,
} from "../../src/preflight/index.js";

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

jest.mock("../../src/commands/reduce/command.js", () => ({
  executeReduceCommand: jest.fn(),
}));

jest.mock("../../src/domain/reduce/persistence/adapter.js", () => ({
  readReductionRecords: jest.fn(),
}));

jest.mock("../../src/commands/verify/command.js", () => ({
  executeVerifyCommand: jest.fn(),
}));

jest.mock("../../src/policy/index.js", () => ({
  loadVerificationSelectionPolicyOutput: jest.fn(),
}));

jest.mock("../../src/commands/apply/command.js", () => ({
  executeApplyCommand: jest.fn(),
}));

jest.mock("../../src/commands/prune/command.js", () => ({
  executePruneAllCommand: jest.fn(),
  executePruneCommand: jest.fn(),
}));

jest.mock("../../src/cli/confirmation.js", () => ({
  createConfirmationWorkflow: jest.fn(),
}));

jest.mock("../../src/commands/list/command.js", () => ({
  executeListCommand: jest.fn(),
}));

jest.mock("../../src/commands/message/command.js", () => ({
  executeMessageCommand: jest.fn(),
}));

const checkPlatformSupportMock = jest.mocked(checkPlatformSupport);
const resolveExtraContextFilesMock = jest.mocked(resolveExtraContextFiles);
const resolveCliContextMock = jest.mocked(resolveCliContext);
const ensureSandboxDependenciesMock = jest.mocked(ensureSandboxDependencies);
const ensureCleanWorkingTreeMock = jest.mocked(ensureCleanWorkingTree);
const ensureSpecPathMock = jest.mocked(ensureSpecPath);
const executeSpecCommandMock = jest.mocked(executeSpecCommand);
const readSpecDataMock = jest.mocked(readSpecData);
const executeRunCommandMock = jest.mocked(executeRunCommand);
const executeReduceCommandMock = jest.mocked(executeReduceCommand);
const readReductionRecordsMock = jest.mocked(readReductionRecords);
const executeVerifyCommandMock = jest.mocked(executeVerifyCommand);
const loadVerificationSelectionPolicyOutputMock = jest.mocked(
  loadVerificationSelectionPolicyOutput,
);
const executeApplyCommandMock = jest.mocked(executeApplyCommand);
const executePruneAllCommandMock = jest.mocked(executePruneAllCommand);
const createConfirmationWorkflowMock = jest.mocked(createConfirmationWorkflow);
const executeListCommandMock = jest.mocked(executeListCommand);
const executeMessageCommandMock = jest.mocked(executeMessageCommand);

interface CapturedCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface JsonEnvelope {
  version: 1;
  operator: string;
  status: string;
  timestamp: string;
  ids?: Record<string, string | undefined>;
  artifacts: Array<{
    kind: string;
    path: string;
    role?: string;
    agentId?: string;
  }>;
  selection?: Record<string, string | undefined>;
  unresolvedReasons?: Array<{ code: string }>;
  alerts?: Array<{ level: string; message: string }>;
  error?: { code: string; message: string };
}

let runCli!: (argv?: readonly string[]) => Promise<void>;

beforeAll(async () => {
  ({ runCli } = await import("../../src/bin.js"));
});

describe("external CLI JSON contract", () => {
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
    ensureSpecPathMock.mockResolvedValue({
      absolutePath: "/repo/specs/task.md",
      displayPath: "specs/task.md",
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
      objective: "Build the task.",
      scope: ["Implement the task."],
      acceptanceCriteria: ["The task works."],
      constraints: ["Keep JSON stable."],
      exitSignal: "Ready for execution.",
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
    createConfirmationWorkflowMock.mockReturnValue({
      interactive: true,
      confirm: jest.fn(() => Promise.resolve(true)) as unknown as (
        options: unknown,
      ) => Promise<boolean>,
      prompt: jest.fn(() => Promise.resolve("")) as unknown as (
        options: unknown,
      ) => Promise<string>,
      close: jest.fn(),
    });
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it.each([
    {
      operator: "spec",
      argv: ["spec", "--description", "Build task", "--json"],
      setup: () => {
        executeSpecCommandMock.mockResolvedValue({
          sessionId: "spec-123",
          status: "succeeded",
          record: {
            sessionId: "spec-123",
            createdAt: "2026-03-31T10:00:00.000Z",
            startedAt: "2026-03-31T10:00:00.000Z",
            completedAt: "2026-03-31T10:00:05.000Z",
            status: "succeeded",
            description: "Build task",
            agents: [
              {
                agentId: "agent-a",
                status: "succeeded",
                startedAt: "2026-03-31T10:00:00.000Z",
                completedAt: "2026-03-31T10:00:05.000Z",
                outputPath:
                  ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.md",
                dataPath:
                  ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.json",
              },
            ],
          },
          agents: [
            {
              agentId: "agent-a",
              status: "succeeded",
              startedAt: "2026-03-31T10:00:00.000Z",
              completedAt: "2026-03-31T10:00:05.000Z",
              outputPath:
                ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.md",
              dataPath:
                ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.json",
            },
          ],
        });
      },
      expected: {
        version: 1,
        operator: "spec",
        status: "succeeded",
        ids: {
          sessionId: "spec-123",
        },
        artifacts: [
          {
            kind: "session",
            role: "session",
            path: ".voratiq/spec/sessions/spec-123",
          },
          {
            kind: "spec",
            role: "candidate",
            agentId: "agent-a",
            path: ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.md",
          },
        ],
      },
    },
    {
      operator: "run",
      argv: ["run", "--spec", "specs/task.md", "--json"],
      setup: () => {
        executeRunCommandMock.mockResolvedValue({
          runId: "run-123",
          spec: { path: "specs/task.md" },
          status: "succeeded",
          createdAt: "2026-03-31T10:01:00.000Z",
          startedAt: "2026-03-31T10:01:00.000Z",
          completedAt: "2026-03-31T10:02:00.000Z",
          baseRevisionSha: "abc123",
          agents: [],
          hadAgentFailure: false,
        });
      },
      expected: {
        version: 1,
        operator: "run",
        status: "succeeded",
        ids: {
          runId: "run-123",
        },
        artifacts: [
          {
            kind: "session",
            role: "session",
            path: ".voratiq/run/sessions/run-123",
          },
          {
            kind: "spec",
            role: "input",
            path: "specs/task.md",
          },
        ],
      },
    },
    {
      operator: "message",
      argv: ["message", "--prompt", "Review task", "--json"],
      setup: () => {
        executeMessageCommandMock.mockResolvedValue({
          messageId: "message-123",
          record: {
            sessionId: "message-123",
            createdAt: "2026-03-31T10:02:00.000Z",
            startedAt: "2026-03-31T10:02:00.000Z",
            completedAt: "2026-03-31T10:02:30.000Z",
            status: "succeeded",
            prompt: "Review task",
            recipients: [
              {
                agentId: "agent-a",
                status: "failed",
                startedAt: "2026-03-31T10:02:05.000Z",
                completedAt: "2026-03-31T10:02:30.000Z",
                error: "boom",
              },
            ],
          },
          recipients: [
            {
              agentId: "agent-a",
              status: "failed",
              startedAt: "2026-03-31T10:02:05.000Z",
              completedAt: "2026-03-31T10:02:30.000Z",
              error: "boom",
            },
          ],
          executions: [],
        });
      },
      expected: {
        version: 1,
        operator: "message",
        status: "succeeded",
        ids: {
          sessionId: "message-123",
        },
        artifacts: [
          {
            kind: "session",
            role: "session",
            path: ".voratiq/message/sessions/message-123",
          },
        ],
      },
    },
    {
      operator: "reduce",
      argv: ["reduce", "--run", "run-123", "--json"],
      setup: () => {
        executeReduceCommandMock.mockResolvedValue({
          reductionId: "reduce-123",
          target: {
            type: "run",
            id: "run-123",
          },
          reducerAgentIds: ["agent-r"],
          reductions: [],
        });
        readReductionRecordsMock.mockResolvedValue([
          {
            sessionId: "reduce-123",
            createdAt: "2026-03-31T10:03:00.000Z",
            startedAt: "2026-03-31T10:03:00.000Z",
            completedAt: "2026-03-31T10:04:00.000Z",
            status: "succeeded",
            target: {
              type: "run",
              id: "run-123",
            },
            reducers: [],
          },
        ]);
      },
      expected: {
        version: 1,
        operator: "reduce",
        status: "succeeded",
        ids: {
          sessionId: "reduce-123",
          runId: "run-123",
        },
        artifacts: [
          {
            kind: "session",
            role: "session",
            path: ".voratiq/reduce/sessions/reduce-123",
          },
          {
            kind: "run",
            role: "input",
            path: ".voratiq/run/sessions/run-123",
          },
        ],
      },
    },
    {
      operator: "reduce",
      argv: ["reduce", "--message", "message-123", "--json"],
      setup: () => {
        executeReduceCommandMock.mockResolvedValue({
          reductionId: "reduce-message-123",
          target: {
            type: "message",
            id: "message-123",
          },
          reducerAgentIds: ["agent-r"],
          reductions: [],
        });
        readReductionRecordsMock.mockResolvedValue([
          {
            sessionId: "reduce-message-123",
            createdAt: "2026-03-31T10:03:00.000Z",
            startedAt: "2026-03-31T10:03:00.000Z",
            completedAt: "2026-03-31T10:04:00.000Z",
            status: "succeeded",
            target: {
              type: "message",
              id: "message-123",
            },
            reducers: [],
          },
        ]);
      },
      expected: {
        version: 1,
        operator: "reduce",
        status: "succeeded",
        ids: {
          sessionId: "reduce-message-123",
          messageId: "message-123",
        },
        artifacts: [
          {
            kind: "session",
            role: "session",
            path: ".voratiq/reduce/sessions/reduce-message-123",
          },
          {
            kind: "message",
            role: "input",
            path: ".voratiq/message/sessions/message-123",
          },
        ],
      },
    },
    {
      operator: "verify",
      argv: ["verify", "--run", "run-123", "--json"],
      setup: () => {
        executeVerifyCommandMock.mockResolvedValue({
          verificationId: "verify-123",
          record: {
            sessionId: "verify-123",
            createdAt: "2026-03-31T10:05:00.000Z",
            startedAt: "2026-03-31T10:05:00.000Z",
            completedAt: "2026-03-31T10:06:00.000Z",
            status: "succeeded",
            target: {
              kind: "run",
              sessionId: "run-123",
              candidateIds: ["agent-a"],
            },
            methods: [],
          },
        });
      },
      expected: {
        version: 1,
        operator: "verify",
        status: "succeeded",
        ids: {
          sessionId: "verify-123",
          runId: "run-123",
        },
        target: {
          kind: "run",
          sessionId: "run-123",
          candidateIds: ["agent-a"],
        },
        artifacts: [
          {
            kind: "session",
            role: "session",
            path: ".voratiq/verify/sessions/verify-123",
          },
        ],
      },
    },
    {
      operator: "verify",
      argv: ["verify", "--message", "message-123", "--json"],
      setup: () => {
        executeVerifyCommandMock.mockResolvedValue({
          verificationId: "verify-message-123",
          record: {
            sessionId: "verify-message-123",
            createdAt: "2026-03-31T10:06:00.000Z",
            startedAt: "2026-03-31T10:06:00.000Z",
            completedAt: "2026-03-31T10:07:00.000Z",
            status: "succeeded",
            target: {
              kind: "message",
              sessionId: "message-123",
            },
            methods: [],
          },
        });
      },
      expected: {
        version: 1,
        operator: "verify",
        status: "succeeded",
        ids: {
          sessionId: "verify-message-123",
          messageId: "message-123",
        },
        target: {
          kind: "message",
          sessionId: "message-123",
        },
        artifacts: [
          {
            kind: "session",
            role: "session",
            path: ".voratiq/verify/sessions/verify-message-123",
          },
        ],
      },
    },
    {
      operator: "apply",
      argv: [
        "apply",
        "--run",
        "run-123",
        "--agent",
        "agent-a",
        "--ignore-base-mismatch",
        "--json",
      ],
      setup: () => {
        executeApplyCommandMock.mockResolvedValue({
          runId: "run-123",
          specPath: "specs/task.md",
          status: "succeeded",
          createdAt: "2026-03-31T10:07:00.000Z",
          baseRevisionSha: "abc123",
          headRevision: "def456",
          diffPath:
            ".voratiq/run/sessions/run-123/agent-a/artifacts/diff.patch",
          ignoredBaseMismatch: true,
          agent: {
            agentId: "agent-a",
            model: "gpt-5.4",
            status: "succeeded",
            startedAt: "2026-03-31T10:07:00.000Z",
            completedAt: "2026-03-31T10:08:00.000Z",
            artifacts: {
              diffCaptured: true,
            },
          },
        });
      },
      expected: {
        version: 1,
        operator: "apply",
        status: "succeeded",
        ids: {
          runId: "run-123",
          agentId: "agent-a",
        },
        artifacts: [
          {
            kind: "run",
            role: "target",
            path: ".voratiq/run/sessions/run-123",
          },
          {
            kind: "diff",
            role: "output",
            agentId: "agent-a",
            path: ".voratiq/run/sessions/run-123/agent-a/artifacts/diff.patch",
          },
        ],
        alerts: [
          {
            level: "warn",
            message: "Apply proceeded despite a base mismatch.",
          },
        ],
      },
    },
    {
      operator: "prune",
      argv: ["prune", "--all", "--yes", "--json"],
      setup: () => {
        executePruneAllCommandMock.mockResolvedValue({
          status: "pruned",
          runIds: ["run-123"],
        });
      },
      expected: {
        version: 1,
        operator: "prune",
        status: "succeeded",
        artifacts: [],
      },
    },
  ])(
    "emits a stable success envelope for $operator",
    async ({ argv, setup, expected }) => {
      setup();

      const result = await invokeCli(argv);
      const envelope = normalizeEnvelope(parseJson<JsonEnvelope>(result));

      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(envelope).toMatchObject(expected);
    },
  );

  it("preserves verify unresolved semantics in the execution envelope", async () => {
    executeVerifyCommandMock.mockResolvedValue({
      verificationId: "verify-unresolved",
      record: {
        sessionId: "verify-unresolved",
        createdAt: "2026-03-31T10:09:00.000Z",
        startedAt: "2026-03-31T10:09:00.000Z",
        completedAt: "2026-03-31T10:10:00.000Z",
        status: "succeeded",
        target: {
          kind: "run",
          sessionId: "run-123",
          candidateIds: ["agent-a", "agent-b"],
        },
        methods: [],
      },
    });
    loadVerificationSelectionPolicyOutputMock.mockResolvedValue({
      input: {} as never,
      decision: {
        state: "unresolved",
        applyable: false,
        unresolvedReasons: [
          {
            code: "verifier_disagreement",
            selections: [
              {
                verifierAgentId: "reviewer-a",
                selectedCanonicalAgentId: "agent-a",
              },
            ],
          },
        ],
      },
      warnings: ["Selection policy loaded with warnings."],
    });

    const result = await invokeCli(["verify", "--run", "run-123", "--json"]);
    const envelope = normalizeEnvelope(parseJson<JsonEnvelope>(result));

    expect(result.exitCode).toBe(1);
    expect(envelope).toStrictEqual({
      version: 1,
      operator: "verify",
      status: "unresolved",
      timestamp: "<timestamp>",
      ids: {
        sessionId: "verify-unresolved",
        runId: "run-123",
      },
      target: {
        kind: "run",
        sessionId: "run-123",
        candidateIds: ["agent-a", "agent-b"],
      },
      artifacts: [
        {
          kind: "session",
          role: "session",
          path: ".voratiq/verify/sessions/verify-unresolved",
        },
      ],
      selection: {
        state: "unresolved",
      },
      unresolvedReasons: [
        {
          code: "verifier_disagreement",
        },
      ],
      alerts: [
        {
          level: "warn",
          message:
            "Warning: Selection policy loaded with warnings.\nVerification did not produce a resolvable candidate; manual review required.",
        },
        {
          level: "warn",
          message: "Verification could not resolve a canonical candidate.",
        },
      ],
    });
  });

  it("emits run target lineage in json mode when the input spec came from a spec session", async () => {
    executeRunCommandMock.mockResolvedValue({
      runId: "run-session-backed",
      spec: {
        path: ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.md",
        target: {
          kind: "spec",
          sessionId: "spec-123",
        },
      },
      status: "succeeded",
      createdAt: "2026-03-31T10:01:00.000Z",
      startedAt: "2026-03-31T10:01:00.000Z",
      completedAt: "2026-03-31T10:02:00.000Z",
      baseRevisionSha: "abc123",
      agents: [],
      hadAgentFailure: false,
    });

    const result = await invokeCli([
      "run",
      "--spec",
      ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.md",
      "--json",
    ]);
    const envelope = normalizeEnvelope(parseJson<JsonEnvelope>(result));

    expect(result.exitCode).toBe(0);
    expect(envelope).toMatchObject({
      version: 1,
      operator: "run",
      status: "succeeded",
      ids: {
        runId: "run-session-backed",
      },
      target: {
        kind: "spec",
        sessionId: "spec-123",
      },
      artifacts: [
        {
          kind: "session",
          role: "session",
          path: ".voratiq/run/sessions/run-session-backed",
        },
        {
          kind: "spec",
          role: "input",
          path: ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.md",
        },
      ],
    });
  });

  it("emits a failed apply envelope when the repository is dirty", async () => {
    ensureCleanWorkingTreeMock.mockRejectedValue(
      new DirtyWorkingTreeError(
        ["Dirty paths:", "  - src/app.ts (modified)"],
        ["Stash or commit local changes before continuing."],
      ),
    );

    const result = await invokeCli([
      "apply",
      "--run",
      "run-123",
      "--agent",
      "agent-a",
      "--json",
    ]);
    const envelope = normalizeEnvelope(parseJson<JsonEnvelope>(result));

    expect(result.exitCode).toBe(1);
    expect(envelope).toStrictEqual({
      version: 1,
      operator: "apply",
      status: "failed",
      timestamp: "<timestamp>",
      artifacts: [],
      error: {
        code: "dirty_working_tree_error",
        message: "Repository has uncommitted tracked changes.",
      },
    });
  });

  it("emits a failed apply envelope for a base mismatch", async () => {
    executeApplyCommandMock.mockRejectedValue(
      new ApplyBaseMismatchError({
        baseRevisionSha: "abc123456789",
        headRevision: "def987654321",
      }),
    );

    const result = await invokeCli([
      "apply",
      "--run",
      "run-123",
      "--agent",
      "agent-a",
      "--json",
    ]);
    const envelope = normalizeEnvelope(parseJson<JsonEnvelope>(result));

    expect(result.exitCode).toBe(1);
    expect(envelope.error).toMatchObject({
      code: "apply_base_mismatch_error",
      message:
        "Repository HEAD `def987654321` no longer matches run base `abc123456789`.",
    });
  });

  it("emits a failed prune envelope when json mode is not explicitly confirmed", async () => {
    const result = await invokeCli(["prune", "--all", "--json"]);
    const envelope = normalizeEnvelope(parseJson<JsonEnvelope>(result));

    expect(result.exitCode).toBe(1);
    expect(envelope).toStrictEqual({
      version: 1,
      operator: "prune",
      status: "failed",
      timestamp: "<timestamp>",
      artifacts: [],
      error: {
        code: "cli_error",
        message: "JSON-mode prune requires explicit confirmation.",
      },
    });
  });

  it("returns stable list table json output with warnings", async () => {
    executeListCommandMock.mockResolvedValue({
      warnings: ["Index contains a legacy session."],
      output: "ignored in json mode",
      mode: "table",
      json: {
        operator: "run",
        mode: "list",
        sessions: [
          {
            operator: "run",
            sessionId: "run-123",
            status: "succeeded",
            createdAt: "2026-03-31T11:00:00.000Z",
            target: {
              kind: "file",
              path: "specs/task.md",
            },
          },
        ],
        warnings: ["Index contains a legacy session."],
      },
    });

    const result = await invokeCli(["list", "--run", "--json"]);
    const payload = parseJson<Record<string, unknown>>(result);

    expect(result.exitCode).toBe(0);
    expect(payload).toStrictEqual({
      operator: "run",
      mode: "list",
      sessions: [
        {
          operator: "run",
          sessionId: "run-123",
          status: "succeeded",
          createdAt: "2026-03-31T11:00:00.000Z",
          target: {
            kind: "file",
            path: "specs/task.md",
          },
        },
      ],
      warnings: ["Index contains a legacy session."],
    });
  });

  it("returns stable list detail json output", async () => {
    executeListCommandMock.mockResolvedValue({
      warnings: [],
      output: "ignored in json mode",
      mode: "detail",
      json: {
        operator: "verify",
        mode: "detail",
        session: {
          operator: "verify",
          sessionId: "verify-123",
          status: "succeeded",
          createdAt: "2026-03-31T11:05:00.000Z",
          startedAt: "2026-03-31T11:05:00.000Z",
          completedAt: "2026-03-31T11:06:00.000Z",
          workspacePath: ".voratiq/verify/sessions/verify-123",
          agents: [],
        },
        warnings: [],
      },
    });

    const result = await invokeCli([
      "list",
      "--verify",
      "verify-123",
      "--json",
    ]);
    const payload = parseJson<Record<string, unknown>>(result);

    expect(result.exitCode).toBe(0);
    expect(payload).toStrictEqual({
      operator: "verify",
      mode: "detail",
      session: {
        operator: "verify",
        sessionId: "verify-123",
        status: "succeeded",
        createdAt: "2026-03-31T11:05:00.000Z",
        startedAt: "2026-03-31T11:05:00.000Z",
        completedAt: "2026-03-31T11:06:00.000Z",
        workspacePath: ".voratiq/verify/sessions/verify-123",
        agents: [],
      },
      warnings: [],
    });
  });

  it("returns stable empty list table json output", async () => {
    executeListCommandMock.mockResolvedValue({
      warnings: [],
      output: undefined,
      mode: "table",
      json: {
        operator: "spec",
        mode: "list",
        sessions: [],
        warnings: [],
      },
    });

    const result = await invokeCli(["list", "--spec", "--json"]);
    const payload = parseJson<Record<string, unknown>>(result);

    expect(result.exitCode).toBe(0);
    expect(payload).toStrictEqual({
      operator: "spec",
      mode: "list",
      sessions: [],
      warnings: [],
    });
  });

  it("returns session: null and exit code 0 for list detail not found", async () => {
    executeListCommandMock.mockResolvedValue({
      warnings: ["Lookup used the on-disk index only."],
      output: "verify session `verify-missing` not found.",
      mode: "detail",
      json: {
        operator: "verify",
        mode: "detail",
        session: null,
        warnings: ["Lookup used the on-disk index only."],
      },
    });

    const result = await invokeCli([
      "list",
      "--verify",
      "verify-missing",
      "--json",
    ]);
    const payload = parseJson<Record<string, unknown>>(result);

    expect(result.exitCode).toBe(0);
    expect(payload).toStrictEqual({
      operator: "verify",
      mode: "detail",
      session: null,
      warnings: ["Lookup used the on-disk index only."],
    });
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

  try {
    process.exitCode = undefined;
    await runCli(["node", "voratiq", ...args]);
    return {
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      exitCode: typeof process.exitCode === "number" ? process.exitCode : 0,
    };
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

function parseJson<T>(result: CapturedCliResult): T {
  expect(result.stderr).toBe("");
  expect(result.stdout.trim()).not.toBe("");
  return JSON.parse(result.stdout.trim()) as T;
}

function normalizeEnvelope(envelope: JsonEnvelope): JsonEnvelope {
  return {
    ...envelope,
    timestamp: "<timestamp>",
  };
}
