import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { verifyAgentProviders } from "../../../src/agents/runtime/auth.js";
import { executeReduceCommand } from "../../../src/commands/reduce/command.js";
import { ReducePreflightError } from "../../../src/commands/reduce/errors.js";
import { assertReductionTargetEligible } from "../../../src/commands/reduce/targets.js";
import { resolveReductionCompetitors } from "../../../src/commands/shared/resolve-reduction-competitors.js";
import { generateSessionId } from "../../../src/commands/shared/session-id.js";
import { executeCompetitionWithAdapter } from "../../../src/competition/command-adapter.js";
import { loadEnvironmentConfig } from "../../../src/configs/environment/loader.js";
import * as reduceAdapter from "../../../src/domains/reductions/competition/adapter.js";
import type { ReductionRecord } from "../../../src/domains/reductions/model/types.js";
import {
  flushReductionRecordBuffer,
  readReductionRecords,
} from "../../../src/domains/reductions/persistence/adapter.js";
import type { ReduceProgressRenderer } from "../../../src/render/transcripts/reduce.js";

jest.mock("../../../src/competition/command-adapter.js", () => ({
  executeCompetitionWithAdapter: jest.fn(),
}));

jest.mock("../../../src/configs/environment/loader.js", () => ({
  loadEnvironmentConfig: jest.fn(),
}));

jest.mock(
  "../../../src/commands/shared/resolve-reduction-competitors.js",
  () => ({
    resolveReductionCompetitors: jest.fn(),
  }),
);

jest.mock("../../../src/commands/shared/session-id.js", () => ({
  generateSessionId: jest.fn(),
}));

jest.mock("../../../src/agents/runtime/auth.js", () => ({
  verifyAgentProviders: jest.fn(),
}));

jest.mock("../../../src/commands/reduce/targets.js", () => ({
  assertReductionTargetEligible: jest.fn(),
}));

jest.mock("../../../src/domains/reductions/persistence/adapter.js", () => ({
  flushReductionRecordBuffer: jest.fn(),
  readReductionRecords: jest.fn(),
}));

const executeCompetitionWithAdapterMock = jest.mocked(
  executeCompetitionWithAdapter,
);
const loadEnvironmentConfigMock = jest.mocked(loadEnvironmentConfig);
const resolveReductionCompetitorsMock = jest.mocked(
  resolveReductionCompetitors,
);
const generateSessionIdMock = jest.mocked(generateSessionId);
const verifyAgentProvidersMock = jest.mocked(verifyAgentProviders);
const assertReductionTargetEligibleMock = jest.mocked(
  assertReductionTargetEligible,
);
const flushReductionRecordBufferMock = jest.mocked(flushReductionRecordBuffer);
const readReductionRecordsMock = jest.mocked(readReductionRecords);

