import type { ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
  clearActiveInteractive,
  finalizeActiveInteractive,
  registerActiveInteractive,
  terminateActiveInteractive,
} from "../../../src/commands/interactive/lifecycle.js";
import { createTeardownController } from "../../../src/competition/shared/teardown.js";
import type { InteractiveSessionRecord } from "../../../src/domain/interactive/model/types.js";
import {
  disposeInteractiveSessionBuffer,
  getInteractiveSessionRecordSnapshot,
  rewriteInteractiveSessionRecord,
} from "../../../src/domain/interactive/persistence/adapter.js";
import { pathExists } from "../../../src/utils/fs.js";

jest.mock("../../../src/domain/interactive/persistence/adapter.js", () => ({
  disposeInteractiveSessionBuffer: jest.fn(),
  getInteractiveSessionRecordSnapshot: jest.fn(),
  rewriteInteractiveSessionRecord: jest.fn(),
}));

const disposeInteractiveSessionBufferMock = jest.mocked(
  disposeInteractiveSessionBuffer,
);
const getInteractiveSessionRecordSnapshotMock = jest.mocked(
  getInteractiveSessionRecordSnapshot,
);
const rewriteInteractiveSessionRecordMock = jest.mocked(
  rewriteInteractiveSessionRecord,
);

const SESSION_ID = "interactive-123";
const tempRoots: string[] = [];

