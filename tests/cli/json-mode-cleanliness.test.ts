import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { checkPlatformSupport } from "../../src/agents/runtime/sandbox.js";
import { createConfirmationWorkflow } from "../../src/cli/confirmation.js";
import { runPruneCommand } from "../../src/cli/prune.js";
import { runReduceCommand } from "../../src/cli/reduce.js";
import { runRunCommand } from "../../src/cli/run.js";
import { runSpecCommand } from "../../src/cli/spec.js";
import { runVerifyCommand } from "../../src/cli/verify.js";
import { executePruneAllCommand } from "../../src/commands/prune/command.js";
import { executeReduceCommand } from "../../src/commands/reduce/command.js";
import { executeRunCommand } from "../../src/commands/run/command.js";
import { executeSpecCommand } from "../../src/commands/spec/command.js";
import { executeVerifyCommand } from "../../src/commands/verify/command.js";
import { resolveExtraContextFiles } from "../../src/competition/shared/extra-context.js";
import { readReductionRecords } from "../../src/domain/reduce/persistence/adapter.js";
import { loadVerificationSelectionPolicyOutput } from "../../src/policy/index.js";
import {
  ensureCleanWorkingTree,
  ensureSandboxDependencies,
  ensureSpecPath,
  resolveCliContext,
} from "../../src/preflight/index.js";

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

jest.mock("../../src/commands/run/command.js", () => ({
  executeRunCommand: jest.fn(),
}));

jest.mock("../../src/commands/verify/command.js", () => ({
  executeVerifyCommand: jest.fn(),
}));

jest.mock("../../src/policy/index.js", () => ({
  loadVerificationSelectionPolicyOutput: jest.fn(),
}));

jest.mock("../../src/commands/reduce/command.js", () => ({
  executeReduceCommand: jest.fn(),
}));

jest.mock("../../src/commands/prune/command.js", () => ({
  executePruneAllCommand: jest.fn(),
  executePruneCommand: jest.fn(),
}));

jest.mock("../../src/domain/reduce/persistence/adapter.js", () => ({
  readReductionRecords: jest.fn(),
}));

jest.mock("../../src/cli/confirmation.js", () => ({
  createConfirmationWorkflow: jest.fn(),
}));

const checkPlatformSupportMock = jest.mocked(checkPlatformSupport);
const resolveExtraContextFilesMock = jest.mocked(resolveExtraContextFiles);
const resolveCliContextMock = jest.mocked(resolveCliContext);
const ensureSandboxDependenciesMock = jest.mocked(ensureSandboxDependencies);
const ensureCleanWorkingTreeMock = jest.mocked(ensureCleanWorkingTree);
const ensureSpecPathMock = jest.mocked(ensureSpecPath);
const executeSpecCommandMock = jest.mocked(executeSpecCommand);
const executeRunCommandMock = jest.mocked(executeRunCommand);
const executeVerifyCommandMock = jest.mocked(executeVerifyCommand);
const loadVerificationSelectionPolicyOutputMock = jest.mocked(
  loadVerificationSelectionPolicyOutput,
);
const executeReduceCommandMock = jest.mocked(executeReduceCommand);
const executePruneAllCommandMock = jest.mocked(executePruneAllCommand);
const readReductionRecordsMock = jest.mocked(readReductionRecords);
const createConfirmationWorkflowMock = jest.mocked(createConfirmationWorkflow);

