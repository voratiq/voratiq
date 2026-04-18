import { EventEmitter } from "node:events";
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

import type { StagedAuthContext } from "../../../src/agents/runtime/auth.js";
import * as sandboxRegistry from "../../../src/agents/runtime/registry.js";
import {
  clearActiveRun,
  finalizeActiveRun,
  markActiveRunRecordPersisted,
  registerActiveRun,
  terminateActiveRun,
} from "../../../src/commands/run/lifecycle.js";
import { createTeardownController } from "../../../src/competition/shared/teardown.js";
import type { RunRecord } from "../../../src/domain/run/model/types.js";
import {
  disposeRunRecordBuffer,
  getRunRecordSnapshot,
  rewriteRunRecord,
} from "../../../src/domain/run/persistence/adapter.js";
import { pathExists } from "../../../src/utils/fs.js";
import { preserveProviderChatTranscripts } from "../../../src/workspace/chat/artifacts.js";

jest.mock("../../../src/domain/run/persistence/adapter.js", () => ({
  rewriteRunRecord: jest.fn(),
  getRunRecordSnapshot: jest.fn(),
  disposeRunRecordBuffer: jest.fn(),
}));

jest.mock("../../../src/workspace/chat/artifacts.js", () => ({
  preserveProviderChatTranscripts: jest.fn(),
}));

const rewriteRunRecordMock = jest.mocked(rewriteRunRecord);
const getRunRecordSnapshotMock = jest.mocked(getRunRecordSnapshot);
const disposeRunRecordBufferMock = jest.mocked(disposeRunRecordBuffer);
const preserveProviderChatTranscriptsMock = jest.mocked(
  preserveProviderChatTranscripts,
);
const RUN_ID = "run-123";
const tempRoots: string[] = [];

let abortTimestamp: string;

beforeEach(() => {
  jest.useFakeTimers();
  const abortInstant = new Date("2025-11-04T19:00:00.000Z");
  jest.setSystemTime(abortInstant.getTime());
  abortTimestamp = abortInstant.toISOString();
  jest.clearAllMocks();
  getRunRecordSnapshotMock.mockResolvedValue(undefined);
  disposeRunRecordBufferMock.mockResolvedValue(undefined);
});

afterEach(async () => {
  jest.useRealTimers();
  clearActiveRun(RUN_ID);
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
  await sandboxRegistry.teardownSessionAuth(RUN_ID).catch(() => {});
});

function createMockChildProcess(
  pid: number,
): import("node:child_process").ChildProcess {
  const child =
    new EventEmitter() as import("node:child_process").ChildProcess &
      EventEmitter;
  Object.assign(child, {
    pid,
    exitCode: null,
    signalCode: null,
  });
  return child;
}