describe("executeReduceCommand integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    assertReductionTargetEligibleMock.mockResolvedValue(undefined);
    verifyAgentProvidersMock.mockResolvedValue([]);
    loadEnvironmentConfigMock.mockReturnValue({});
    flushReductionRecordBufferMock.mockResolvedValue(undefined);
  });

  it("routes reduction execution through shared competition adapter and preserves reducer order", async () => {
    resolveReductionCompetitorsMock.mockReturnValue({
      source: "orchestration",
      agentIds: ["gamma", "alpha", "beta"],
      competitors: [
        {
          id: "gamma",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
        {
          id: "alpha",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
        {
          id: "beta",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
      ],
    });

    generateSessionIdMock.mockReturnValue("reduce-123");

    executeCompetitionWithAdapterMock.mockResolvedValue([
      {
        agentId: "gamma",
        outputPath:
          ".voratiq/reductions/sessions/reduce-123/gamma/artifacts/reduction.md",
        dataPath:
          ".voratiq/reductions/sessions/reduce-123/gamma/artifacts/reduction.json",
        status: "succeeded",
      },
      {
        agentId: "alpha",
        outputPath:
          ".voratiq/reductions/sessions/reduce-123/alpha/artifacts/reduction.md",
        dataPath:
          ".voratiq/reductions/sessions/reduce-123/alpha/artifacts/reduction.json",
        status: "succeeded",
      },
      {
        agentId: "beta",
        outputPath:
          ".voratiq/reductions/sessions/reduce-123/beta/artifacts/reduction.md",
        dataPath:
          ".voratiq/reductions/sessions/reduce-123/beta/artifacts/reduction.json",
        status: "failed",
        error: "reducer failed",
      },
    ]);

    readReductionRecordsMock.mockImplementation((options) => {
      const record: ReductionRecord = {
        sessionId: "reduce-123",
        target: { type: "run", id: "run-123" },
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:05.000Z",
        status: "failed",
        reducers: [
          {
            agentId: "gamma",
            status: "succeeded",
            outputPath:
              ".voratiq/reductions/sessions/reduce-123/gamma/artifacts/reduction.md",
            dataPath:
              ".voratiq/reductions/sessions/reduce-123/gamma/artifacts/reduction.json",
          },
        ],
        error: null,
      };
      return Promise.resolve(options.predicate?.(record) ? [record] : []);
    });

    const result = await executeReduceCommand({
      root: "/repo",
      specsFilePath: "/repo/.voratiq/specs/index.json",
      runsFilePath: "/repo/.voratiq/runs/index.json",
      reductionsFilePath: "/repo/.voratiq/reductions/index.json",
      verificationsFilePath: "/repo/.voratiq/verifications/index.json",
      target: { type: "run", id: "run-123" },
      maxParallel: 10,
    });

    expect(verifyAgentProvidersMock).toHaveBeenCalledWith([
      { id: "gamma", provider: "codex" },
      { id: "alpha", provider: "codex" },
      { id: "beta", provider: "codex" },
    ]);

    expect(executeCompetitionWithAdapterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxParallel: 3,
        candidates: [
          expect.objectContaining({ id: "gamma" }),
          expect.objectContaining({ id: "alpha" }),
          expect.objectContaining({ id: "beta" }),
        ],
        adapter: expect.any(Object),
      }),
    );
    expect(result.reducerAgentIds).toEqual(["gamma", "alpha", "beta"]);
    expect(result.reductions.map((entry) => entry.agentId)).toEqual([
      "gamma",
      "alpha",
      "beta",
    ]);
  });

  it("passes staged extra-context references into the reduce adapter", async () => {
    const createAdapterSpy = jest.spyOn(
      reduceAdapter,
      "createReduceCompetitionAdapter",
    );

    resolveReductionCompetitorsMock.mockReturnValue({
      source: "orchestration",
      agentIds: ["alpha"],
      competitors: [
        {
          id: "alpha",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
      ],
    });

    generateSessionIdMock.mockReturnValue("reduce-123");

    executeCompetitionWithAdapterMock.mockResolvedValue([
      {
        agentId: "alpha",
        outputPath:
          ".voratiq/reductions/sessions/reduce-123/alpha/artifacts/reduction.md",
        dataPath:
          ".voratiq/reductions/sessions/reduce-123/alpha/artifacts/reduction.json",
        status: "succeeded",
      },
    ]);

    readReductionRecordsMock.mockResolvedValue([
      {
        sessionId: "reduce-123",
        target: { type: "spec", id: "spec-123" },
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:05.000Z",
        status: "succeeded",
        reducers: [
          {
            agentId: "alpha",
            status: "succeeded",
            outputPath:
              ".voratiq/reductions/sessions/reduce-123/alpha/artifacts/reduction.md",
            dataPath:
              ".voratiq/reductions/sessions/reduce-123/alpha/artifacts/reduction.json",
          },
        ],
        error: null,
      },
    ]);

    const extraContextFiles = [
      {
        absolutePath: "/repo/notes/a.md",
        displayPath: "notes/a.md",
        stagedRelativePath: "../context/a.md",
      },
    ];

    await executeReduceCommand({
      root: "/repo",
      specsFilePath: "/repo/.voratiq/specs/index.json",
      runsFilePath: "/repo/.voratiq/runs/index.json",
      reductionsFilePath: "/repo/.voratiq/reductions/index.json",
      verificationsFilePath: "/repo/.voratiq/verifications/index.json",
      target: { type: "spec", id: "spec-123" },
      extraContextFiles,
    });

    expect(createAdapterSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        extraContextFiles,
      }),
    );

    createAdapterSpy.mockRestore();
  });

  it("drives reduce progress renderer lifecycle", async () => {
    resolveReductionCompetitorsMock.mockReturnValue({
      source: "orchestration",
      agentIds: ["alpha"],
      competitors: [
        {
          id: "alpha",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
      ],
    });

    generateSessionIdMock.mockReturnValue("reduce-123");
    executeCompetitionWithAdapterMock.mockResolvedValue([
      {
        agentId: "alpha",
        outputPath:
          ".voratiq/reductions/sessions/reduce-123/alpha/artifacts/reduction.md",
        dataPath:
          ".voratiq/reductions/sessions/reduce-123/alpha/artifacts/reduction.json",
        status: "succeeded",
      },
    ]);
    readReductionRecordsMock.mockResolvedValue([
      {
        sessionId: "reduce-123",
        target: { type: "run", id: "run-123" },
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:01.000Z",
        completedAt: "2026-01-01T00:00:05.000Z",
        status: "succeeded",
        reducers: [
          {
            agentId: "alpha",
            status: "succeeded",
            outputPath:
              ".voratiq/reductions/sessions/reduce-123/alpha/artifacts/reduction.md",
            dataPath:
              ".voratiq/reductions/sessions/reduce-123/alpha/artifacts/reduction.json",
          },
        ],
        error: null,
      },
    ]);

    const renderer: jest.Mocked<ReduceProgressRenderer> = {
      onProgressEvent: jest.fn(),
      begin: jest.fn(),
      update: jest.fn(),
      complete: jest.fn(),
    };

    await executeReduceCommand({
      root: "/repo",
      specsFilePath: "/repo/.voratiq/specs/index.json",
      runsFilePath: "/repo/.voratiq/runs/index.json",
      reductionsFilePath: "/repo/.voratiq/reductions/index.json",
      verificationsFilePath: "/repo/.voratiq/verifications/index.json",
      target: { type: "run", id: "run-123" },
      renderer,
    });

    expect(renderer.begin.mock.calls[0]?.[0]).toEqual({
      reductionId: "reduce-123",
      createdAt: expect.any(String),
      sourceLabel: "Run",
      sourcePath: ".voratiq/runs/sessions/run-123",
      workspacePath: ".voratiq/reductions/sessions/reduce-123",
      status: "running",
    });
    expect(renderer.complete.mock.calls[0]).toEqual([
      "succeeded",
      {
        startedAt: "2026-01-01T00:00:01.000Z",
        completedAt: "2026-01-01T00:00:05.000Z",
      },
    ]);
  });

  it("fails preflight before execution when any reducer provider/auth check fails", async () => {
    resolveReductionCompetitorsMock.mockReturnValue({
      source: "orchestration",
      agentIds: ["reducer-a", "reducer-b"],
      competitors: [
        {
          id: "reducer-a",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
        {
          id: "reducer-b",
          provider: "claude",
          model: "claude-sonnet",
          binary: "node",
          argv: [],
        },
      ],
    });

    verifyAgentProvidersMock.mockResolvedValue([
      { agentId: "reducer-a", message: "token expired" },
      { agentId: "reducer-b", message: "missing provider" },
    ]);

    let caught: unknown;
    try {
      await executeReduceCommand({
        root: "/repo",
        specsFilePath: "/repo/.voratiq/specs/index.json",
        runsFilePath: "/repo/.voratiq/runs/index.json",
        reductionsFilePath: "/repo/.voratiq/reductions/index.json",
        verificationsFilePath: "/repo/.voratiq/verifications/index.json",
        target: { type: "run", id: "run-123" },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ReducePreflightError);
    const preflight = caught as ReducePreflightError;
    expect(preflight.headline).toBe("Preflight failed. Aborting reduction.");
    expect(preflight.detailLines).toEqual(
      expect.arrayContaining([
        "- reducer-a: token expired",
        "- reducer-b: missing provider",
      ]),
    );
    expect(generateSessionIdMock).not.toHaveBeenCalled();
    expect(executeCompetitionWithAdapterMock).not.toHaveBeenCalled();
  });
});
