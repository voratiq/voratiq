import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, jest } from "@jest/globals";

import {
  clearActiveRun,
  registerActiveRun,
  terminateActiveRun,
} from "../../src/commands/run/lifecycle.js";
import {
  appendRunRecord,
  flushAllRunRecordBuffers,
  rewriteRunRecord,
} from "../../src/runs/records/persistence.js";
import type {
  RunApplyStatus,
  RunRecord,
} from "../../src/runs/records/types.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../support/factories/run-records.js";

describe("run applyStatus persistence", () => {
  const tempRoots: string[] = [];
  const runId = "run-apply-status-persisted";
  const agentId = "agent-apply-status";

  afterEach(async () => {
    jest.useRealTimers();
    clearActiveRun(runId);
    await flushAllRunRecordBuffers();
    await Promise.all(
      tempRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("preserves applyStatus from disk when aborting with a buffered record", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-27T17:10:00.000Z"));

    const root = await mkdtemp(join(tmpdir(), "voratiq-apply-status-"));
    tempRoots.push(root);

    const runsFilePath = join(root, ".voratiq", "runs", "index.json");
    await mkdir(join(root, ".voratiq", "runs"), { recursive: true });

    const runningAgent = createAgentInvocationRecord({
      agentId,
      model: "gpt-5",
      status: "running",
      startedAt: "2026-01-27T17:00:00.000Z",
      completedAt: undefined,
    });

    const record = createRunRecord({
      runId,
      status: "running",
      agents: [runningAgent],
    });

    await appendRunRecord({ root, runsFilePath, record });

    const recordPath = join(
      root,
      ".voratiq",
      "runs",
      "sessions",
      runId,
      "record.json",
    );

    // Mutate the buffered record without flushing so the in-memory state is stale.
    await rewriteRunRecord({
      root,
      runsFilePath,
      runId,
      mutate: (existing) => ({
        ...existing,
        agents: existing.agents.map((agent) => ({
          ...agent,
          warnings: [...(agent.warnings ?? []), "buffered-update"],
        })),
      }),
    });

    const diskRecordBeforeApply = await readRunRecord(recordPath);
    expect(diskRecordBeforeApply.applyStatus).toBeUndefined();

    // Simulate an external apply operation writing applyStatus directly to disk.
    const applyStatus: RunApplyStatus = {
      agentId,
      status: "succeeded",
      appliedAt: "2026-01-27T17:05:00.000Z",
      ignoredBaseMismatch: false,
    };

    await writeRunRecord(recordPath, {
      ...diskRecordBeforeApply,
      applyStatus,
    });

    registerActiveRun({ root, runsFilePath, runId });
    await terminateActiveRun("aborted");

    const diskRecordAfterAbort = await readRunRecord(recordPath);
    expect(diskRecordAfterAbort.status).toBe("aborted");
    expect(diskRecordAfterAbort.applyStatus).toEqual(applyStatus);
  });
});

async function readRunRecord(path: string): Promise<RunRecord> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as RunRecord;
}

async function writeRunRecord(path: string, record: RunRecord): Promise<void> {
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}