describe("terminateActiveRun", () => {
  it("waits for initial run record persistence before rewriting termination state", async () => {
    let resolveRecordInit!: (persisted: boolean) => void;
    const recordInitPromise = new Promise<boolean>((resolve) => {
      resolveRecordInit = resolve;
    });

    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: RUN_ID,
      recordPersisted: false,
      recordInitPromise,
      agents: [],
    });

    const existingRecord: RunRecord = {
      runId: RUN_ID,
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "running",
      createdAt: "2025-11-04T18:00:00.000Z",
      agents: [],
    };

    rewriteRunRecordMock.mockImplementation(({ mutate }) =>
      Promise.resolve(mutate(existingRecord)),
    );

    const termination = terminateActiveRun("aborted");
    await Promise.resolve();

    expect(rewriteRunRecordMock).not.toHaveBeenCalled();

    markActiveRunRecordPersisted(RUN_ID);
    resolveRecordInit(true);
    await termination;

    expect(rewriteRunRecordMock).toHaveBeenCalledTimes(1);
  });

  it("skips termination rewrite when the initial run record never persisted", async () => {
    let resolveRecordInit!: (persisted: boolean) => void;
    const recordInitPromise = new Promise<boolean>((resolve) => {
      resolveRecordInit = resolve;
    });

    const teardown = createTeardownController(`run \`${RUN_ID}\``);
    const cleanup = jest.fn(() => Promise.resolve());
    teardown.addAction({
      key: "pre-persist-cleanup",
      label: "pre-persist cleanup",
      cleanup,
    });

    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: RUN_ID,
      recordPersisted: false,
      recordInitPromise,
      teardown,
      agents: [],
    });

    const termination = terminateActiveRun("aborted");
    resolveRecordInit(false);
    await termination;

    expect(rewriteRunRecordMock).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not block termination on stalled initial record persistence", async () => {
    const teardown = createTeardownController(`run \`${RUN_ID}\``);
    const cleanup = jest.fn(() => Promise.resolve());
    teardown.addAction({
      key: "stalled-init-cleanup",
      label: "stalled init cleanup",
      cleanup,
    });
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: RUN_ID,
      recordPersisted: false,
      recordInitPromise: new Promise<boolean>(() => {}),
      teardown,
      agents: [],
    });

    const termination = terminateActiveRun("aborted");
    await jest.advanceTimersByTimeAsync(250);
    await termination;

    expect(rewriteRunRecordMock).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Timed out waiting for run run-123 initial record persistence during termination",
      ),
    );

    warnSpy.mockRestore();
  });

  it("rewrites queued and running agents to aborted snapshots", async () => {
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: RUN_ID,
      agents: [],
    });

    const existingRecord: RunRecord = {
      runId: RUN_ID,
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "running",
      createdAt: "2025-11-04T18:00:00.000Z",
      agents: [
        {
          agentId: "alpha",
          model: "gpt-4",
          status: "running",
          startedAt: "2025-11-04T18:15:00.000Z",
          error: "Agent process failed. No workspace changes detected.",
          artifacts: {
            stdoutCaptured: true,
            stderrCaptured: true,
          },
        },
        {
          agentId: "beta",
          model: "gpt-4",
          status: "queued",
        },
        {
          agentId: "gamma",
          model: "gpt-4",
          status: "succeeded",
          startedAt: "2025-11-04T17:00:00.000Z",
          completedAt: "2025-11-04T17:30:00.000Z",
        },
      ],
    };

    let mutatedRecord: RunRecord | undefined;

    rewriteRunRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(existingRecord);
      return Promise.resolve(mutatedRecord);
    });

    await terminateActiveRun("aborted");

    expect(rewriteRunRecordMock).toHaveBeenCalledTimes(1);
    expect(rewriteRunRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN_ID }),
    );
    expect(mutatedRecord).toBeDefined();

    const record = mutatedRecord as RunRecord;
    expect(record).not.toBe(existingRecord);
    expect(record.status).toBe("aborted");

    const runningAgent = record.agents.find(
      (agent) => agent.agentId === "alpha",
    );
    expect(runningAgent).toBeDefined();
    expect(runningAgent?.status).toBe("aborted");
    expect(runningAgent?.startedAt).toBe("2025-11-04T18:15:00.000Z");
    expect(runningAgent?.completedAt).toBe(abortTimestamp);
    expect(runningAgent?.artifacts).toEqual({
      stdoutCaptured: true,
      stderrCaptured: true,
    });
    expect(runningAgent?.warnings).toEqual([
      "Run aborted before agent completed.",
    ]);
    expect(runningAgent?.error).toBeUndefined();

    const queuedAgent = record.agents.find((agent) => agent.agentId === "beta");
    expect(queuedAgent).toBeDefined();
    expect(queuedAgent?.status).toBe("aborted");
    expect(queuedAgent?.startedAt).toBe(abortTimestamp);
    expect(queuedAgent?.completedAt).toBe(abortTimestamp);
    expect(queuedAgent?.warnings).toEqual([
      "Run aborted before agent completed.",
    ]);

    const completedAgent = record.agents.find(
      (agent) => agent.agentId === "gamma",
    );
    expect(completedAgent).toBeDefined();
    expect(completedAgent?.status).toBe("succeeded");
    expect(completedAgent?.warnings).toBeUndefined();
    expect(completedAgent?.completedAt).toBe("2025-11-04T17:30:00.000Z");
  });

  it("only coerces agents that were still pending when abort started", async () => {
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: RUN_ID,
      agents: [],
    });

    const snapshotRecord: RunRecord = {
      runId: RUN_ID,
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "running",
      createdAt: "2025-11-04T18:00:00.000Z",
      agents: [
        {
          agentId: "alpha",
          model: "gpt-4",
          status: "failed",
          startedAt: "2025-11-04T18:01:00.000Z",
          completedAt: "2025-11-04T18:02:00.000Z",
          error: "Authentication failed",
        },
        {
          agentId: "beta",
          model: "gpt-4",
          status: "running",
          startedAt: "2025-11-04T18:03:00.000Z",
        },
      ],
    };

    const persistedAtAbort: RunRecord = {
      ...snapshotRecord,
      agents: [
        snapshotRecord.agents[0],
        {
          agentId: "beta",
          model: "gpt-4",
          status: "failed",
          startedAt: "2025-11-04T18:03:00.000Z",
          completedAt: "2025-11-04T18:05:00.000Z",
          error: "Agent process failed. No workspace changes detected.",
        },
      ],
    };

    getRunRecordSnapshotMock.mockResolvedValue(snapshotRecord);

    let mutatedRecord: RunRecord | undefined;
    rewriteRunRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(persistedAtAbort);
      return Promise.resolve(mutatedRecord);
    });

    await terminateActiveRun("aborted");

    const record = mutatedRecord as RunRecord;
    const alreadyFailed = record.agents.find(
      (agent) => agent.agentId === "alpha",
    );
    const abortedInFlight = record.agents.find(
      (agent) => agent.agentId === "beta",
    );

    expect(alreadyFailed?.status).toBe("failed");
    expect(alreadyFailed?.error).toBe("Authentication failed");

    expect(abortedInFlight?.status).toBe("aborted");
    expect(abortedInFlight?.error).toBeUndefined();
    expect(abortedInFlight?.warnings).toEqual([
      "Run aborted before agent completed.",
    ]);
  });

  it("rewrites queued and running agents to failed snapshots during fatal teardown", async () => {
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: RUN_ID,
      agents: [],
    });

    const existingRecord: RunRecord = {
      runId: RUN_ID,
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "running",
      createdAt: "2025-11-04T18:00:00.000Z",
      agents: [
        {
          agentId: "alpha",
          model: "gpt-4",
          status: "running",
          startedAt: "2025-11-04T18:15:00.000Z",
          artifacts: {
            stdoutCaptured: true,
            stderrCaptured: true,
          },
        },
        {
          agentId: "beta",
          model: "gpt-4",
          status: "queued",
        },
        {
          agentId: "gamma",
          model: "gpt-4",
          status: "succeeded",
          startedAt: "2025-11-04T17:00:00.000Z",
          completedAt: "2025-11-04T17:30:00.000Z",
        },
      ],
    };

    let mutatedRecord: RunRecord | undefined;
    rewriteRunRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(existingRecord);
      return Promise.resolve(mutatedRecord);
    });

    await terminateActiveRun("failed", "uncaught exception");

    const record = mutatedRecord as RunRecord;
    expect(record.status).toBe("failed");

    const runningAgent = record.agents.find(
      (agent) => agent.agentId === "alpha",
    );
    expect(runningAgent?.status).toBe("failed");
    expect(runningAgent?.startedAt).toBe("2025-11-04T18:15:00.000Z");
    expect(runningAgent?.completedAt).toBe(abortTimestamp);
    expect(runningAgent?.error).toBe("uncaught exception");

    const queuedAgent = record.agents.find((agent) => agent.agentId === "beta");
    expect(queuedAgent?.status).toBe("failed");
    expect(queuedAgent?.startedAt).toBe(abortTimestamp);
    expect(queuedAgent?.completedAt).toBe(abortTimestamp);
    expect(queuedAgent?.error).toBe("uncaught exception");

    const completedAgent = record.agents.find(
      (agent) => agent.agentId === "gamma",
    );
    expect(completedAgent?.status).toBe("succeeded");
  });

  it("tears down staged sandboxes when the run aborts", async () => {
    const teardown = createTeardownController(`run \`${RUN_ID}\``);
    teardown.addAction({
      key: `run-auth:${RUN_ID}`,
      label: "session auth",
      cleanup: async () => {
        await sandboxRegistry.teardownSessionAuth(RUN_ID);
      },
    });
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: RUN_ID,
      teardown,
      agents: [],
    });

    const existingRecord: RunRecord = {
      runId: RUN_ID,
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "running",
      createdAt: "2025-11-04T18:00:00.000Z",
      agents: [
        {
          agentId: "alpha",
          model: "gpt-4",
          status: "running",
          startedAt: "2025-11-04T18:15:00.000Z",
          artifacts: {
            stdoutCaptured: true,
            stderrCaptured: true,
          },
        },
      ],
    };

    rewriteRunRecordMock.mockImplementation(({ mutate }) =>
      Promise.resolve(mutate(existingRecord)),
    );

    const sandboxRoot = await mkdtemp(join(tmpdir(), "voratiq-sandbox-"));
    tempRoots.push(sandboxRoot);
    const sandboxPath = join(sandboxRoot, "sandbox");
    await mkdir(sandboxPath, { recursive: true });
    await writeFile(join(sandboxPath, "creds.json"), "{}", "utf8");

    const providerTeardown = jest.fn(() => {
      // Provider leaves files behind; filesystem cleanup removes them.
      return Promise.resolve();
    });

    const context: StagedAuthContext = {
      provider: {
        id: "test-provider",
        verify: () => Promise.resolve({ status: "ok" }),
        stage: () => Promise.resolve({ sandboxPath, env: {} }),
        teardown: providerTeardown,
      },
      sandboxPath,
      runtime: {
        platform: process.platform,
        env: {},
        homeDir: sandboxRoot,
        username: "tester",
      },
      agentId: "alpha",
    };
    sandboxRegistry.registerStagedAuthContext(RUN_ID, context);

    await terminateActiveRun("aborted");

    expect(providerTeardown).toHaveBeenCalledTimes(1);
    await expect(pathExists(sandboxPath)).resolves.toBe(false);
  });

  it("terminates registered session processes before teardown", async () => {
    const child = createMockChildProcess(7331);
    const killSpy = jest.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === -7331 || pid === 7331) {
        Object.assign(child as { signalCode: NodeJS.Signals | null }, {
          signalCode: "SIGTERM",
        });
        child.emit("exit", null, "SIGTERM");
      }
      return true;
    });

    const teardown = createTeardownController(`run \`${RUN_ID}\``);
    teardown.addAction({
      key: `run-auth:${RUN_ID}`,
      label: "session auth",
      cleanup: async () => {
        await sandboxRegistry.teardownSessionAuth(RUN_ID);
      },
    });
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: RUN_ID,
      teardown,
      agents: [],
    });

    sandboxRegistry.registerSessionProcess(RUN_ID, child);

    const existingRecord: RunRecord = {
      runId: RUN_ID,
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "running",
      createdAt: "2025-11-04T18:00:00.000Z",
      agents: [],
    };

    rewriteRunRecordMock.mockImplementation(({ mutate }) =>
      Promise.resolve(mutate(existingRecord)),
    );

    await terminateActiveRun("aborted");

    expect(killSpy).toHaveBeenCalledWith(-7331, "SIGTERM");
    killSpy.mockRestore();
  });

  it("does not rewrite or teardown when session process termination fails", async () => {
    const teardown = createTeardownController(`run \`${RUN_ID}\``);
    const cleanup = jest.fn(() => Promise.resolve());
    teardown.addAction({
      key: "should-not-run",
      label: "should not run",
      cleanup,
    });
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: RUN_ID,
      teardown,
      agents: [
        {
          agentId: "alpha",
          providerId: "claude",
          agentRoot: "/repo/.voratiq/run/sessions/run-123/agents/alpha",
        },
      ],
    });
    const terminateSpy = jest
      .spyOn(sandboxRegistry, "terminateSessionProcesses")
      .mockRejectedValue(
        new Error(
          "Detached agent process 7331 did not exit after SIGTERM and SIGKILL.",
        ),
      );
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(terminateActiveRun("aborted")).rejects.toThrow(
      "Detached agent process 7331 did not exit after SIGTERM and SIGKILL.",
    );
    expect(rewriteRunRecordMock).not.toHaveBeenCalled();
    expect(preserveProviderChatTranscriptsMock).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    terminateSpy.mockRestore();
  });

  it("preserves chat logs for running agents before rewriting abort status", async () => {
    const agentRoot = "/repo/.voratiq/run/sessions/run-123/agents/alpha";
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: RUN_ID,
      agents: [
        {
          agentId: "alpha",
          providerId: "claude",
          agentRoot,
        },
      ],
    });

    const existingRecord: RunRecord = {
      runId: RUN_ID,
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "running",
      createdAt: "2025-11-04T18:00:00.000Z",
      agents: [
        {
          agentId: "alpha",
          model: "gpt-4",
          status: "running",
          startedAt: "2025-11-04T18:15:00.000Z",
          artifacts: {
            stdoutCaptured: true,
            stderrCaptured: true,
          },
        },
      ],
    };

    getRunRecordSnapshotMock.mockResolvedValue(existingRecord);

    preserveProviderChatTranscriptsMock.mockResolvedValue({
      status: "captured",
      format: "jsonl",
    });

    let mutatedRecord: RunRecord | undefined;
    rewriteRunRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(existingRecord);
      return Promise.resolve(mutatedRecord);
    });

    await terminateActiveRun("aborted");

    expect(preserveProviderChatTranscriptsMock).toHaveBeenCalledWith({
      providerId: "claude",
      agentRoot,
    });

    expect(mutatedRecord?.agents[0]?.artifacts).toEqual({
      stdoutCaptured: true,
      stderrCaptured: true,
      chatCaptured: true,
      chatFormat: "jsonl",
    });
  });

  it("ignores not-found results and logs capture errors without blocking abort", async () => {
    const order: string[] = [];
    const teardown = createTeardownController(`run \`${RUN_ID}\``);
    teardown.addAction({
      key: "teardown-order",
      label: "teardown order",
      cleanup: () => {
        order.push("teardown");
        return Promise.resolve();
      },
    });
    const agentRoot = "/repo/.voratiq/run/sessions/run-123/agents/alpha";
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: RUN_ID,
      teardown,
      agents: [
        {
          agentId: "alpha",
          providerId: "claude",
          agentRoot,
        },
        {
          agentId: "beta",
          providerId: "gpt",
          agentRoot: "/repo/.voratiq/run/sessions/run-123/agents/beta",
        },
      ],
    });

    const existingRecord: RunRecord = {
      runId: RUN_ID,
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "running",
      createdAt: "2025-11-04T18:00:00.000Z",
      agents: [
        {
          agentId: "alpha",
          model: "gpt-4",
          status: "running",
        },
        {
          agentId: "beta",
          model: "gpt-4",
          status: "queued",
        },
      ],
    };
    getRunRecordSnapshotMock.mockResolvedValue(existingRecord);

    preserveProviderChatTranscriptsMock.mockImplementation(({ providerId }) => {
      order.push(`capture-${providerId}`);
      if (providerId === "claude") {
        return Promise.resolve({ status: "not-found" });
      }
      return Promise.resolve({
        status: "error",
        error: new Error("boom"),
      });
    });

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    rewriteRunRecordMock.mockImplementation(({ mutate }) =>
      Promise.resolve(mutate(existingRecord)),
    );

    await terminateActiveRun("aborted");

    expect(order).toContain("capture-claude");
    expect(order).toContain("capture-gpt");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(order).toContain("teardown");

    warnSpy.mockRestore();
  });

  it("captures chat logs before tearing down sandboxes", async () => {
    const callOrder: string[] = [];
    const teardown = createTeardownController(`run \`${RUN_ID}\``);
    teardown.addAction({
      key: "capture-before-teardown",
      label: "capture before teardown",
      cleanup: () => {
        callOrder.push("teardown");
        return Promise.resolve();
      },
    });
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: RUN_ID,
      teardown,
      agents: [
        {
          agentId: "alpha",
          providerId: "claude",
          agentRoot: "/repo/.voratiq/run/sessions/run-123/agents/alpha",
        },
      ],
    });

    const existingRecord: RunRecord = {
      runId: RUN_ID,
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "running",
      createdAt: "2025-11-04T18:00:00.000Z",
      agents: [
        {
          agentId: "alpha",
          model: "gpt-4",
          status: "running",
        },
      ],
    };
    getRunRecordSnapshotMock.mockResolvedValue(existingRecord);
    rewriteRunRecordMock.mockImplementation(({ mutate }) =>
      Promise.resolve(mutate(existingRecord)),
    );

    preserveProviderChatTranscriptsMock.mockImplementation(() => {
      callOrder.push("capture");
      return Promise.resolve({ status: "already-exists", format: "jsonl" });
    });

    await terminateActiveRun("aborted");

    expect(callOrder).toEqual(["capture", "teardown"]);
  });

  it("captures chat logs during fatal teardown before scratch cleanup", async () => {
    const callOrder: string[] = [];
    const teardown = createTeardownController(`run \`${RUN_ID}\``);
    teardown.addAction({
      key: "fatal-capture-before-teardown",
      label: "fatal capture before teardown",
      cleanup: () => {
        callOrder.push("teardown");
        return Promise.resolve();
      },
    });
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: RUN_ID,
      teardown,
      agents: [
        {
          agentId: "alpha",
          providerId: "claude",
          agentRoot: "/repo/.voratiq/run/sessions/run-123/agents/alpha",
        },
      ],
    });

    const existingRecord: RunRecord = {
      runId: RUN_ID,
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "running",
      createdAt: "2025-11-04T18:00:00.000Z",
      agents: [
        {
          agentId: "alpha",
          model: "gpt-4",
          status: "running",
        },
      ],
    };
    getRunRecordSnapshotMock.mockResolvedValue(existingRecord);
    rewriteRunRecordMock.mockImplementation(({ mutate }) =>
      Promise.resolve(mutate(existingRecord)),
    );

    preserveProviderChatTranscriptsMock.mockImplementation(() => {
      callOrder.push("capture");
      return Promise.resolve({ status: "captured", format: "jsonl" });
    });

    await terminateActiveRun("failed", "uncaught exception");

    expect(callOrder).toEqual(["capture", "teardown"]);
  });

  it("logs and surfaces rewrite failures while still tearing down sandboxes", async () => {
    const teardown = createTeardownController(`run \`${RUN_ID}\``);
    const teardownSpy = jest.fn(() => Promise.resolve());
    teardown.addAction({
      key: "rewrite-failure-teardown",
      label: "rewrite failure teardown",
      cleanup: teardownSpy,
    });
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: RUN_ID,
      teardown,
      agents: [],
    });

    rewriteRunRecordMock.mockRejectedValue(new Error("rewrite failed"));

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(terminateActiveRun("aborted")).rejects.toThrow(
      "rewrite failed",
    );

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to finalize run run-123"),
    );
    expect(teardownSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it("logs and surfaces disposal failures after finalizing run history", async () => {
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: RUN_ID,
      agents: [],
    });

    const existingRecord: RunRecord = {
      runId: RUN_ID,
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "running",
      createdAt: "2025-11-04T18:00:00.000Z",
      agents: [],
    };

    rewriteRunRecordMock.mockImplementation(({ mutate }) =>
      Promise.resolve(mutate(existingRecord)),
    );

    disposeRunRecordBufferMock.mockRejectedValue(new Error("dispose failed"));

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(terminateActiveRun("aborted")).rejects.toThrow(
      "dispose failed",
    );

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to dispose run run-123 record buffer"),
    );

    errorSpy.mockRestore();
  });

  it("prunes run workspace scratch state while retaining artifacts on finalization", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-run-finalize-"));
    tempRoots.push(root);
    const agentRoot = join(
      root,
      ".voratiq",
      "runs",
      "sessions",
      RUN_ID,
      "alpha",
    );
    const workspacePath = join(agentRoot, "workspace");
    const artifactsPath = join(agentRoot, "artifacts");
    const contextPath = join(agentRoot, "context");
    const runtimePath = join(agentRoot, "runtime");
    const sandboxPath = join(agentRoot, "sandbox");

    await mkdir(workspacePath, { recursive: true });
    await mkdir(artifactsPath, { recursive: true });
    await mkdir(contextPath, { recursive: true });
    await mkdir(runtimePath, { recursive: true });
    await mkdir(sandboxPath, { recursive: true });

    const teardown = createTeardownController(`run \`${RUN_ID}\``);
    teardown.addPath(workspacePath, "alpha workspace");
    teardown.addPath(contextPath, "alpha context");
    teardown.addPath(runtimePath, "alpha runtime");
    teardown.addPath(sandboxPath, "alpha sandbox");

    registerActiveRun({
      root,
      runsFilePath: join(root, ".voratiq", "runs", "index.json"),
      runId: RUN_ID,
      teardown,
      agents: [],
    });

    await finalizeActiveRun(RUN_ID);

    await expect(pathExists(workspacePath)).resolves.toBe(false);
    await expect(pathExists(artifactsPath)).resolves.toBe(true);
    await expect(pathExists(contextPath)).resolves.toBe(false);
    await expect(pathExists(runtimePath)).resolves.toBe(false);
    await expect(pathExists(sandboxPath)).resolves.toBe(false);
  });

  it("reports teardown diagnostics without failing successful finalization", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const teardown = createTeardownController(`run \`${RUN_ID}\``);
    teardown.addAction({
      key: "broken-cleanup",
      label: "broken cleanup",
      cleanup: () => Promise.reject(new Error("boom")),
    });

    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId: RUN_ID,
      teardown,
      agents: [],
    });

    await expect(finalizeActiveRun(RUN_ID)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to teardown run `run-123`"),
    );

    warnSpy.mockRestore();
  });
});
