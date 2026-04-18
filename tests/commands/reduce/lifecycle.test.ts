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
  clearActiveReduce,
  finalizeActiveReduce,
  REDUCE_ABORT_DETAIL,
  REDUCE_FAILURE_DETAIL,
  registerActiveReduce,
  terminateActiveReduce,
} from "../../../src/commands/reduce/lifecycle.js";
import { createTeardownController } from "../../../src/competition/shared/teardown.js";
import type { ReductionRecord } from "../../../src/domain/reduce/model/types.js";
import {
  appendReductionRecord,
  flushReductionRecordBuffer,
  readReductionRecords,
  rewriteReductionRecord,
} from "../../../src/domain/reduce/persistence/adapter.js";
import { SessionRecordMutationError } from "../../../src/persistence/errors.js";
import { pathExists } from "../../../src/utils/fs.js";

jest.mock("../../../src/domain/reduce/persistence/adapter.js", () => ({
  appendReductionRecord: jest.fn(),
  flushReductionRecordBuffer: jest.fn(),
  readReductionRecords: jest.fn(),
  rewriteReductionRecord: jest.fn(),
}));

const appendReductionRecordMock = jest.mocked(appendReductionRecord);
const flushReductionRecordBufferMock = jest.mocked(flushReductionRecordBuffer);
const readReductionRecordsMock = jest.mocked(readReductionRecords);
const rewriteReductionRecordMock = jest.mocked(rewriteReductionRecord);

