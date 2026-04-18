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
  clearActiveSpec,
  finalizeActiveSpec,
  registerActiveSpec,
  SPEC_ABORT_DETAIL,
  SPEC_FAILURE_DETAIL,
  terminateActiveSpec,
} from "../../../src/commands/spec/lifecycle.js";
import { createTeardownController } from "../../../src/competition/shared/teardown.js";
import type { SpecRecord } from "../../../src/domain/spec/model/types.js";
import {
  appendSpecRecord,
  flushSpecRecordBuffer,
  rewriteSpecRecord,
} from "../../../src/domain/spec/persistence/adapter.js";
import {
  SessionRecordMutationError,
  SessionRecordNotFoundError,
} from "../../../src/persistence/errors.js";
import { pathExists } from "../../../src/utils/fs.js";

jest.mock("../../../src/domain/spec/persistence/adapter.js", () => ({
  appendSpecRecord: jest.fn(),
  flushSpecRecordBuffer: jest.fn(),
  rewriteSpecRecord: jest.fn(),
}));

const appendSpecRecordMock = jest.mocked(appendSpecRecord);
const flushSpecRecordBufferMock = jest.mocked(flushSpecRecordBuffer);
const rewriteSpecRecordMock = jest.mocked(rewriteSpecRecord);

describe("spec lifecycle", () => {
  const SPEC_ID = "spec-123";
  const tempRoots: string[] = [];
  let completionTimestamp: string;

  beforeEach(() => {
    jest.useFakeTimers();
    const completionTime = new Date("2026-04-17T18:00:00.000Z");
    jest.setSystemTime(completionTime.getTime());
    completionTimestamp = completionTime.toISOString();
    jest.clearAllMocks();
    appendSpecRecordMock.mockResolvedValue(undefined);
    flushSpecRecordBufferMock.mockResolvedValue(undefined);
    rewriteSpecRecordMock.mockResolvedValue({} as SpecRecord);
  });

  afterEach(() => {
    jest.useRealTimers();
    clearActiveSpec(SPEC_ID);
    return Promise.all(
      tempRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    ).then(() => undefined);
  });

  it("marks queued and running spec agents terminal on abort and flushes the record", async () => {
    const teardown = createTeardownController(`spec \`${SPEC_ID}\``);
    const cleanup = jest.fn(() => Promise.resolve());
    teardown.addAction({
      key: `spec-cleanup:${SPEC_ID}`,
      label: "spec cleanup",
      cleanup,
    });

    const existingRecord: SpecRecord = {
      sessionId: SPEC_ID,
      createdAt: "2026-04-17T17:00:00.000Z",
      startedAt: "2026-04-17T17:00:05.000Z",
      status: "running",
      description: "Generate a spec",
      agents: [
        {
          agentId: "agent-a",
          status: "queued",
        },
        {
          agentId: "agent-b",
          status: "running",
          startedAt: "2026-04-17T17:10:00.000Z",
        },
        {
          agentId: "agent-c",
          status: "succeeded",
          startedAt: "2026-04-17T17:08:00.000Z",
          completedAt: "2026-04-17T17:20:00.000Z",
          outputPath:
            ".voratiq/spec/sessions/spec-123/agent-c/artifacts/spec.md",
          dataPath:
            ".voratiq/spec/sessions/spec-123/agent-c/artifacts/spec.json",
          contentHash: `sha256:${"a".repeat(64)}`,
          error: null,
        },
      ],
      error: null,
    };
    registerActiveSpec({
      root: "/repo",
      specsFilePath: "/repo/.voratiq/specs/index.json",
      specId: SPEC_ID,
      initialRecord: existingRecord,
      teardown,
    });
    let mutatedRecord: SpecRecord | undefined;
    rewriteSpecRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(existingRecord);
      return Promise.resolve(mutatedRecord);
    });

    await terminateActiveSpec("aborted");

    expect(rewriteSpecRecordMock).toHaveBeenCalledTimes(1);
    expect(mutatedRecord).toMatchObject({
      sessionId: SPEC_ID,
      status: "aborted",
      completedAt: completionTimestamp,
      error: SPEC_ABORT_DETAIL,
    });
    expect(mutatedRecord?.agents).toEqual([
      expect.objectContaining({
        agentId: "agent-a",
        status: "failed",
        startedAt: completionTimestamp,
        completedAt: completionTimestamp,
        error: SPEC_ABORT_DETAIL,
      }),
      expect.objectContaining({
        agentId: "agent-b",
        status: "failed",
        startedAt: "2026-04-17T17:10:00.000Z",
        completedAt: completionTimestamp,
        error: SPEC_ABORT_DETAIL,
      }),
      expect.objectContaining({
        agentId: "agent-c",
        status: "succeeded",
      }),
    ]);
    expect(flushSpecRecordBufferMock).toHaveBeenCalledWith({
      specsFilePath: "/repo/.voratiq/specs/index.json",
      sessionId: SPEC_ID,
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(appendSpecRecordMock).not.toHaveBeenCalled();
  });

  it("synthesizes an aborted spec record when teardown lands before first persistence", async () => {
    const initialRecord: SpecRecord = {
      sessionId: SPEC_ID,
      createdAt: "2026-04-17T17:00:00.000Z",
      startedAt: "2026-04-17T17:00:05.000Z",
      status: "running",
      description: "Generate a spec",
      agents: [
        {
          agentId: "agent-a",
          status: "queued",
        },
        {
          agentId: "agent-b",
          status: "running",
          startedAt: "2026-04-17T17:10:00.000Z",
        },
        {
          agentId: "agent-c",
          status: "succeeded",
          startedAt: "2026-04-17T17:08:00.000Z",
          completedAt: "2026-04-17T17:20:00.000Z",
          outputPath:
            ".voratiq/spec/sessions/spec-123/agent-c/artifacts/spec.md",
          dataPath:
            ".voratiq/spec/sessions/spec-123/agent-c/artifacts/spec.json",
          contentHash: `sha256:${"a".repeat(64)}`,
          error: null,
        },
      ],
      error: null,
    };

    registerActiveSpec({
      root: "/repo",
      specsFilePath: "/repo/.voratiq/specs/index.json",
      specId: SPEC_ID,
      initialRecord,
    });
    rewriteSpecRecordMock.mockRejectedValue(
      new SessionRecordNotFoundError(SPEC_ID),
    );

    await terminateActiveSpec("aborted");

    expect(appendSpecRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        root: "/repo",
        specsFilePath: "/repo/.voratiq/specs/index.json",
        record: expect.objectContaining({
          sessionId: SPEC_ID,
          status: "aborted",
          completedAt: completionTimestamp,
          error: SPEC_ABORT_DETAIL,
          agents: [
            expect.objectContaining({
              agentId: "agent-a",
              status: "failed",
              startedAt: completionTimestamp,
              completedAt: completionTimestamp,
              error: SPEC_ABORT_DETAIL,
            }),
            expect.objectContaining({
              agentId: "agent-b",
              status: "failed",
              startedAt: "2026-04-17T17:10:00.000Z",
              completedAt: completionTimestamp,
              error: SPEC_ABORT_DETAIL,
            }),
            expect.objectContaining({
              agentId: "agent-c",
              status: "succeeded",
            }),
          ],
        }),
      }),
    );
  });

  it("rewrites the spec record when fallback append loses an early persistence race", async () => {
    const initialRecord: SpecRecord = {
      sessionId: SPEC_ID,
      createdAt: "2026-04-17T17:00:00.000Z",
      startedAt: "2026-04-17T17:00:05.000Z",
      status: "running",
      description: "Generate a spec",
      agents: [
        {
          agentId: "agent-a",
          status: "queued",
        },
      ],
      error: null,
    };
    const persistedRecord: SpecRecord = {
      ...initialRecord,
      agents: [
        {
          agentId: "agent-a",
          status: "running",
          startedAt: "2026-04-17T17:10:00.000Z",
        },
      ],
    };

    registerActiveSpec({
      root: "/repo",
      specsFilePath: "/repo/.voratiq/specs/index.json",
      specId: SPEC_ID,
      initialRecord,
    });
    rewriteSpecRecordMock
      .mockRejectedValueOnce(new SessionRecordNotFoundError(SPEC_ID))
      .mockImplementationOnce(({ mutate }) =>
        Promise.resolve(mutate(persistedRecord)),
      );
    appendSpecRecordMock.mockRejectedValueOnce(
      new SessionRecordMutationError(
        `Session ${SPEC_ID} already exists at /repo/.voratiq/specs/index.json.`,
      ),
    );

    await terminateActiveSpec("aborted");

    expect(appendSpecRecordMock).toHaveBeenCalledTimes(1);
    expect(rewriteSpecRecordMock).toHaveBeenCalledTimes(2);
    expect(flushSpecRecordBufferMock).toHaveBeenCalledWith({
      specsFilePath: "/repo/.voratiq/specs/index.json",
      sessionId: SPEC_ID,
    });
  });

  it("marks queued and running spec agents terminal on fatal failure", async () => {
    const existingRecord: SpecRecord = {
      sessionId: SPEC_ID,
      createdAt: "2026-04-17T17:00:00.000Z",
      startedAt: "2026-04-17T17:00:05.000Z",
      status: "running",
      description: "Generate a spec",
      agents: [
        {
          agentId: "agent-a",
          status: "running",
          startedAt: "2026-04-17T17:10:00.000Z",
        },
      ],
      error: null,
    };
    registerActiveSpec({
      root: "/repo",
      specsFilePath: "/repo/.voratiq/specs/index.json",
      specId: SPEC_ID,
      initialRecord: existingRecord,
    });

    let mutatedRecord: SpecRecord | undefined;
    rewriteSpecRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(existingRecord);
      return Promise.resolve(mutatedRecord);
    });

    await terminateActiveSpec("failed");

    expect(mutatedRecord).toMatchObject({
      status: "failed",
      error: SPEC_FAILURE_DETAIL,
      completedAt: completionTimestamp,
    });
    expect(mutatedRecord?.agents).toEqual([
      expect.objectContaining({
        agentId: "agent-a",
        status: "failed",
        error: SPEC_FAILURE_DETAIL,
        completedAt: completionTimestamp,
      }),
    ]);
  });

  it("is a no-op when no active spec is registered", async () => {
    await terminateActiveSpec("failed");

    expect(rewriteSpecRecordMock).not.toHaveBeenCalled();
    expect(appendSpecRecordMock).not.toHaveBeenCalled();
    expect(flushSpecRecordBufferMock).not.toHaveBeenCalled();
  });

  it("prunes spec scratch state while retaining artifacts on finalization", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-spec-finalize-"));
    tempRoots.push(root);

    const sessionRoot = join(root, ".voratiq", "spec", "sessions", SPEC_ID);
    const workspacePath = join(sessionRoot, "agent-a", "workspace");
    const artifactsPath = join(sessionRoot, "agent-a", "artifacts");
    const contextPath = join(sessionRoot, "agent-a", "context");
    const runtimePath = join(sessionRoot, "agent-a", "runtime");
    const sandboxPath = join(sessionRoot, "agent-a", "sandbox");

    await mkdir(workspacePath, { recursive: true });
    await mkdir(artifactsPath, { recursive: true });
    await mkdir(contextPath, { recursive: true });
    await mkdir(runtimePath, { recursive: true });
    await mkdir(sandboxPath, { recursive: true });

    const teardown = createTeardownController(`spec \`${SPEC_ID}\``);
    teardown.addPath(workspacePath, "spec workspace");
    teardown.addPath(contextPath, "spec context");
    teardown.addPath(runtimePath, "spec runtime");
    teardown.addPath(sandboxPath, "spec sandbox");

    registerActiveSpec({
      root,
      specsFilePath: join(root, ".voratiq", "specs", "index.json"),
      specId: SPEC_ID,
      teardown,
    });

    await finalizeActiveSpec(SPEC_ID);

    await expect(pathExists(workspacePath)).resolves.toBe(false);
    await expect(pathExists(contextPath)).resolves.toBe(false);
    await expect(pathExists(runtimePath)).resolves.toBe(false);
    await expect(pathExists(sandboxPath)).resolves.toBe(false);
    await expect(pathExists(artifactsPath)).resolves.toBe(true);
  });
});
