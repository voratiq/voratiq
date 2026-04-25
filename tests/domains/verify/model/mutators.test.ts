import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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

import { createVerificationRecordMutators } from "../../../../src/domain/verify/model/mutators.js";
import {
  appendVerificationRecord,
  flushAllVerificationRecordBuffers,
  readVerificationRecords,
} from "../../../../src/domain/verify/persistence/adapter.js";

describe("verification record mutators", () => {
  let root: string;
  let verificationsFilePath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "voratiq-verify-mutators-"));
    verificationsFilePath = join(root, ".voratiq", "verify", "index.json");
    await mkdir(join(root, ".voratiq", "verify"), { recursive: true });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await flushAllVerificationRecordBuffers();
    await rm(root, { recursive: true, force: true });
  });

  it("durably rewrites queued sessions to running before any buffered flush could rescue them", async () => {
    jest.useFakeTimers();

    const createdAt = "2026-04-25T16:00:00.000Z";
    const startedAt = "2026-04-25T16:00:01.000Z";
    const sessionId = "verify-running-durable";

    await appendVerificationRecord({
      root,
      verificationsFilePath,
      record: {
        sessionId,
        createdAt,
        status: "queued",
        target: {
          kind: "run",
          sessionId: "run-123",
          candidateIds: ["agent-a"],
        },
        methods: [],
      },
    });

    const mutators = createVerificationRecordMutators({
      root,
      verificationsFilePath,
      verificationId: sessionId,
    });

    await mutators.recordVerificationRunning(startedAt);

    expect(jest.getTimerCount()).toBe(0);

    // Simulate the process exiting before any deferred flush timer could run.
    jest.clearAllTimers();

    const records = await readVerificationRecords({
      root,
      verificationsFilePath,
      limit: 1,
    });
    expect(records).toEqual([
      expect.objectContaining({
        sessionId,
        status: "running",
        startedAt,
      }),
    ]);

    const rawIndex = await readFile(verificationsFilePath, "utf8");
    expect(JSON.parse(rawIndex)).toEqual({
      version: 1,
      sessions: [
        {
          sessionId,
          createdAt,
          status: "running",
          targetKind: "run",
          targetSessionId: "run-123",
        },
      ],
    });

    const rawRecord = await readFile(
      join(root, ".voratiq", "verify", "sessions", sessionId, "record.json"),
      "utf8",
    );
    expect(JSON.parse(rawRecord)).toEqual(
      expect.objectContaining({
        sessionId,
        createdAt,
        status: "running",
        startedAt,
      }),
    );
  });
});
