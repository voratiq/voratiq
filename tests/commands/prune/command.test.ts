import * as fs from "node:fs/promises";

import { jest } from "@jest/globals";

import { fetchRunSafely } from "../../../src/commands/fetch.js";
import {
  executePruneAllCommand,
  executePruneCommand,
} from "../../../src/commands/prune/command.js";
import {
  PruneBranchDeletionError,
  PruneRunDeletedError,
} from "../../../src/commands/prune/errors.js";
import type {
  PruneCommandInput,
  PruneConfirmationHandler,
} from "../../../src/commands/prune/types.js";
import {
  renderPruneAllTranscript,
  renderPruneTranscript,
} from "../../../src/render/transcripts/prune.js";
import {
  fetchRunsSafely,
  rewriteRunRecord,
} from "../../../src/runs/records/persistence.js";
import type { RunRecord } from "../../../src/runs/records/types.js";
import { pathExists } from "../../../src/utils/fs.js";
import { runGitCommand } from "../../../src/utils/git.js";
import {
  removeRunDirectory,
  removeWorkspaceEntry,
} from "../../../src/workspace/prune.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../../support/factories/run-records.js";

jest.mock("../../../src/commands/fetch.js", () => ({
  fetchRunSafely: jest.fn(),
}));

jest.mock("../../../src/utils/fs.js", () => {
  const actual = jest.requireActual<typeof import("../../../src/utils/fs.js")>(
    "../../../src/utils/fs.js",
  );
  return {
    ...actual,
    pathExists: jest.fn(),
  };
});

jest.mock("../../../src/workspace/prune.js", () => {
  const actual = jest.requireActual<
    typeof import("../../../src/workspace/prune.js")
  >("../../../src/workspace/prune.js");
  return {
    ...actual,
    removeRunDirectory: jest.fn(),
    removeWorkspaceEntry: jest.fn(),
  };
});

jest.mock("../../../src/utils/git.js", () => ({
  runGitCommand: jest.fn(),
  getGitStderr: jest.fn(),
}));

jest.mock("../../../src/runs/records/persistence.js", () => ({
  fetchRunsSafely: jest.fn(),
  rewriteRunRecord: jest.fn(),
  RUN_RECORD_FILENAME: "record.json",
}));

type ConfirmHandler = PruneConfirmationHandler;

const fetchRunSafelyMock = jest.mocked(fetchRunSafely);
const fetchRunsSafelyMock = jest.mocked(fetchRunsSafely);
const pathExistsMock = jest.mocked(pathExists);
const removeRunDirectoryMock = jest.mocked(removeRunDirectory);
const removeWorkspaceEntryMock = jest.mocked(removeWorkspaceEntry);
const runGitCommandMock = jest.mocked(runGitCommand);
const rewriteRunRecordMock = jest.mocked(rewriteRunRecord);
type FsModule = typeof import("node:fs/promises");
type ReaddirFn = FsModule["readdir"];

function buildInput(
  overrides: Partial<PruneCommandInput> = {},
): PruneCommandInput {
  return {
    root: "/repo",
    runsDir: "/repo/.voratiq/runs",
    runsFilePath: "/repo/.voratiq/runs/index.json",
    runId: "20251110-abc123",
    confirm: () => Promise.resolve(true),
    ...overrides,
  };
}

function buildDirent(name: string, directory: boolean): unknown {
  return {
    name,
    path: "",
    parentPath: "",
    isDirectory: () => directory,
    isFile: () => !directory,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
  };
}

function getReaddirMock(): jest.MockedFunction<ReaddirFn> {
  const moduleWithMock = fs as FsModule & {
    __readdirMock?: jest.MockedFunction<ReaddirFn>;
  };
  if (!moduleWithMock.__readdirMock) {
    throw new Error("readdir mock not initialized");
  }
  return moduleWithMock.__readdirMock;
}