describe("reduce lifecycle", () => {
  const REDUCTION_ID = "reduce-123";
  const tempRoots: string[] = [];
  let completionTimestamp: string;

  beforeEach(() => {
    jest.useFakeTimers();
    const completionTime = new Date("2026-04-17T19:00:00.000Z");
    jest.setSystemTime(completionTime.getTime());
    completionTimestamp = completionTime.toISOString();
    jest.clearAllMocks();
    appendReductionRecordMock.mockResolvedValue(undefined);
    flushReductionRecordBufferMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    clearActiveReduce(REDUCTION_ID);
    return Promise.all(
      tempRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    ).then(() => undefined);
  });

  it("marks queued and running reducers aborted and flushes the record", async () => {
    const teardown = createTeardownController(`reduce \`${REDUCTION_ID}\``);
    const cleanup = jest.fn(() => Promise.resolve());
    teardown.addAction({
      key: `reduce-cleanup:${REDUCTION_ID}`,
      label: "reduce cleanup",
      cleanup,
    });

    registerActiveReduce({
      root: "/repo",
      reductionsFilePath: "/repo/.voratiq/reduce/index.json",
      reductionId: REDUCTION_ID,
      teardown,
    });

    const existingRecord: ReductionRecord = {
      sessionId: REDUCTION_ID,
      target: { type: "run", id: "run-123" },
      createdAt: "2026-04-17T18:00:00.000Z",
      startedAt: "2026-04-17T18:00:05.000Z",
      status: "running",
      reducers: [
        {
          agentId: "agent-a",
          status: "queued",
          outputPath:
            ".voratiq/reduce/sessions/reduce-123/agent-a/artifacts/reduction.md",
          dataPath:
            ".voratiq/reduce/sessions/reduce-123/agent-a/artifacts/reduction.json",
        },
        {
          agentId: "agent-b",
          status: "running",
          startedAt: "2026-04-17T18:10:00.000Z",
          outputPath:
            ".voratiq/reduce/sessions/reduce-123/agent-b/artifacts/reduction.md",
          dataPath:
            ".voratiq/reduce/sessions/reduce-123/agent-b/artifacts/reduction.json",
        },
        {
          agentId: "agent-c",
          status: "succeeded",
          startedAt: "2026-04-17T18:08:00.000Z",
          completedAt: "2026-04-17T18:20:00.000Z",
          outputPath:
            ".voratiq/reduce/sessions/reduce-123/agent-c/artifacts/reduction.md",
          dataPath:
            ".voratiq/reduce/sessions/reduce-123/agent-c/artifacts/reduction.json",
          error: null,
        },
      ],
      error: null,
    };

    readReductionRecordsMock.mockResolvedValue([existingRecord]);

    let mutatedRecord: ReductionRecord | undefined;
    rewriteReductionRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(existingRecord);
      return Promise.resolve(mutatedRecord);
    });

    await terminateActiveReduce("aborted");

    expect(readReductionRecordsMock).toHaveBeenCalledTimes(1);
    expect(rewriteReductionRecordMock).toHaveBeenCalledTimes(1);
    expect(flushReductionRecordBufferMock).toHaveBeenCalledWith({
      reductionsFilePath: "/repo/.voratiq/reduce/index.json",
      sessionId: REDUCTION_ID,
    });
    expect(cleanup).toHaveBeenCalledTimes(1);

    expect(mutatedRecord).toMatchObject({
      status: "aborted",
      error: REDUCE_ABORT_DETAIL,
      startedAt: "2026-04-17T18:00:05.000Z",
      completedAt: completionTimestamp,
    });
    expect(mutatedRecord?.reducers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "agent-a",
          status: "aborted",
          startedAt: completionTimestamp,
          completedAt: completionTimestamp,
          error: REDUCE_ABORT_DETAIL,
        }),
        expect.objectContaining({
          agentId: "agent-b",
          status: "aborted",
          startedAt: "2026-04-17T18:10:00.000Z",
          completedAt: completionTimestamp,
          error: REDUCE_ABORT_DETAIL,
        }),
        expect.objectContaining({
          agentId: "agent-c",
          status: "succeeded",
        }),
      ]),
    );
  });

  it("marks queued and running reducers failed during fatal teardown", async () => {
    registerActiveReduce({
      root: "/repo",
      reductionsFilePath: "/repo/.voratiq/reduce/index.json",
      reductionId: REDUCTION_ID,
    });

    const existingRecord: ReductionRecord = {
      sessionId: REDUCTION_ID,
      target: { type: "run", id: "run-123" },
      createdAt: "2026-04-17T18:00:00.000Z",
      startedAt: "2026-04-17T18:00:05.000Z",
      status: "running",
      reducers: [
        {
          agentId: "agent-a",
          status: "running",
          startedAt: "2026-04-17T18:10:00.000Z",
          outputPath:
            ".voratiq/reduce/sessions/reduce-123/agent-a/artifacts/reduction.md",
          dataPath:
            ".voratiq/reduce/sessions/reduce-123/agent-a/artifacts/reduction.json",
        },
      ],
      error: null,
    };

    readReductionRecordsMock.mockResolvedValue([existingRecord]);

    let mutatedRecord: ReductionRecord | undefined;
    rewriteReductionRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(existingRecord);
      return Promise.resolve(mutatedRecord);
    });

    await terminateActiveReduce("failed");

    expect(mutatedRecord).toMatchObject({
      status: "failed",
      error: REDUCE_FAILURE_DETAIL,
      completedAt: completionTimestamp,
    });
    expect(mutatedRecord?.reducers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "agent-a",
          status: "failed",
          error: REDUCE_FAILURE_DETAIL,
          completedAt: completionTimestamp,
        }),
      ]),
    );
  });

  it("synthesizes an aborted reduction record when teardown lands before first persistence", async () => {
    const initialRecord: ReductionRecord = {
      sessionId: REDUCTION_ID,
      target: { type: "run", id: "run-123" },
      createdAt: "2026-04-17T18:00:00.000Z",
      status: "queued",
      reducers: [
        {
          agentId: "agent-a",
          status: "queued",
          outputPath:
            ".voratiq/reduce/sessions/reduce-123/agent-a/artifacts/reduction.md",
          dataPath:
            ".voratiq/reduce/sessions/reduce-123/agent-a/artifacts/reduction.json",
        },
      ],
      error: null,
    };

    registerActiveReduce({
      root: "/repo",
      reductionsFilePath: "/repo/.voratiq/reduce/index.json",
      reductionId: REDUCTION_ID,
      initialRecord,
    });
    readReductionRecordsMock.mockResolvedValue([]);

    await terminateActiveReduce("aborted");

    expect(appendReductionRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        root: "/repo",
        reductionsFilePath: "/repo/.voratiq/reduce/index.json",
        record: expect.objectContaining({
          sessionId: REDUCTION_ID,
          status: "aborted",
          startedAt: completionTimestamp,
          completedAt: completionTimestamp,
          error: REDUCE_ABORT_DETAIL,
          reducers: [
            expect.objectContaining({
              agentId: "agent-a",
              status: "aborted",
              startedAt: completionTimestamp,
              completedAt: completionTimestamp,
              error: REDUCE_ABORT_DETAIL,
            }),
          ],
        }),
      }),
    );
  });

  it("rewrites the reduction record when fallback append loses an early persistence race", async () => {
    const initialRecord: ReductionRecord = {
      sessionId: REDUCTION_ID,
      target: { type: "run", id: "run-123" },
      createdAt: "2026-04-17T18:00:00.000Z",
      status: "queued",
      reducers: [
        {
          agentId: "agent-a",
          status: "queued",
          outputPath:
            ".voratiq/reduce/sessions/reduce-123/agent-a/artifacts/reduction.md",
          dataPath:
            ".voratiq/reduce/sessions/reduce-123/agent-a/artifacts/reduction.json",
        },
      ],
      error: null,
    };
    const persistedRecord: ReductionRecord = {
      ...initialRecord,
      startedAt: "2026-04-17T18:00:05.000Z",
      status: "running",
      reducers: [
        {
          agentId: "agent-a",
          status: "running",
          startedAt: "2026-04-17T18:10:00.000Z",
          outputPath:
            ".voratiq/reduce/sessions/reduce-123/agent-a/artifacts/reduction.md",
          dataPath:
            ".voratiq/reduce/sessions/reduce-123/agent-a/artifacts/reduction.json",
        },
      ],
    };

    registerActiveReduce({
      root: "/repo",
      reductionsFilePath: "/repo/.voratiq/reduce/index.json",
      reductionId: REDUCTION_ID,
      initialRecord,
    });
    readReductionRecordsMock.mockResolvedValueOnce([]);
    appendReductionRecordMock.mockRejectedValueOnce(
      new SessionRecordMutationError(
        `Session ${REDUCTION_ID} already exists at /repo/.voratiq/reduce/index.json.`,
      ),
    );
    rewriteReductionRecordMock.mockImplementation(({ mutate }) =>
      Promise.resolve(mutate(persistedRecord)),
    );

    await terminateActiveReduce("aborted");

    expect(appendReductionRecordMock).toHaveBeenCalledTimes(1);
    expect(rewriteReductionRecordMock).toHaveBeenCalledTimes(1);
    expect(flushReductionRecordBufferMock).toHaveBeenCalledWith({
      reductionsFilePath: "/repo/.voratiq/reduce/index.json",
      sessionId: REDUCTION_ID,
    });
  });

  it("is a no-op when no active reduction is registered", async () => {
    await terminateActiveReduce("failed");

    expect(readReductionRecordsMock).not.toHaveBeenCalled();
    expect(rewriteReductionRecordMock).not.toHaveBeenCalled();
    expect(flushReductionRecordBufferMock).not.toHaveBeenCalled();
  });

  it("prunes reduction scratch state while retaining artifacts on finalization", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-finalize-"));
    tempRoots.push(root);

    const sessionRoot = join(
      root,
      ".voratiq",
      "reduce",
      "sessions",
      REDUCTION_ID,
      "agent-a",
    );
    const workspacePath = join(sessionRoot, "workspace");
    const artifactsPath = join(sessionRoot, "artifacts");
    const contextPath = join(sessionRoot, "context");
    const runtimePath = join(sessionRoot, "runtime");
    const sandboxPath = join(sessionRoot, "sandbox");

    await mkdir(workspacePath, { recursive: true });
    await mkdir(artifactsPath, { recursive: true });
    await mkdir(contextPath, { recursive: true });
    await mkdir(runtimePath, { recursive: true });
    await mkdir(sandboxPath, { recursive: true });

    const teardown = createTeardownController(`reduce \`${REDUCTION_ID}\``);
    teardown.addPath(workspacePath, "reduction workspace");
    teardown.addPath(contextPath, "reduction context");
    teardown.addPath(runtimePath, "reduction runtime");
    teardown.addPath(sandboxPath, "reduction sandbox");

    registerActiveReduce({
      root,
      reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
      reductionId: REDUCTION_ID,
      teardown,
    });

    await finalizeActiveReduce(REDUCTION_ID);

    await expect(pathExists(workspacePath)).resolves.toBe(false);
    await expect(pathExists(contextPath)).resolves.toBe(false);
    await expect(pathExists(runtimePath)).resolves.toBe(false);
    await expect(pathExists(sandboxPath)).resolves.toBe(false);
    await expect(pathExists(artifactsPath)).resolves.toBe(true);
  });
});