describe("json mode cleanliness", () => {
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;

  beforeEach(() => {
    jest.clearAllMocks();

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
        specsFile: "/repo/.voratiq/spec/index.json",
        specsDir: "/repo/.voratiq/spec",
        runsFile: "/repo/.voratiq/run/index.json",
        runsDir: "/repo/.voratiq/run",
        reductionsDir: "/repo/.voratiq/reduce",
        reductionsFile: "/repo/.voratiq/reduce/index.json",
        verificationsDir: "/repo/.voratiq/verify",
        verificationsFile: "/repo/.voratiq/verify/index.json",
      },
    });
    loadVerificationSelectionPolicyOutputMock.mockRejectedValue(
      new Error("selection not needed"),
    );

    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("keeps spec json mode silent before envelope emission", async () => {
    executeSpecCommandMock.mockImplementation((input) => {
      input.renderer?.begin({
        sessionId: "spec-123",
        createdAt: "2026-03-27T00:00:00.000Z",
        startedAt: "2026-03-27T00:00:00.000Z",
        workspacePath: ".voratiq/spec/sessions/spec-123",
        status: "running",
      });
      input.renderer?.update({
        agentId: "agent-a",
        status: "running",
        startedAt: "2026-03-27T00:00:00.000Z",
      });
      input.renderer?.complete("succeeded", {
        startedAt: "2026-03-27T00:00:00.000Z",
        completedAt: "2026-03-27T00:00:05.000Z",
      });

      return Promise.resolve({
        sessionId: "spec-123",
        status: "succeeded",
        record: {
          sessionId: "spec-123",
          createdAt: "2026-03-27T00:00:00.000Z",
          startedAt: "2026-03-27T00:00:00.000Z",
          completedAt: "2026-03-27T00:00:05.000Z",
          status: "succeeded",
          description: "test",
          agents: [],
        },
        agents: [],
      });
    });

    await runSpecCommand({
      description: "test",
      json: true,
    });

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("keeps run json mode silent before envelope emission", async () => {
    executeRunCommandMock.mockImplementation((input) => {
      input.renderer?.begin({
        runId: "run-123",
        status: "running",
        workspacePath: ".voratiq/run/sessions/run-123",
        createdAt: "2026-03-27T00:00:00.000Z",
        startedAt: "2026-03-27T00:00:00.000Z",
      });
      input.renderer?.update({
        agentId: "agent-a",
        model: "test-model",
        status: "running",
        startedAt: "2026-03-27T00:00:00.000Z",
        completedAt: "2026-03-27T00:00:05.000Z",
      });

      return Promise.resolve({
        runId: "run-123",
        spec: { path: "specs/task.md" },
        status: "succeeded",
        createdAt: "2026-03-27T00:00:00.000Z",
        startedAt: "2026-03-27T00:00:00.000Z",
        completedAt: "2026-03-27T00:00:05.000Z",
        baseRevisionSha: "abc123",
        agents: [],
        hadAgentFailure: false,
      });
    });

    await runRunCommand({
      specPath: "specs/task.md",
      json: true,
    });

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("keeps verify json mode silent before envelope emission", async () => {
    executeVerifyCommandMock.mockImplementation((input) => {
      input.renderer?.begin({
        verificationId: "verify-123",
        createdAt: "2026-03-27T00:00:00.000Z",
        startedAt: "2026-03-27T00:00:00.000Z",
        completedAt: undefined,
        workspacePath: ".voratiq/verify/sessions/verify-123",
        status: "running",
      });
      input.renderer?.update({
        methodKey: "programmatic",
        verifierLabel: "programmatic",
        status: "running",
        startedAt: "2026-03-27T00:00:00.000Z",
      });
      input.renderer?.complete("succeeded", {
        startedAt: "2026-03-27T00:00:00.000Z",
        completedAt: "2026-03-27T00:00:05.000Z",
      });

      return Promise.resolve({
        verificationId: "verify-123",
        record: {
          sessionId: "verify-123",
          createdAt: "2026-03-27T00:00:00.000Z",
          startedAt: "2026-03-27T00:00:00.000Z",
          completedAt: "2026-03-27T00:00:05.000Z",
          status: "succeeded",
          target: {
            kind: "run",
            sessionId: "run-123",
            candidateIds: ["agent-a"],
          },
          methods: [],
        },
      });
    });

    await runVerifyCommand({
      target: {
        kind: "run",
        sessionId: "run-123",
      },
      json: true,
    });

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("keeps reduce json mode silent before envelope emission", async () => {
    executeReduceCommandMock.mockImplementation((input) => {
      input.renderer?.begin({
        reductionId: "reduce-123",
        createdAt: "2026-03-27T00:00:00.000Z",
        workspacePath: ".voratiq/reduce/sessions/reduce-123",
        status: "running",
      });
      input.renderer?.update({
        reducerAgentId: "agent-a",
        status: "running",
        startedAt: "2026-03-27T00:00:00.000Z",
      });
      input.renderer?.complete("succeeded", {
        startedAt: "2026-03-27T00:00:00.000Z",
        completedAt: "2026-03-27T00:00:05.000Z",
      });

      return Promise.resolve({
        reductionId: "reduce-123",
        target: {
          type: "run",
          id: "run-123",
        },
        reducerAgentIds: ["agent-a"],
        reductions: [],
      });
    });
    readReductionRecordsMock.mockResolvedValue([
      {
        sessionId: "reduce-123",
        createdAt: "2026-03-27T00:00:00.000Z",
        startedAt: "2026-03-27T00:00:00.000Z",
        completedAt: "2026-03-27T00:00:05.000Z",
        status: "succeeded",
        target: {
          type: "run",
          id: "run-123",
        },
        reducers: [],
      },
    ]);

    await runReduceCommand({
      target: {
        type: "run",
        id: "run-123",
      },
      json: true,
    });

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("fails prune json mode without explicit confirmation", async () => {
    await expect(
      runPruneCommand({
        all: true,
        json: true,
      }),
    ).rejects.toThrow("JSON-mode prune requires explicit confirmation.");

    expect(createConfirmationWorkflowMock).not.toHaveBeenCalled();
    expect(executePruneAllCommandMock).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("allows prune json mode with explicit confirmation", async () => {
    const confirm = jest.fn(() => Promise.resolve(true));
    const prompt = jest.fn(() => Promise.resolve(""));
    const close = jest.fn();
    createConfirmationWorkflowMock.mockReturnValue({
      interactive: false,
      confirm,
      prompt,
      close,
    });

    executePruneAllCommandMock.mockResolvedValue({
      status: "noop",
      runIds: [],
    });

    await runPruneCommand({
      all: true,
      json: true,
      yes: true,
    });

    expect(createConfirmationWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assumeYes: true,
      }),
    );
    expect(executePruneAllCommandMock).toHaveBeenCalledTimes(1);
  });
});
