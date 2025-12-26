import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { getActiveTerminationStatus } from "../../src/commands/run/lifecycle.js";
import { createAgentRecordMutators } from "../../src/runs/records/mutators.js";
import { rewriteRunRecord } from "../../src/runs/records/persistence.js";
import type { RunRecord } from "../../src/runs/records/types.js";

jest.mock("../../src/runs/records/persistence.js", () => ({
  rewriteRunRecord: jest.fn(),
}));

jest.mock("../../src/commands/run/lifecycle.js", () => ({
  getActiveTerminationStatus: jest.fn(),
  RUN_ABORT_WARNING: "Run aborted before agent completed.",
}));

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
      runsFilePath: "/repo/.voratiq/runs/index.json",
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
      runsFilePath: "/repo/.voratiq/runs/index.json",
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
      evals: [{ slug: "format", status: "succeeded" }],
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
      evals: [{ slug: "format", status: "succeeded" }],
    });

    const agentRecord = currentRecord.agents[0];
    if (!agentRecord) {
      throw new Error("Expected agent record to exist");
    }
    expect(agentRecord.diffStatistics).toBe("2 files changed, 5 insertions(+)");
    expect(agentRecord.warnings).toEqual(["noop update"]);
  });

  it("coerces terminal snapshots to aborted when termination is active", async () => {
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
      runsFilePath: "/repo/.voratiq/runs/index.json",
      runId,
    });

    getActiveTerminationStatusMock.mockReturnValue("aborted");

    await mutators.recordAgentSnapshot({
      agentId: "alpha",
      model: "gpt-4",
      status: "failed",
      startedAt: "2025-11-05T13:01:00.000Z",
      completedAt: "2025-11-05T13:02:00.000Z",
      evals: [{ slug: "format", status: "failed" }],
      error: "Agent process failed",
    });

    const record = currentRecord.agents[0];
    if (!record) {
      throw new Error("Expected agent record to exist");
    }
    expect(record.status).toBe("aborted");
    expect(record.warnings).toContain("Run aborted before agent completed.");
    expect(record.completedAt).toBe("2025-11-05T13:02:00.000Z");
  });
});
