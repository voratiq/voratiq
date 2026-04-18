import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { getActiveTerminationStatus } from "../../../../src/domain/run/competition/termination-state.js";
import { createAgentRecordMutators } from "../../../../src/domain/run/model/mutators.js";
import type { RunRecord } from "../../../../src/domain/run/model/types.js";
import { rewriteRunRecord } from "../../../../src/domain/run/persistence/adapter.js";

jest.mock("../../../../src/domain/run/persistence/adapter.js", () => ({
  rewriteRunRecord: jest.fn(),
}));

jest.mock(
  "../../../../src/domain/run/competition/termination-state.js",
  () => ({
    getActiveTerminationStatus: jest.fn(),
    RUN_ABORT_WARNING: "Run aborted before agent completed.",
  }),
);

const rewriteRunRecordMock = jest.mocked(rewriteRunRecord);
const getActiveTerminationStatusMock = jest.mocked(getActiveTerminationStatus);

describe("createAgentRecordMutators", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getActiveTerminationStatusMock.mockReturnValue(undefined);
  });

  it("does not downgrade aborted agents when late running snapshots arrive", async () => {
    const runId = "run-456";
    let currentRecord: RunRecord = {
      runId,
      baseRevisionSha: "base-sha",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "aborted",
      createdAt: "2025-11-04T12:00:00.000Z",
      agents: [
        {
          agentId: "alpha",
          model: "gpt-4",
          status: "aborted",
          startedAt: "2025-11-04T12:10:00.000Z",
          completedAt: "2025-11-04T12:10:00.000Z",
          warnings: ["Run aborted before agent completed."],
        },
      ],
    };

    rewriteRunRecordMock.mockImplementation(({ mutate }) => {
      currentRecord = mutate(currentRecord);
      return Promise.resolve(currentRecord);
    });

    const mutators = createAgentRecordMutators({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId,
    });

    await mutators.recordAgentSnapshot({
      agentId: "alpha",
      model: "gpt-4",
      status: "running",
      startedAt: "2025-11-04T12:11:00.000Z",
      artifacts: {
        stdoutCaptured: true,
      },
    });

    expect(rewriteRunRecordMock).toHaveBeenCalledTimes(1);
    const agent = currentRecord.agents[0];
    expect(agent.status).toBe("aborted");
    expect(agent.startedAt).toBe("2025-11-04T12:10:00.000Z");
    expect(agent.completedAt).toBe("2025-11-04T12:10:00.000Z");
    expect(agent.warnings).toEqual(["Run aborted before agent completed."]);
    expect(agent.artifacts).toBeUndefined();
  });

  it("retains diff statistics once they are reported", async () => {
    const runId = "run-789";
    let currentRecord: RunRecord = {
      runId,
      baseRevisionSha: "base-sha",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "running",
      createdAt: "2025-11-05T12:00:00.000Z",
      agents: [],
    };

    rewriteRunRecordMock.mockImplementation(({ mutate }) => {
      currentRecord = mutate(currentRecord);
      return Promise.resolve(currentRecord);
    });

    const mutators = createAgentRecordMutators({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId,
    });

    await mutators.recordAgentSnapshot({
      agentId: "alpha",
      model: "gpt-4",
      status: "running",
      startedAt: "2025-11-05T12:01:00.000Z",
      artifacts: {
        stdoutCaptured: true,
        stderrCaptured: true,
      },
    });

    await mutators.recordAgentSnapshot({
      agentId: "alpha",
      model: "gpt-4",
      status: "succeeded",
      startedAt: "2025-11-05T12:01:00.000Z",
      completedAt: "2025-11-05T12:03:00.000Z",
      diffStatistics: "2 files changed, 5 insertions(+)",
      artifacts: {
        stdoutCaptured: true,
        stderrCaptured: true,
        diffCaptured: true,
      },
    });

    await mutators.recordAgentSnapshot({
      agentId: "alpha",
      model: "gpt-4",
      status: "succeeded",
      startedAt: "2025-11-05T12:01:00.000Z",
      completedAt: "2025-11-05T12:03:00.000Z",
      warnings: ["noop update"],
    });

    const agentRecord = currentRecord.agents[0];
    if (!agentRecord) {
      throw new Error("Expected agent record to exist");
    }
    expect(agentRecord.diffStatistics).toBe("2 files changed, 5 insertions(+)");
    expect(agentRecord.warnings).toEqual(["noop update"]);
  });

  it("preserves terminal snapshots when termination is active", async () => {
    const runId = "run-termination";
    let currentRecord: RunRecord = {
      runId,
      baseRevisionSha: "base-sha",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "running",
      createdAt: "2025-11-05T13:00:00.000Z",
      agents: [],
    };

    rewriteRunRecordMock.mockImplementation(({ mutate }) => {
      currentRecord = mutate(currentRecord);
      return Promise.resolve(currentRecord);
    });

    const mutators = createAgentRecordMutators({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId,
    });

    getActiveTerminationStatusMock.mockReturnValue("aborted");

    await mutators.recordAgentSnapshot({
      agentId: "alpha",
      model: "gpt-4",
      status: "failed",
      startedAt: "2025-11-05T13:01:00.000Z",
      completedAt: "2025-11-05T13:02:00.000Z",
      error: "Agent process failed",
    });

    const record = currentRecord.agents[0];
    if (!record) {
      throw new Error("Expected agent record to exist");
    }
    expect(record.status).toBe("failed");
    expect(record.error).toBe("Agent process failed");
    expect(record.warnings).toBeUndefined();
    expect(record.completedAt).toBe("2025-11-05T13:02:00.000Z");
  });

  it("force flushes terminal agent snapshots immediately", async () => {
    const runId = "run-terminal-flush";
    let currentRecord: RunRecord = {
      runId,
      baseRevisionSha: "base-sha",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "running",
      createdAt: "2025-11-05T13:00:00.000Z",
      agents: [],
    };

    rewriteRunRecordMock.mockImplementation(({ mutate }) => {
      currentRecord = mutate(currentRecord);
      return Promise.resolve(currentRecord);
    });

    const mutators = createAgentRecordMutators({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId,
    });

    await mutators.recordAgentSnapshot({
      agentId: "alpha",
      model: "gpt-4",
      status: "succeeded",
      startedAt: "2025-11-05T13:01:00.000Z",
      completedAt: "2025-11-05T13:02:00.000Z",
      artifacts: {
        summaryCaptured: true,
      },
    });

    expect(rewriteRunRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        forceFlush: true,
      }),
    );
    expect(currentRecord.agents[0]?.artifacts?.summaryCaptured).toBe(true);
  });

  it("preserves terminal snapshots during abort without re-normalizing lifecycle fields", async () => {
    const runId = "run-termination-invalid";
    let currentRecord: RunRecord = {
      runId,
      baseRevisionSha: "base-sha",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "running",
      createdAt: "2025-11-05T13:00:00.000Z",
      agents: [],
    };

    rewriteRunRecordMock.mockImplementation(({ mutate }) => {
      currentRecord = mutate(currentRecord);
      return Promise.resolve(currentRecord);
    });

    const mutators = createAgentRecordMutators({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId,
    });

    getActiveTerminationStatusMock.mockReturnValue("aborted");

    await mutators.recordAgentSnapshot({
      agentId: "alpha",
      model: "gpt-4",
      status: "failed",
      completedAt: "2025-11-05T13:02:00.000Z",
      error: "Agent process failed",
    });

    expect(rewriteRunRecordMock).toHaveBeenCalledTimes(1);
    expect(currentRecord.agents[0]).toEqual(
      expect.objectContaining({
        agentId: "alpha",
        status: "failed",
        completedAt: "2025-11-05T13:02:00.000Z",
        error: "Agent process failed",
      }),
    );
  });

  it("preserves provider-native token usage across snapshot merges", async () => {
    const runId = "run-usage-merge";
    let currentRecord: RunRecord = {
      runId,
      baseRevisionSha: "base-sha",
      rootPath: ".",
      spec: { path: "specs/demo.md" },
      status: "running",
      createdAt: "2025-11-05T14:00:00.000Z",
      agents: [],
    };

    rewriteRunRecordMock.mockImplementation(({ mutate }) => {
      currentRecord = mutate(currentRecord);
      return Promise.resolve(currentRecord);
    });

    const mutators = createAgentRecordMutators({
      root: "/repo",
      runsFilePath: "/repo/.voratiq/run/index.json",
      runId,
    });

    await mutators.recordAgentQueued({
      id: "alpha",
      provider: "codex",
      model: "gpt-5-codex",
      binary: "codex",
      argv: ["exec"],
    });

    await mutators.recordAgentSnapshot({
      agentId: "alpha",
      model: "gpt-5-codex",
      status: "running",
      startedAt: "2025-11-05T14:01:00.000Z",
      artifacts: {
        stdoutCaptured: true,
      },
    });

    await mutators.recordAgentSnapshot({
      agentId: "alpha",
      model: "gpt-5-codex",
      status: "succeeded",
      startedAt: "2025-11-05T14:01:00.000Z",
      completedAt: "2025-11-05T14:03:00.000Z",
      tokenUsage: {
        input_tokens: 120,
        cached_input_tokens: 30,
        output_tokens: 45,
        reasoning_output_tokens: 7,
        total_tokens: 202,
      },
    });

    await mutators.recordAgentSnapshot({
      agentId: "alpha",
      model: "gpt-5-codex",
      status: "succeeded",
      startedAt: "2025-11-05T14:01:00.000Z",
      completedAt: "2025-11-05T14:03:00.000Z",
      warnings: ["noop update"],
    });

    const record = currentRecord.agents[0];
    if (!record) {
      throw new Error("Expected agent record to exist");
    }
    expect(record.tokenUsage).toEqual({
      input_tokens: 120,
      cached_input_tokens: 30,
      output_tokens: 45,
      reasoning_output_tokens: 7,
      total_tokens: 202,
    });
    expect(record.warnings).toEqual(["noop update"]);
  });
});
