import * as fs from "node:fs/promises";

import { jest } from "@jest/globals";

import { fetchRunSafely } from "../../../src/commands/fetch.js";
import { executePruneCommand } from "../../../src/commands/prune/command.js";
import {
  PruneBranchDeletionError,
  PruneRunDeletedError,
} from "../../../src/commands/prune/errors.js";
import type {
  PruneCommandInput,
  PruneConfirmationHandler,
} from "../../../src/commands/prune/types.js";
import { rewriteRunRecord } from "../../../src/records/persistence.js";
import type { RunRecord } from "../../../src/records/types.js";
import { renderPruneTranscript } from "../../../src/render/transcripts/prune.js";
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

jest.mock("../../../src/utils/fs.js", () => ({
  pathExists: jest.fn(),
}));

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

jest.mock("../../../src/records/persistence.js", () => ({
  rewriteRunRecord: jest.fn(),
}));

type ConfirmHandler = PruneConfirmationHandler;

const fetchRunSafelyMock = jest.mocked(fetchRunSafely);
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
      "/repo/.voratiq/runs/20251110-abc123",
      "/repo/.voratiq/runs/20251110-abc123/prompt.txt",
      "/repo/.voratiq/runs/20251110-abc123/claude/workspace",
      "/repo/.voratiq/runs/20251110-abc123/codex/workspace",
      "/repo/.voratiq/runs/20251110-abc123/claude/artifacts/stdout.log",
      "/repo/.voratiq/runs/20251110-abc123/codex/artifacts/stdout.log",
      "/repo/.voratiq/runs/20251110-abc123/claude/artifacts/stderr.log",
      "/repo/.voratiq/runs/20251110-abc123/codex/artifacts/stderr.log",
      "/repo/.voratiq/runs/20251110-abc123/claude/artifacts/diff.patch",
      "/repo/.voratiq/runs/20251110-abc123/codex/artifacts/diff.patch",
      "/repo/.voratiq/runs/20251110-abc123/claude/artifacts/summary.txt",
      "/repo/.voratiq/runs/20251110-abc123/codex/artifacts/summary.txt",
      "/repo/.voratiq/runs/20251110-abc123/claude/evals",
      "/repo/.voratiq/runs/20251110-abc123/codex/evals",
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
      buildDirent("prompt.txt", false),
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
        ".voratiq/runs/20251110-abc123/claude/workspace",
        ".voratiq/runs/20251110-abc123/codex/workspace",
      ]),
    );
    expect(result.artifacts.removed).toEqual(
      expect.arrayContaining([
        ".voratiq/runs/20251110-abc123/claude/artifacts/stdout.log",
        ".voratiq/runs/20251110-abc123/codex/artifacts/summary.txt",
      ]),
    );
    expect(result.branches.deleted).toEqual([
      "voratiq/run/20251110-abc123/claude",
      "voratiq/run/20251110-abc123/codex",
    ]);
    expect(removeRunDirectoryMock).not.toHaveBeenCalled();
    expect(removeWorkspaceEntryMock).toHaveBeenCalledWith({
      path: "/repo/.voratiq/runs/20251110-abc123/claude",
      root: "/repo",
      recursive: true,
    });
    expect(removeWorkspaceEntryMock).toHaveBeenCalledWith({
      path: "/repo/.voratiq/runs/20251110-abc123/codex",
      root: "/repo",
      recursive: true,
    });
    expect(removeWorkspaceEntryMock).toHaveBeenCalledWith({
      path: "/repo/.voratiq/runs/20251110-abc123/prompt.txt",
      root: "/repo",
      recursive: false,
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

describe("renderPruneTranscript", () => {
  it("renders aborted output with hint", () => {
    const transcript = renderPruneTranscript({
      status: "aborted",
      runId: "2025",
      specPath: "specs/demo.md",
      runPath: ".voratiq/runs/2025",
    });

    expect(transcript).toContain("Prune aborted; no changes were made.");
    expect(transcript).toContain("voratiq prune --run 2025");
  });

  it("renders success output", () => {
    const transcript = renderPruneTranscript({
      status: "pruned",
      runId: "2025",
      specPath: "specs/demo.md",
      runPath: ".voratiq/runs/2025",
      createdAt: "2025-11-10T10:00:00.000Z",
      deletedAt: "2025-11-10T11:00:00.000Z",
      workspaces: { removed: [], missing: [] },
      artifacts: { purged: false, removed: [], missing: [] },
      branches: { deleted: [], skipped: [] },
    });

    expect(transcript).toContain("Run pruned successfully.");
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
