import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import {
  createTeardownController,
  registerScratchWorkspaceTeardownPaths,
  runTeardown,
} from "../../../src/competition/shared/teardown.js";
import {
  branchExists,
  deleteBranch,
  pruneWorktrees,
  removeWorktree,
} from "../../../src/utils/git.js";

jest.mock("../../../src/utils/git.js", () => ({
  branchExists: jest.fn(),
  deleteBranch: jest.fn(),
  getGitStderr: jest.fn(),
  pruneWorktrees: jest.fn(),
  removeWorktree: jest.fn(),
}));

const branchExistsMock = jest.mocked(branchExists);
const deleteBranchMock = jest.mocked(deleteBranch);
const pruneWorktreesMock = jest.mocked(pruneWorktrees);
const removeWorktreeMock = jest.mocked(removeWorktree);

describe("registerScratchWorkspaceTeardownPaths", () => {
  it("registers scratch workspace paths with stable labels", () => {
    const teardown = createTeardownController("test");

    registerScratchWorkspaceTeardownPaths(
      teardown,
      {
        workspacePath: "/tmp/workspace",
        contextPath: "/tmp/context",
        runtimePath: "/tmp/runtime",
        sandboxPath: "/tmp/sandbox",
      },
      "agent-a",
    );

    expect(teardown.listResources()).toEqual([
      {
        kind: "path",
        path: "/tmp/workspace",
        label: "agent-a workspace",
      },
      {
        kind: "path",
        path: "/tmp/context",
        label: "agent-a context",
      },
      {
        kind: "path",
        path: "/tmp/runtime",
        label: "agent-a runtime",
      },
      {
        kind: "path",
        path: "/tmp/sandbox",
        label: "agent-a sandbox",
      },
    ]);
  });
});

describe("runTeardown", () => {
  let tempRoot: string;

  beforeEach(() => {
    jest.clearAllMocks();
    branchExistsMock.mockResolvedValue(true);
    deleteBranchMock.mockResolvedValue(undefined);
    pruneWorktreesMock.mockResolvedValue(undefined);
    removeWorktreeMock.mockResolvedValue(undefined);
  });

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "voratiq-teardown-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("removes a worktree before deleting its branch", async () => {
    const teardown = createTeardownController("run `run-123`");
    teardown.addWorktree({
      root: "/repo",
      worktreePath: "/repo/.voratiq/run/sessions/run-123/alpha/workspace",
      label: "alpha workspace",
    });
    teardown.addBranch({
      root: "/repo",
      branch: "voratiq/run/run-123/alpha",
      worktreePath: "/repo/.voratiq/run/sessions/run-123/alpha/workspace",
      label: "alpha branch",
    });

    await runTeardown(teardown);

    expect(removeWorktreeMock).toHaveBeenCalledWith({
      root: "/repo",
      worktreePath: "/repo/.voratiq/run/sessions/run-123/alpha/workspace",
    });
    expect(pruneWorktreesMock).toHaveBeenCalledWith("/repo");
    expect(branchExistsMock).toHaveBeenCalledWith(
      "/repo",
      "voratiq/run/run-123/alpha",
    );
    expect(deleteBranchMock).toHaveBeenCalledWith({
      root: "/repo",
      branch: "voratiq/run/run-123/alpha",
    });

    const worktreeCall =
      removeWorktreeMock.mock.invocationCallOrder[0] ??
      Number.POSITIVE_INFINITY;
    const branchCall =
      deleteBranchMock.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY;
    expect(worktreeCall).toBeLessThan(branchCall);
  });

  it("skips branch deletion when the branch no longer exists", async () => {
    branchExistsMock.mockResolvedValue(false);
    const teardown = createTeardownController("run `run-123`");
    teardown.addBranch({
      root: "/repo",
      branch: "voratiq/run/run-123/alpha",
      label: "alpha branch",
    });

    await runTeardown(teardown);

    expect(pruneWorktreesMock).toHaveBeenCalledWith("/repo");
    expect(deleteBranchMock).not.toHaveBeenCalled();
  });

  it("deletes the branch when direct worktree fallback succeeds", async () => {
    removeWorktreeMock.mockRejectedValue(new Error("worktree is busy"));
    const worktreePath = join(tempRoot, "busy-workspace");
    await mkdir(worktreePath, { recursive: true });
    await writeFile(join(worktreePath, "leftover.txt"), "busy", "utf8");
    const teardown = createTeardownController("run `run-123`");
    teardown.addWorktree({
      root: "/repo",
      worktreePath,
      label: "alpha workspace",
    });
    teardown.addBranch({
      root: "/repo",
      branch: "voratiq/run/run-123/alpha",
      worktreePath,
      label: "alpha branch",
    });

    await runTeardown(teardown);

    expect(deleteBranchMock).toHaveBeenCalledWith({
      root: "/repo",
      branch: "voratiq/run/run-123/alpha",
    });
  });

  it("falls back to direct removal when git worktree teardown fails", async () => {
    const worktreePath = join(tempRoot, "workspace");
    await mkdir(worktreePath, { recursive: true });
    await writeFile(join(worktreePath, "node_modules"), "leftover", "utf8");

    removeWorktreeMock.mockRejectedValue(new Error("Directory not empty"));

    const teardown = createTeardownController("run `run-123`");
    teardown.addWorktree({
      root: "/repo",
      worktreePath,
      label: "alpha workspace",
    });
    teardown.addBranch({
      root: "/repo",
      branch: "voratiq/run/run-123/alpha",
      worktreePath,
      label: "alpha branch",
    });

    const diagnostics = await runTeardown(teardown);

    expect(diagnostics).toHaveLength(0);
    await expect(rm(worktreePath, { recursive: false })).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(pruneWorktreesMock).toHaveBeenCalledWith("/repo");
    expect(deleteBranchMock).toHaveBeenCalledWith({
      root: "/repo",
      branch: "voratiq/run/run-123/alpha",
    });
  });
});