describe("interactive lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    disposeInteractiveSessionBufferMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearActiveInteractive(SESSION_ID);
    return Promise.all(
      tempRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    ).then(() => undefined);
  });

  it("marks a running interactive session succeeded during user termination", async () => {
    const killMock = jest.fn((signal?: NodeJS.Signals | number) => {
      void signal;
      return true;
    });
    const process = createMockProcess({ kill: killMock });
    const existingRecord: InteractiveSessionRecord = {
      sessionId: SESSION_ID,
      createdAt: "2026-04-02T00:00:00.000Z",
      status: "running",
      agentId: "codex-test",
      toolAttachmentStatus: "attached",
    };
    const runtimeRoot = await mkdtemp(join(tmpdir(), "voratiq-interactive-"));
    tempRoots.push(runtimeRoot);
    const runtimePath = join(runtimeRoot, "runtime");
    await mkdir(runtimePath, { recursive: true });
    const teardown = createTeardownController(`interactive \`${SESSION_ID}\``);
    teardown.addPath(runtimePath, "interactive runtime");

    registerActiveInteractive({
      root: "/repo",
      sessionId: SESSION_ID,
      process,
      teardown,
    });

    getInteractiveSessionRecordSnapshotMock.mockResolvedValue(existingRecord);

    let mutatedRecord: InteractiveSessionRecord | undefined;
    rewriteInteractiveSessionRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(existingRecord);
      return Promise.resolve(mutatedRecord);
    });

    await terminateActiveInteractive("aborted", "SIGINT");

    expect(killMock).toHaveBeenCalledWith("SIGTERM");
    expect(getInteractiveSessionRecordSnapshotMock).toHaveBeenCalledWith({
      root: "/repo",
      sessionId: SESSION_ID,
    });
    expect(rewriteInteractiveSessionRecordMock).toHaveBeenCalledTimes(1);
    expect(mutatedRecord).toMatchObject({
      status: "succeeded",
    });
    expect(disposeInteractiveSessionBufferMock).toHaveBeenCalledWith({
      root: "/repo",
      sessionId: SESSION_ID,
    });
    await expect(pathExists(runtimePath)).resolves.toBe(false);
  });

  it("marks a running interactive session failed during harness failure", async () => {
    const killMock = jest.fn((signal?: NodeJS.Signals | number) => {
      void signal;
      return true;
    });
    const process = createMockProcess({ kill: killMock });
    const existingRecord: InteractiveSessionRecord = {
      sessionId: SESSION_ID,
      createdAt: "2026-04-02T00:00:00.000Z",
      status: "running",
      agentId: "codex-test",
      toolAttachmentStatus: "attached",
    };

    registerActiveInteractive({
      root: "/repo",
      sessionId: SESSION_ID,
      process,
    });

    getInteractiveSessionRecordSnapshotMock.mockResolvedValue(existingRecord);

    let mutatedRecord: InteractiveSessionRecord | undefined;
    rewriteInteractiveSessionRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(existingRecord);
      return Promise.resolve(mutatedRecord);
    });

    await terminateActiveInteractive("failed", "uncaught exception");

    expect(killMock).toHaveBeenCalledWith("SIGTERM");
    expect(rewriteInteractiveSessionRecordMock).toHaveBeenCalledTimes(1);
    expect(mutatedRecord).toMatchObject({
      status: "failed",
      error: {
        code: "provider_launch_failed",
        message: "Interactive session failed after uncaught exception.",
      },
    });
  });

  it("disposes the record buffer without rewriting when the session already completed", async () => {
    registerActiveInteractive({
      root: "/repo",
      sessionId: SESSION_ID,
      process: createMockProcess({ exitCode: 0 }),
      completion: Promise.resolve({
        sessionId: SESSION_ID,
        createdAt: "2026-04-02T00:00:00.000Z",
        status: "failed",
        agentId: "claude-test",
        toolAttachmentStatus: "attached",
        error: {
          code: "provider_launch_failed",
          message: "done",
        },
      }),
    });

    getInteractiveSessionRecordSnapshotMock.mockResolvedValue({
      sessionId: SESSION_ID,
      createdAt: "2026-04-02T00:00:00.000Z",
      status: "failed",
      agentId: "claude-test",
      toolAttachmentStatus: "attached",
      error: {
        code: "provider_launch_failed",
        message: "done",
      },
    });

    await terminateActiveInteractive("failed", "uncaught exception");

    expect(rewriteInteractiveSessionRecordMock).not.toHaveBeenCalled();
    expect(disposeInteractiveSessionBufferMock).toHaveBeenCalledWith({
      root: "/repo",
      sessionId: SESSION_ID,
    });
  });

  it("preserves a succeeded session when completion wins the termination race", async () => {
    const killMock = jest.fn((signal?: NodeJS.Signals | number) => {
      void signal;
      return true;
    });
    const process = createMockProcess({ kill: killMock });
    const completedRecord: InteractiveSessionRecord = {
      sessionId: SESSION_ID,
      createdAt: "2026-04-02T00:00:00.000Z",
      status: "succeeded",
      agentId: "claude-test",
      toolAttachmentStatus: "attached",
    };

    registerActiveInteractive({
      root: "/repo",
      sessionId: SESSION_ID,
      process,
      completion: new Promise<InteractiveSessionRecord>((resolve) => {
        setTimeout(() => {
          resolve(completedRecord);
        }, 0);
      }),
    });

    getInteractiveSessionRecordSnapshotMock.mockResolvedValue(completedRecord);

    await terminateActiveInteractive("aborted", "SIGHUP");

    expect(killMock).toHaveBeenCalledWith("SIGTERM");
    expect(rewriteInteractiveSessionRecordMock).not.toHaveBeenCalled();
    expect(disposeInteractiveSessionBufferMock).toHaveBeenCalledWith({
      root: "/repo",
      sessionId: SESSION_ID,
    });
  });

  it("disposes the interactive record buffer on normal finalization", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "voratiq-interactive-"));
    tempRoots.push(runtimeRoot);
    const runtimePath = join(runtimeRoot, "runtime");
    await mkdir(runtimePath, { recursive: true });
    const teardown = createTeardownController(`interactive \`${SESSION_ID}\``);
    teardown.addPath(runtimePath, "interactive runtime");

    registerActiveInteractive({
      root: "/repo",
      sessionId: SESSION_ID,
      process: createMockProcess({ exitCode: 0 }),
      teardown,
    });

    await finalizeActiveInteractive(SESSION_ID);

    expect(disposeInteractiveSessionBufferMock).toHaveBeenCalledWith({
      root: "/repo",
      sessionId: SESSION_ID,
    });
    await expect(pathExists(runtimePath)).resolves.toBe(false);

    await terminateActiveInteractive("failed", "uncaught exception");
    expect(getInteractiveSessionRecordSnapshotMock).not.toHaveBeenCalled();
  });
});

function createMockProcess(
  options: {
    exitCode?: number | null;
    signalCode?: NodeJS.Signals | null;
    kill?: (signal?: NodeJS.Signals | number) => boolean;
  } = {},
): ChildProcess {
  return {
    exitCode: options.exitCode ?? null,
    signalCode: options.signalCode ?? null,
    kill: options.kill ?? jest.fn(() => true),
  } as unknown as ChildProcess;
}
