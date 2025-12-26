import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createSessionPersistence } from "../../src/sessions/persistence.js";

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
    typeof createSessionPersistence<TestRecord, TestIndexEntry, TestStatus>
  >;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "voratiq-session-"));
    paths = {
      root,
      indexPath: join(root, "index.json"),
      sessionsDir: join(root, "sessions"),
      lockPath: join(root, "locks", "history.lock"),
    };
    await mkdir(dirname(paths.indexPath), { recursive: true });

    persistence = createSessionPersistence<
      TestRecord,
      TestIndexEntry,
      TestStatus
    >({
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
