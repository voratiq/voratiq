import { executeApplyCommand } from "../../../src/commands/apply/command.js";
import { ApplyPatchApplicationError } from "../../../src/commands/apply/errors.js";
import {
  fetchRunsSafely,
  rewriteRunRecord,
} from "../../../src/runs/records/persistence.js";
import type { RunRecord } from "../../../src/runs/records/types.js";
import { ensureFileExists } from "../../../src/utils/fs.js";
import { getHeadRevision, runGitCommand } from "../../../src/utils/git.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../../support/factories/run-records.js";

jest.mock("../../../src/runs/records/persistence.js", () => {
  const actual = jest.requireActual<
    typeof import("../../../src/runs/records/persistence.js")
  >("../../../src/runs/records/persistence.js");
  return {
    ...actual,
    fetchRunsSafely: jest.fn(),
    rewriteRunRecord: jest.fn(),
  };
});

jest.mock("../../../src/utils/fs.js", () => {
  const actual = jest.requireActual<typeof import("../../../src/utils/fs.js")>(
    "../../../src/utils/fs.js",
  );
  return {
    ensureFileExists: jest.fn(),
    isFileSystemError: actual.isFileSystemError,
  };
});

jest.mock("../../../src/utils/git.js", () => {
  const actual = jest.requireActual<typeof import("../../../src/utils/git.js")>(
    "../../../src/utils/git.js",
  );
  return {
    ...actual,
    getHeadRevision: jest.fn(),
    runGitCommand: jest.fn(),
  };
});

const mockedFetchRunsSafely = fetchRunsSafely as jest.MockedFunction<
  typeof fetchRunsSafely
>;
const mockedRewriteRunRecord = rewriteRunRecord as jest.MockedFunction<
  typeof rewriteRunRecord
>;
const mockedEnsureFileExists = ensureFileExists as jest.MockedFunction<
  typeof ensureFileExists
>;
const mockedGetHeadRevision = getHeadRevision as jest.MockedFunction<
  typeof getHeadRevision
>;
const mockedRunGitCommand = runGitCommand as jest.MockedFunction<
  typeof runGitCommand
>;

const baseRunRecord: RunRecord = createRunRecord({
  runId: "run-apply",
  baseRevisionSha: "abc123",
  spec: { path: "specs/sample.md" },
  createdAt: "2025-01-01T00:00:00.000Z",
  agents: [
    createAgentInvocationRecord({
      agentId: "agent-1",
      model: "model",
      status: "succeeded",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:01:00.000Z",
      commitSha: "abc123",
    }),
  ],
  status: "succeeded",
});

function cloneRunRecord(record: RunRecord): RunRecord {
  return JSON.parse(JSON.stringify(record)) as RunRecord;
}

let lastMutatedRecord: RunRecord | undefined;

beforeEach(() => {
  jest.resetAllMocks();
  lastMutatedRecord = undefined;
  mockedFetchRunsSafely.mockImplementation(() =>
    Promise.resolve({ records: [cloneRunRecord(baseRunRecord)], warnings: [] }),
  );
  mockedEnsureFileExists.mockResolvedValue(undefined);
  mockedGetHeadRevision.mockResolvedValue("abc123");
  mockedRewriteRunRecord.mockImplementation((options) => {
    const mutated = options.mutate(cloneRunRecord(baseRunRecord));
    lastMutatedRecord = mutated;
    return Promise.resolve(mutated);
  });
});

describe("executeApplyCommand applyStatus integration (mocked)", () => {
  it("records a successful apply attempt on the run record", async () => {
    mockedRunGitCommand.mockResolvedValue("");

    await executeApplyCommand({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/runs/index.json",
      runId: "run-apply",
      agentId: "agent-1",
      ignoreBaseMismatch: false,
    });

    expect(mockedRewriteRunRecord).toHaveBeenCalledTimes(1);
    const mutated = lastMutatedRecord;
    if (!mutated) {
      throw new Error("apply status was not recorded");
    }
    expect(mutated.applyStatus).toBeDefined();
    expect(mutated.applyStatus?.status).toBe("succeeded");
    expect(mutated.applyStatus?.agentId).toBe("agent-1");
    expect(mutated.applyStatus?.ignoredBaseMismatch).toBe(false);
    expect(mutated.applyStatus?.detail ?? undefined).toBeUndefined();
  });

  it("records a failed apply attempt with truncated detail", async () => {
    const longDetail = "x".repeat(300);
    mockedRunGitCommand.mockRejectedValue({ stderr: longDetail });

    await expect(
      executeApplyCommand({
        root: "/repo",
        runsFilePath: "/repo/.voratiq/runs/index.json",
        runId: "run-apply",
        agentId: "agent-1",
        ignoreBaseMismatch: false,
      }),
    ).rejects.toBeInstanceOf(ApplyPatchApplicationError);

    expect(mockedRewriteRunRecord).toHaveBeenCalledTimes(1);
    const mutated = lastMutatedRecord;
    if (!mutated) {
      throw new Error("apply status was not recorded");
    }
    expect(mutated.applyStatus?.status).toBe("failed");
    expect(mutated.applyStatus?.agentId).toBe("agent-1");
    expect(mutated.applyStatus?.ignoredBaseMismatch).toBe(false);
    const detail = mutated.applyStatus?.detail ?? "";
    expect(detail.length).toBe(256);
    expect(detail).toBe(longDetail.slice(0, 256));
  });
});
