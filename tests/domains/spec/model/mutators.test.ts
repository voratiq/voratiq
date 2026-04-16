import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { createSpecRecordMutators } from "../../../../src/domain/spec/model/mutators.js";
import type { SpecRecord } from "../../../../src/domain/spec/model/types.js";
import { rewriteSpecRecord } from "../../../../src/domain/spec/persistence/adapter.js";

jest.mock("../../../../src/domain/spec/persistence/adapter.js", () => ({
  rewriteSpecRecord: jest.fn(),
}));

const rewriteSpecRecordMock = jest.mocked(rewriteSpecRecord);

describe("createSpecRecordMutators", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("retains artifact fields once a terminal agent snapshot has reported them", async () => {
    const sessionId = "spec-123";
    let currentRecord: SpecRecord = {
      sessionId,
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "running",
      description: "Generate task spec",
      agents: [],
      error: null,
    };

    rewriteSpecRecordMock.mockImplementation(({ mutate }) => {
      currentRecord = mutate(currentRecord);
      return Promise.resolve(currentRecord);
    });

    const mutators = createSpecRecordMutators({
      root: "/repo",
      specsFilePath: "/repo/.voratiq/spec/index.json",
      sessionId,
    });

    await mutators.recordAgentSnapshot({
      agentId: "agent-a",
      status: "succeeded",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:05.000Z",
      outputPath: ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.md",
      dataPath: ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.json",
      contentHash:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    await mutators.recordAgentSnapshot({
      agentId: "agent-a",
      status: "succeeded",
      completedAt: "2026-01-01T00:00:05.000Z",
      error: null,
    });

    expect(currentRecord.agents[0]).toEqual({
      agentId: "agent-a",
      status: "succeeded",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:05.000Z",
      outputPath: ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.md",
      dataPath: ".voratiq/spec/sessions/spec-123/agent-a/artifacts/spec.json",
      contentHash:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      error: null,
    });
  });

  it("does not downgrade terminal agents when late running updates arrive", async () => {
    const sessionId = "spec-456";
    let currentRecord: SpecRecord = {
      sessionId,
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "running",
      description: "Generate task spec",
      agents: [
        {
          agentId: "agent-a",
          status: "failed",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:05.000Z",
          error: "boom",
        },
      ],
      error: null,
    };

    rewriteSpecRecordMock.mockImplementation(({ mutate }) => {
      currentRecord = mutate(currentRecord);
      return Promise.resolve(currentRecord);
    });

    const mutators = createSpecRecordMutators({
      root: "/repo",
      specsFilePath: "/repo/.voratiq/spec/index.json",
      sessionId,
    });

    await mutators.recordAgentRunning({
      agentId: "agent-a",
      timestamp: "2026-01-01T00:00:06.000Z",
    });

    expect(currentRecord.agents[0]).toEqual({
      agentId: "agent-a",
      status: "failed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:05.000Z",
      error: "boom",
    });
  });
});
