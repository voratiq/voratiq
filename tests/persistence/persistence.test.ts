import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { jest } from "@jest/globals";

import {
  drainPendingAppWorkflowSessionUploads,
  queueAppWorkflowSessionUpload,
} from "../../src/app-session/workflow-upload.js";
import {
  createSessionStore,
  type SessionAfterPersistEvent,
} from "../../src/persistence/session-store.js";
import { createRunRecord } from "../support/factories/run-records.js";

type TestStatus = "running" | "done";

type TestRecord = {
  sessionId: string;
  status: TestStatus;
  createdAt: string;
  data?: string;
};

type TestIndexEntry = {
  sessionId: string;
  createdAt: string;
  status: TestStatus;
};

describe("shared session persistence", () => {
  let root: string;
  let paths: {
    root: string;
    indexPath: string;
    sessionsDir: string;
    lockPath: string;
  };
  let persistence: ReturnType<
    typeof createSessionStore<TestRecord, TestIndexEntry, TestStatus>
  >;
  let afterRecordPersisted:
    | ((event: SessionAfterPersistEvent<TestRecord>) => void | Promise<void>)
    | undefined;

  beforeEach(async () => {
    afterRecordPersisted = undefined;
    root = await mkdtemp(join(tmpdir(), "voratiq-session-"));
    paths = {
      root,
      indexPath: join(root, "index.json"),
      sessionsDir: join(root, "sessions"),
      lockPath: join(root, "locks", "history.lock"),
    };
    await mkdir(dirname(paths.indexPath), { recursive: true });

    persistence = createSessionStore<TestRecord, TestIndexEntry, TestStatus>({
      recordFilename: "record.json",
      indexVersion: 1,
      acquireLock: async (lockPath) => {
        await mkdir(dirname(lockPath), { recursive: true });
        await writeFile(lockPath, "locked", "utf8");
        return async () => {
          await rm(lockPath, { force: true });
        };
      },
      parseRecord: ({ raw }) => JSON.parse(raw) as TestRecord,
      buildIndexEntry: (record) => ({
        sessionId: record.sessionId,
        createdAt: record.createdAt,
        status: record.status,
      }),
      getIndexEntryId: (entry) => entry.sessionId,
      shouldForceFlush: (record) => record.status !== "running",
      getRecordId: (record) => record.sessionId,
      getRecordStatus: (record) => record.status,
      afterRecordPersisted: (event) => afterRecordPersisted?.(event),
    });
  });

  afterEach(async () => {
    await persistence.flushAllRecordBuffers();
    await rm(root, { recursive: true, force: true });
  });

  it("buffers running updates until flush", async () => {
    const record: TestRecord = {
      sessionId: "session-1",
      status: "running",
      createdAt: "2025-10-22T12:00:00.000Z",
    };
    await persistence.appendRecord({ paths, record });

    await persistence.rewriteRecord({
      paths,
      sessionId: "session-1",
      mutate: (current) => ({
        ...current,
        data: "pending",
      }),
    });

    const pending = await readRecord(paths, "session-1");
    expect(pending.data).toBeUndefined();

    await persistence.flushAllRecordBuffers();
    await settleAsync();

    const flushed = await readRecord(paths, "session-1");
    expect(flushed.data).toBe("pending");
  });

  it("flushes and disposes buffers for terminal status", async () => {
    const record: TestRecord = {
      sessionId: "session-2",
      status: "running",
      createdAt: "2025-10-22T12:00:00.000Z",
    };
    await persistence.appendRecord({ paths, record });

    await persistence.rewriteRecord({
      paths,
      sessionId: "session-2",
      mutate: (current) => ({
        ...current,
        status: "done",
      }),
    });

    expect(persistence.snapshotRecordBuffers()).toHaveLength(0);

    const flushed = await readRecord(paths, "session-2");
    expect(flushed.status).toBe("done");
  });

  it("updates index entries when status changes", async () => {
    const record: TestRecord = {
      sessionId: "session-3",
      status: "running",
      createdAt: "2025-10-22T12:00:00.000Z",
    };
    await persistence.appendRecord({ paths, record });

    await persistence.rewriteRecord({
      paths,
      sessionId: "session-3",
      mutate: (current) => ({
        ...current,
        status: "done",
      }),
    });

    const raw = await readFile(paths.indexPath, "utf8");
    const payload = JSON.parse(raw) as { sessions: TestIndexEntry[] };
    const entry = payload.sessions.find(
      (item) => item.sessionId === "session-3",
    );
    expect(entry?.status).toBe("done");
  });

  it("waits for post-persist hooks before resolving forced flushes", async () => {
    const record: TestRecord = {
      sessionId: "session-4",
      status: "running",
      createdAt: "2025-10-22T12:00:00.000Z",
    };
    await persistence.appendRecord({
      paths,
      record,
      skipAfterPersistHook: true,
    });

    let resolveHook: () => void = () => {};
    let resolveHookStarted: () => void = () => {};
    const hookStartedPromise = new Promise<void>((resolve) => {
      resolveHookStarted = resolve;
    });
    let hookStarted = false;
    let hookCompleted = false;
    afterRecordPersisted = async () => {
      hookStarted = true;
      resolveHookStarted();
      await new Promise<void>((resolve) => {
        resolveHook = resolve;
      });
      hookCompleted = true;
    };

    let rewriteSettled = false;
    const rewritePromise = persistence
      .rewriteRecord({
        paths,
        sessionId: "session-4",
        mutate: (current) => ({
          ...current,
          status: "done",
        }),
      })
      .then(() => {
        rewriteSettled = true;
      });

    await hookStartedPromise;
    expect(hookStarted).toBe(true);
    expect(hookCompleted).toBe(false);
    expect(rewriteSettled).toBe(false);

    resolveHook();
    await rewritePromise;
    expect(hookCompleted).toBe(true);
    expect(rewriteSettled).toBe(true);
  });

  it("keeps persistence successful when post-persist hooks fail", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    afterRecordPersisted = () => {
      throw new Error("hook exploded");
    };

    try {
      const record: TestRecord = {
        sessionId: "session-5",
        status: "done",
        createdAt: "2025-10-22T12:00:00.000Z",
      };

      await expect(
        persistence.appendRecord({ paths, record }),
      ).resolves.toBeUndefined();

      const flushed = await readRecord(paths, "session-5");
      expect(flushed.status).toBe("done");
      expect(warnSpy).toHaveBeenCalledWith(
        "[voratiq] Failed post-persist hook for session session-5: hook exploded",
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("keeps local persistence successful when a queued workflow upload is aborted", async () => {
    const warn = jest.fn();
    let observedSignal: AbortSignal | undefined;
    const createAppWorkflowSessionMock = jest.fn(
      (input: { signal?: AbortSignal }) =>
        new Promise<{ workflow_id: string; workflow_session_id: string }>(
          (resolve, reject) => {
            void resolve;
            const signal = input.signal;
            if (!signal) {
              reject(new Error("Expected queued upload to receive a signal."));
              return;
            }

            observedSignal = signal;
            signal.addEventListener(
              "abort",
              () => {
                reject(new Error("queued upload aborted"));
              },
              { once: true },
            );
          },
        ),
    );

    afterRecordPersisted = (event) => {
      queueAppWorkflowSessionUpload(
        {
          operator: "run",
          root: event.paths.root,
          record: createRunRecord({
            runId: "run-upload-abort",
            createdAt: event.record.createdAt,
          }),
          recordUpdatedAt: event.persistedAt,
        },
        {
          createAppWorkflowSession: createAppWorkflowSessionMock as never,
          resolveRepositoryLink: () =>
            Promise.resolve({
              kind: "linked",
              localRepoKey: "repo-local-key",
            }),
          warn,
          warningCache: new Set<string>(),
        },
      );
    };

    const record: TestRecord = {
      sessionId: "session-upload-abort",
      status: "done",
      createdAt: "2025-10-22T12:00:00.000Z",
    };

    await expect(
      persistence.appendRecord({ paths, record }),
    ).resolves.toBeUndefined();
    await expect(readRecord(paths, "session-upload-abort")).resolves.toEqual(
      record,
    );

    await settleAsync();
    await settleAsync();
    expect(createAppWorkflowSessionMock).toHaveBeenCalledTimes(1);

    await expect(
      drainPendingAppWorkflowSessionUploads({ timeoutMs: 1 }),
    ).resolves.toMatchObject({
      kind: "timeout",
      startedPendingCount: 1,
      remainingPendingCount: 1,
    });
    expect(observedSignal?.aborted).toBe(true);

    await expect(
      drainPendingAppWorkflowSessionUploads({ timeoutMs: 1_000 }),
    ).resolves.toEqual({
      kind: "drained",
      startedPendingCount: 1,
      remainingPendingCount: 0,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("workflow persistence layering", () => {
  it("keeps domain persistence adapters free of app-session imports", async () => {
    const adapterPaths = [
      "src/domain/spec/persistence/adapter.ts",
      "src/domain/run/persistence/adapter.ts",
      "src/domain/message/persistence/adapter.ts",
      "src/domain/reduce/persistence/adapter.ts",
      "src/domain/verify/persistence/adapter.ts",
    ];

    for (const adapterPath of adapterPaths) {
      const source = await readFile(join(process.cwd(), adapterPath), "utf8");
      expect(source).not.toContain("app-session");
    }
  });
});

async function readRecord(
  paths: { sessionsDir: string },
  sessionId: string,
): Promise<TestRecord> {
  const recordPath = join(paths.sessionsDir, sessionId, "record.json");
  const raw = await readFile(recordPath, "utf8");
  return JSON.parse(raw) as TestRecord;
}

async function settleAsync(): Promise<void> {
  await Promise.resolve();
}