describe("executePruneCommand", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getReaddirMock().mockReset();
    pathExistsMock.mockResolvedValue(true);
    removeRunDirectoryMock.mockResolvedValue(undefined);
    removeWorkspaceEntryMock.mockResolvedValue(undefined);
    runGitCommandMock.mockResolvedValue("");
    rewriteRunRecordMock.mockImplementation(({ mutate }) =>
      Promise.resolve(mutate(mockRunRecord())),
    );
  });

  function mockRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
    const agentOverrides = overrides.agents ?? [
      createAgentInvocationRecord({ agentId: "claude" }),
    ];
    return createRunRecord({
      runId: "20251110-abc123",
      agents: agentOverrides,
      spec: { path: "specs/demo.md" },
      ...overrides,
    });
  }

  it("aborts when confirmation declines", async () => {
    const runRecord = mockRunRecord();
    fetchRunSafelyMock.mockResolvedValue(runRecord);
    const confirm: jest.MockedFunction<ConfirmHandler> = jest.fn();
    confirm.mockResolvedValue(false);

    const result = await executePruneCommand(buildInput({ confirm }));

    expect(result).toMatchObject({
      status: "aborted",
      runId: runRecord.runId,
      specPath: runRecord.spec.path,
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Proceed?", defaultValue: false }),
    );
    expect(removeRunDirectoryMock).not.toHaveBeenCalled();
  });

  it("prunes workspaces, artifacts, and branches when confirmed with purge", async () => {
    const agents = [
      createAgentInvocationRecord({ agentId: "claude" }),
      createAgentInvocationRecord({ agentId: "codex" }),
    ];
    const runRecord = mockRunRecord({ agents });
    fetchRunSafelyMock.mockResolvedValue(runRecord);

    const existingPaths = new Set<string>([
      "/repo/.voratiq/runs/sessions/20251110-abc123",
      "/repo/.voratiq/runs/sessions/20251110-abc123/claude/workspace",
      "/repo/.voratiq/runs/sessions/20251110-abc123/codex/workspace",
      "/repo/.voratiq/runs/sessions/20251110-abc123/claude/artifacts/stdout.log",
      "/repo/.voratiq/runs/sessions/20251110-abc123/codex/artifacts/stdout.log",
      "/repo/.voratiq/runs/sessions/20251110-abc123/claude/artifacts/stderr.log",
      "/repo/.voratiq/runs/sessions/20251110-abc123/codex/artifacts/stderr.log",
      "/repo/.voratiq/runs/sessions/20251110-abc123/claude/artifacts/diff.patch",
      "/repo/.voratiq/runs/sessions/20251110-abc123/codex/artifacts/diff.patch",
      "/repo/.voratiq/runs/sessions/20251110-abc123/claude/artifacts/summary.txt",
      "/repo/.voratiq/runs/sessions/20251110-abc123/codex/artifacts/summary.txt",
      "/repo/.voratiq/runs/sessions/20251110-abc123/claude/evals",
      "/repo/.voratiq/runs/sessions/20251110-abc123/codex/evals",
    ]);
    pathExistsMock.mockImplementation((candidate) =>
      Promise.resolve(existingPaths.has(String(candidate))),
    );

    const deletedRecord: RunRecord = {
      ...runRecord,
      status: "pruned",
      deletedAt: "2025-11-10T16:00:00.000Z",
    };
    rewriteRunRecordMock.mockImplementation(({ mutate }) =>
      Promise.resolve(mutate(deletedRecord)),
    );

    runGitCommandMock.mockImplementation((args: string[]) => {
      if (args[0] === "branch" && args[1] === "--list") {
        return Promise.resolve(args[2] ?? "");
      }
      return Promise.resolve("");
    });
    getReaddirMock().mockResolvedValue([
      buildDirent("claude", true),
      buildDirent("codex", true),
      buildDirent("record.json", false),
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

    const result = await executePruneCommand(
      buildInput({
        purge: true,
        confirm: () => Promise.resolve(true),
      }),
    );

    if (result.status !== "pruned") {
      throw new Error("Expected prune success result");
    }

    expect(result.status).toBe("pruned");
    expect(result.artifacts.purged).toBe(true);
    expect(result.workspaces.removed).toEqual(
      expect.arrayContaining([
        ".voratiq/runs/sessions/20251110-abc123/claude/workspace",
        ".voratiq/runs/sessions/20251110-abc123/codex/workspace",
      ]),
    );
    expect(result.artifacts.removed).toEqual(
      expect.arrayContaining([
        ".voratiq/runs/sessions/20251110-abc123/claude/artifacts/stdout.log",
        ".voratiq/runs/sessions/20251110-abc123/codex/artifacts/summary.txt",
      ]),
    );
    expect(result.branches.deleted).toEqual([
      "voratiq/run/20251110-abc123/claude",
      "voratiq/run/20251110-abc123/codex",
    ]);
    expect(removeRunDirectoryMock).not.toHaveBeenCalled();
    expect(removeWorkspaceEntryMock).toHaveBeenCalledWith({
      path: "/repo/.voratiq/runs/sessions/20251110-abc123/claude",
      root: "/repo",
      recursive: true,
    });
    expect(removeWorkspaceEntryMock).toHaveBeenCalledWith({
      path: "/repo/.voratiq/runs/sessions/20251110-abc123/codex",
      root: "/repo",
      recursive: true,
    });
  });

  it("rethrows prune attempts for deleted runs", async () => {
    fetchRunSafelyMock.mockRejectedValue(new PruneRunDeletedError("old-run"));

    await expect(executePruneCommand(buildInput())).rejects.toThrow(
      PruneRunDeletedError,
    );
  });

  it("wraps git failures when deleting branches", async () => {
    const runRecord = mockRunRecord({
      agents: [
        createAgentInvocationRecord({ agentId: "claude" }),
        createAgentInvocationRecord({ agentId: "codex" }),
      ],
    });
    fetchRunSafelyMock.mockResolvedValue(runRecord);

    runGitCommandMock.mockImplementation((args: string[]) => {
      if (args[0] === "branch" && args[1] === "--list") {
        return Promise.resolve(args[2] ?? "");
      }
      if (
        args[0] === "branch" &&
        args[1] === "-D" &&
        args[2] === "voratiq/run/20251110-abc123/codex"
      ) {
        return Promise.reject(new Error("unable to delete branch"));
      }
      return Promise.resolve("");
    });

    await expect(
      executePruneCommand(buildInput({ purge: false })),
    ).rejects.toThrow(PruneBranchDeletionError);
  });
});

describe("executePruneAllCommand", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getReaddirMock().mockReset();
    pathExistsMock.mockResolvedValue(true);
    removeRunDirectoryMock.mockResolvedValue(undefined);
    removeWorkspaceEntryMock.mockResolvedValue(undefined);
    runGitCommandMock.mockResolvedValue("");
    rewriteRunRecordMock.mockImplementation(({ runId, mutate }) =>
      Promise.resolve(
        mutate(
          createRunRecord({
            runId,
            agents: [createAgentInvocationRecord({ agentId: "claude" })],
            spec: { path: "specs/demo.md" },
          }),
        ),
      ),
    );
  });

  it("returns a no-op result when no runs are eligible", async () => {
    fetchRunsSafelyMock.mockResolvedValue({ records: [], warnings: [] });

    const confirm: jest.MockedFunction<ConfirmHandler> = jest.fn();
    confirm.mockResolvedValue(true);

    const result = await executePruneAllCommand({
      root: "/repo",
      runsDir: "/repo/.voratiq/runs",
      runsFilePath: "/repo/.voratiq/runs/index.json",
      confirm,
      purge: false,
    });

    expect(result).toEqual({ status: "noop", runIds: [] });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("prompts once and prunes every eligible run when confirmed", async () => {
    const runNewer = createRunRecord({
      runId: "20260110-newer",
      createdAt: "2026-01-10T10:00:00.000Z",
      status: "succeeded",
      spec: { path: "specs/newer.md" },
      agents: [createAgentInvocationRecord({ agentId: "claude" })],
    });
    const runOlder = createRunRecord({
      runId: "20251201-older",
      createdAt: "2025-12-01T10:00:00.000Z",
      status: "failed",
      spec: { path: "specs/older.md" },
      agents: [createAgentInvocationRecord({ agentId: "claude" })],
    });

    fetchRunsSafelyMock.mockResolvedValue({
      records: [runNewer, runOlder],
      warnings: [],
    });

    const runById = new Map<string, RunRecord>([
      [runNewer.runId, runNewer],
      [runOlder.runId, runOlder],
    ]);

    fetchRunSafelyMock.mockImplementation(({ runId }) => {
      const record = runById.get(runId);
      if (!record) {
        throw new Error(`Unexpected runId ${runId}`);
      }
      return Promise.resolve(record);
    });

    const confirm: jest.MockedFunction<ConfirmHandler> = jest.fn();
    confirm.mockResolvedValue(true);

    const result = await executePruneAllCommand({
      root: "/repo",
      runsDir: "/repo/.voratiq/runs",
      runsFilePath: "/repo/.voratiq/runs/index.json",
      confirm,
      purge: false,
    });

    expect(result).toEqual({
      status: "pruned",
      runIds: [runOlder.runId, runNewer.runId],
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    const confirmationOptions = confirm.mock.calls[0]?.[0];
    expect(confirmationOptions).toMatchObject({
      message: "Proceed?",
      defaultValue: false,
    });
    const prefaceLines = confirmationOptions?.prefaceLines ?? [];
    expect(prefaceLines.some((line) => line.includes("Workspaces to be"))).toBe(
      false,
    );
    expect(prefaceLines.some((line) => line.includes("Branches to be"))).toBe(
      false,
    );
    expect(prefaceLines.some((line) => line.includes("2 runs to prune."))).toBe(
      true,
    );

    expect(rewriteRunRecordMock).toHaveBeenCalledTimes(2);
  });

  it("aborts without pruning when confirmation declines", async () => {
    const runRecord = createRunRecord({
      runId: "20260110-abcde",
      createdAt: "2026-01-10T10:00:00.000Z",
      status: "succeeded",
      spec: { path: "specs/demo.md" },
      agents: [createAgentInvocationRecord({ agentId: "claude" })],
    });

    fetchRunsSafelyMock.mockResolvedValue({
      records: [runRecord],
      warnings: [],
    });

    const confirm: jest.MockedFunction<ConfirmHandler> = jest.fn();
    confirm.mockResolvedValue(false);

    const result = await executePruneAllCommand({
      root: "/repo",
      runsDir: "/repo/.voratiq/runs",
      runsFilePath: "/repo/.voratiq/runs/index.json",
      confirm,
      purge: false,
    });

    expect(result).toEqual({ status: "aborted", runIds: [runRecord.runId] });
    expect(fetchRunSafelyMock).not.toHaveBeenCalled();
    expect(rewriteRunRecordMock).not.toHaveBeenCalled();
  });
});

describe("renderPruneTranscript", () => {
  it("renders aborted output with hint", () => {
    const transcript = renderPruneTranscript({
      status: "aborted",
      runId: "2025",
      specPath: "specs/demo.md",
      runPath: ".voratiq/runs/sessions/2025",
    });

    expect(transcript).toContain("Prune aborted; no changes were made.");
    expect(transcript).toContain("voratiq prune --run 2025");
  });

  it("renders success output", () => {
    const transcript = renderPruneTranscript({
      status: "pruned",
      runId: "2025",
      specPath: "specs/demo.md",
      runPath: ".voratiq/runs/sessions/2025",
      createdAt: "2025-11-10T10:00:00.000Z",
      deletedAt: "2025-11-10T11:00:00.000Z",
      workspaces: { removed: [], missing: [] },
      artifacts: { purged: false, removed: [], missing: [] },
      branches: { deleted: [], skipped: [] },
    });

    expect(transcript).toContain("Run pruned successfully.");
  });
});

describe("renderPruneAllTranscript", () => {
  it("renders aborted output with hint", () => {
    const transcript = renderPruneAllTranscript({
      status: "aborted",
      runIds: ["2025"],
    });

    expect(transcript).toContain("Prune aborted; no changes were made.");
    expect(transcript).toContain("voratiq prune --all");
  });

  it("renders a no-op output when there are no runs", () => {
    const transcript = renderPruneAllTranscript({
      status: "noop",
      runIds: [],
    });

    expect(transcript).toContain("No runs to prune.");
  });

  it("renders success output", () => {
    const transcript = renderPruneAllTranscript({
      status: "pruned",
      runIds: ["2025"],
    });

    expect(transcript).toContain("Runs pruned successfully.");
  });
});
jest.mock("node:fs/promises", () => {
  const actual =
    jest.requireActual<typeof import("node:fs/promises")>("node:fs/promises");
  const readdirMock = jest.fn() as unknown as jest.MockedFunction<
    typeof actual.readdir
  >;
  return {
    ...actual,
    readdir: readdirMock,
    __readdirMock: readdirMock,
  } satisfies typeof actual & {
    __readdirMock: jest.MockedFunction<typeof actual.readdir>;
  };
});
