import { runApplyCommand } from "../../src/cli/apply.js";
import { CliError } from "../../src/cli/errors.js";
import { executeApplyCommand } from "../../src/commands/apply/command.js";
import type { ApplyResult } from "../../src/commands/apply/types.js";
import {
  ensureCleanWorkingTree,
  resolveCliContext,
} from "../../src/preflight/index.js";
import { renderApplyTranscript } from "../../src/render/transcripts/apply.js";
import { createAgentInvocationRecord } from "../support/factories/run-records.js";

jest.mock("../../src/preflight/index.js", () => ({
  resolveCliContext: jest.fn(),
  ensureCleanWorkingTree: jest.fn(),
}));

jest.mock("../../src/commands/apply/command.js", () => ({
  executeApplyCommand: jest.fn(),
}));

jest.mock("../../src/render/transcripts/apply.js", () => ({
  renderApplyTranscript: jest.fn(),
}));

const mockedResolveCliContext = resolveCliContext as jest.MockedFunction<
  typeof resolveCliContext
>;
const mockedEnsureCleanWorkingTree =
  ensureCleanWorkingTree as jest.MockedFunction<typeof ensureCleanWorkingTree>;
const mockedExecuteApplyCommand = executeApplyCommand as jest.MockedFunction<
  typeof executeApplyCommand
>;
const mockedRenderApplyTranscript =
  renderApplyTranscript as jest.MockedFunction<typeof renderApplyTranscript>;

describe("runApplyCommand", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("runs preflight, applies the stored diff, and returns the rendered transcript", async () => {
    mockedResolveCliContext.mockResolvedValue({
      root: "/repo",
      workspacePaths: {
        root: "/repo",
        workspaceDir: "/repo/.voratiq",
        runsDir: "/repo/.voratiq/runs",
        runsFile: "/repo/.voratiq/runs/index.json",
      },
    });
    mockedEnsureCleanWorkingTree.mockResolvedValue({ cleanWorkingTree: true });

    const applyAgent = createAgentInvocationRecord({
      agentId: "claude",
      model: "claude-model",
      status: "succeeded",
      startedAt: "2025-01-01T00:00:00Z",
      completedAt: "2025-01-01T00:00:01Z",
      artifacts: {
        diffAttempted: true,
        diffCaptured: true,
        stdoutCaptured: true,
        stderrCaptured: true,
        summaryCaptured: true,
      },
      evals: [],
    });

    const applyResult: ApplyResult = {
      runId: "run-123",
      specPath: "specs/apply.md",
      status: "succeeded",
      createdAt: new Date(0).toISOString(),
      baseRevisionSha: "abc123",
      headRevision: "abc123",
      agent: applyAgent,
      diffPath: ".voratiq/runs/run-123/claude/artifacts/diff.patch",
      ignoredBaseMismatch: false,
    };

    mockedExecuteApplyCommand.mockResolvedValue(applyResult);
    mockedRenderApplyTranscript.mockReturnValue("diff applied transcript");

    const output = await runApplyCommand({
      runId: "run-123",
      agentId: "claude",
      ignoreBaseMismatch: false,
    });

    expect(mockedResolveCliContext).toHaveBeenCalledWith();
    expect(mockedEnsureCleanWorkingTree).toHaveBeenCalledWith("/repo");
    expect(mockedExecuteApplyCommand).toHaveBeenCalledWith({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/runs/index.json",
      runId: "run-123",
      agentId: "claude",
      ignoreBaseMismatch: false,
    });
    expect(mockedRenderApplyTranscript).toHaveBeenCalledWith(applyResult);
    expect(output).toEqual({
      result: applyResult,
      body: "diff applied transcript",
    });
  });

  it("propagates CliError failures from the apply pipeline", async () => {
    mockedResolveCliContext.mockResolvedValue({
      root: "/repo",
      workspacePaths: {
        root: "/repo",
        workspaceDir: "/repo/.voratiq",
        runsDir: "/repo/.voratiq/runs",
        runsFile: "/repo/.voratiq/runs/index.json",
      },
    });
    mockedEnsureCleanWorkingTree.mockResolvedValue({ cleanWorkingTree: true });

    const failure = new CliError("boom");
    mockedExecuteApplyCommand.mockRejectedValue(failure);

    await expect(
      runApplyCommand({
        runId: "broken-run",
        agentId: "claude",
      }),
    ).rejects.toThrow(failure);

    expect(mockedRenderApplyTranscript).not.toHaveBeenCalled();
  });
});
