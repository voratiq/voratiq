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

import type { StagedAuthContext } from "../../../src/commands/run/agents/auth-stage.js";
import {
  clearActiveRun,
  registerActiveRun,
  terminateActiveRun,
} from "../../../src/commands/run/lifecycle.js";
import * as sandboxRegistry from "../../../src/commands/run/sandbox-registry.js";
import {
  disposeRunRecordBuffer,
  getRunRecordSnapshot,
  rewriteRunRecord,
} from "../../../src/records/persistence.js";
import type { RunRecord } from "../../../src/records/types.js";
import { pathExists } from "../../../src/utils/fs.js";
import { preserveProviderChatTranscripts } from "../../../src/workspace/chat/artifacts.js";

jest.mock("../../../src/records/persistence.js", () => ({
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
  jest.setSystemTime(abortInstant);
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
  await sandboxRegistry.teardownRunSandboxes(RUN_ID).catch(() => {});
});

describe("terminateActiveRun", () => {
  it("rewrites queued and running agents to aborted snapshots", async () => {
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/runs/index.json",
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
          evals: [
            {
              slug: "checks",
              status: "succeeded",
            },
          ],
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
    expect(record.deletedAt).toBeNull();

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

  it("tears down staged sandboxes when the run aborts", async () => {
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/runs/index.json",
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
      runId: RUN_ID,
    };
    sandboxRegistry.registerStagedSandboxContext(context);

    await terminateActiveRun("aborted");

    expect(providerTeardown).toHaveBeenCalledTimes(1);
    await expect(pathExists(sandboxPath)).resolves.toBe(false);
  });

  it("preserves chat logs for running agents before rewriting abort status", async () => {
    const agentRoot = "/repo/.voratiq/runs/sessions/run-123/agents/alpha";
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/runs/index.json",
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
    const agentRoot = "/repo/.voratiq/runs/sessions/run-123/agents/alpha";
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/runs/index.json",
      runId: RUN_ID,
      agents: [
        {
          agentId: "alpha",
          providerId: "claude",
          agentRoot,
        },
        {
          agentId: "beta",
          providerId: "gpt",
          agentRoot: "/repo/.voratiq/runs/sessions/run-123/agents/beta",
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

    const originalTeardown = sandboxRegistry.teardownRunSandboxes;
    const teardownSpy = jest
      .spyOn(sandboxRegistry, "teardownRunSandboxes")
      .mockImplementation(async (runId) => {
        order.push("teardown");
        return originalTeardown(runId);
      });

    await terminateActiveRun("aborted");

    expect(order).toContain("capture-claude");
    expect(order).toContain("capture-gpt");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(teardownSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
    teardownSpy.mockRestore();
  });

  it("captures chat logs before tearing down sandboxes", async () => {
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/runs/index.json",
      runId: RUN_ID,
      agents: [
        {
          agentId: "alpha",
          providerId: "claude",
          agentRoot: "/repo/.voratiq/runs/sessions/run-123/agents/alpha",
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

    const callOrder: string[] = [];
    preserveProviderChatTranscriptsMock.mockImplementation(() => {
      callOrder.push("capture");
      return Promise.resolve({ status: "already-exists", format: "jsonl" });
    });

    const originalTeardown = sandboxRegistry.teardownRunSandboxes;
    const teardownSpy = jest
      .spyOn(sandboxRegistry, "teardownRunSandboxes")
      .mockImplementation(async (runId) => {
        callOrder.push("teardown");
        return originalTeardown(runId);
      });

    await terminateActiveRun("aborted");

    expect(callOrder).toEqual(["capture", "teardown"]);

    teardownSpy.mockRestore();
  });

  it("logs and surfaces rewrite failures while still tearing down sandboxes", async () => {
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/runs/index.json",
      runId: RUN_ID,
      agents: [],
    });

    rewriteRunRecordMock.mockRejectedValue(new Error("rewrite failed"));

    const teardownSpy = jest
      .spyOn(sandboxRegistry, "teardownRunSandboxes")
      .mockResolvedValue();
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(terminateActiveRun("aborted")).rejects.toThrow(
      "rewrite failed",
    );

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to finalize run run-123"),
    );
    expect(teardownSpy).toHaveBeenCalledWith(RUN_ID);

    errorSpy.mockRestore();
    teardownSpy.mockRestore();
  });

  it("logs and surfaces disposal failures after finalizing run history", async () => {
    registerActiveRun({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/runs/index.json",
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
});
