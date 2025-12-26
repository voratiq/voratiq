import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendRunRecord,
  disposeRunRecordBuffer,
  flushAllRunRecordBuffers,
  rewriteRunRecord,
} from "../../src/runs/records/persistence.js";
import type { RunRecord } from "../../src/runs/records/types.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../support/factories/run-records.js";
import { snapshotRunRecordBuffers } from "../support/hooks/run-records.js";

describe("run history writer", () => {
  let root: string;
  let runsFilePath: string;
  let recordPath: string;
  const runId = "run-buffered";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "voratiq-writer-"));
    runsFilePath = join(root, ".voratiq", "runs", "index.json");
    await mkdir(join(root, ".voratiq", "runs"), { recursive: true });
    const record = createRunRecord({ runId, status: "running", agents: [] });
    await appendRunRecord({ root, runsFilePath, record });
    recordPath = join(
      root,
      ".voratiq",
      "runs",
      "sessions",
      runId,
      "record.json",
    );
  });

  afterEach(async () => {
    await flushAllRunRecordBuffers();
    await rm(root, { recursive: true, force: true });
  });

  it("buffers running-state updates until pending data is flushed", async () => {
    await rewriteRunRecord({
      root,
      runsFilePath,
      runId,
      mutate: (record) => ({
        ...record,
        agents: [
          ...record.agents,
          createAgentInvocationRecord({
            agentId: "alpha",
            model: "gpt-4",
            status: "running",
            startedAt: "2025-10-22T12:00:00.000Z",
            completedAt: undefined,
          }),
        ],
      }),
    });

    const pendingSnapshot = await readRecord(recordPath);
    expect(pendingSnapshot.agents).toHaveLength(0);

    await flushAllRunRecordBuffers();
    await settleAsync();
    const flushedSnapshot = await readRecord(recordPath);
    expect(flushedSnapshot.agents).toHaveLength(1);
    expect(flushedSnapshot.agents[0]?.agentId).toBe("alpha");
  });

  it("flushes pending data when flushAllRunRecordBuffers is invoked", async () => {
    await rewriteRunRecord({
      root,
      runsFilePath,
      runId,
      mutate: (record) => ({
        ...record,
        status: "failed",
      }),
    });

    await flushAllRunRecordBuffers();
    await settleAsync();

    const flushedSnapshot = await readRecord(recordPath);
    expect(flushedSnapshot.status).toBe("failed");
  });

  it("disposes buffer entries once runs reach a terminal status", async () => {
    await rewriteRunRecord({
      root,
      runsFilePath,
      runId,
      mutate: (record) => ({
        ...record,
        status: "failed",
      }),
    });

    expect(snapshotRunRecordBuffers()).toHaveLength(0);
  });

  it("cancels pending flush timers when buffers are disposed", async () => {
    jest.useFakeTimers();

    try {
      await rewriteRunRecord({
        root,
        runsFilePath,
        runId,
        mutate: (record) => ({
          ...record,
          agents: [
            ...record.agents,
            createAgentInvocationRecord({
              agentId: "beta",
              model: "gpt-4",
              status: "running",
              startedAt: "2025-10-22T12:00:00.000Z",
              completedAt: undefined,
            }),
          ],
        }),
      });

      expect(jest.getTimerCount()).toBe(1);

      await disposeRunRecordBuffer({ runsFilePath, runId });

      expect(snapshotRunRecordBuffers()).toHaveLength(0);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not retain buffers after repeated rewrites of completed runs", async () => {
    await rewriteRunRecord({
      root,
      runsFilePath,
      runId,
      mutate: (record) => ({
        ...record,
        status: "failed",
      }),
    });

    expect(snapshotRunRecordBuffers()).toHaveLength(0);

    const deletedAt = "2025-11-18T18:00:00.000Z";
    await rewriteRunRecord({
      root,
      runsFilePath,
      runId,
      mutate: (record) => ({
        ...record,
        deletedAt,
      }),
    });

    expect(snapshotRunRecordBuffers()).toHaveLength(0);
    const flushedSnapshot = await readRecord(recordPath);
    expect(flushedSnapshot.deletedAt).toBe(deletedAt);
  });
});

async function readRecord(path: string): Promise<RunRecord> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as RunRecord;
}

async function settleAsync(): Promise<void> {
  await Promise.resolve();
}
