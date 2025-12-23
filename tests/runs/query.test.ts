import {
  RunRecordNotFoundError,
  RunRecordParseError,
} from "../../src/records/errors.js";
import type {
  ReadRunRecordsOptions,
  RunRecordWarning,
} from "../../src/records/persistence.js";
import {
  buildRunPredicate,
  fetchRuns,
  fetchRunsSafely,
  type RunQueryFilters,
} from "../../src/records/persistence.js";
import type {
  AgentInvocationRecord,
  RunRecord,
} from "../../src/records/types.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../support/factories/run-records.js";
import {
  resetReadRunRecordsImplementation,
  setReadRunRecordsImplementation,
} from "../support/hooks/run-records.js";

const mockedReadRunRecords = jest.fn<
  Promise<RunRecord[]>,
  [ReadRunRecordsOptions]
>();

function createMockAgentRecord(
  overrides: Partial<AgentInvocationRecord> = {},
): AgentInvocationRecord {
  return createAgentInvocationRecord({
    agentId: "test-agent",
    model: "test-model",
    status: "succeeded",
    startedAt: "2024-01-01T00:00:00.000Z",
    completedAt: "2024-01-01T00:01:00.000Z",
    artifacts: {
      stdoutCaptured: true,
      stderrCaptured: true,
    },
    evals: [],
    ...overrides,
  });
}

function createMockRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return createRunRecord({
    runId: "test-run",
    baseRevisionSha: "abc123",
    spec: { path: "test.md" },
    status: "succeeded",
    createdAt: "2024-01-01T00:00:00.000Z",
    agents: [],
    ...overrides,
  });
}

beforeEach(() => {
  mockedReadRunRecords.mockReset();
  setReadRunRecordsImplementation(mockedReadRunRecords);
});

afterEach(() => {
  resetReadRunRecordsImplementation();
  jest.restoreAllMocks();
});

describe("buildRunPredicate", () => {
  it("returns a predicate that accepts all records when no filters are provided", () => {
    const predicate = buildRunPredicate({});
    const record = createMockRunRecord({ runId: "test-run" });

    expect(predicate(record)).toBe(true);
  });

  it("filters by runId", () => {
    const predicate = buildRunPredicate({ runId: "target-run" });
    const matchingRecord = createMockRunRecord({ runId: "target-run" });
    const nonMatchingRecord = createMockRunRecord({ runId: "other-run" });

    expect(predicate(matchingRecord)).toBe(true);
    expect(predicate(nonMatchingRecord)).toBe(false);
  });

  it("filters by agentId", () => {
    const predicate = buildRunPredicate({ agentId: "claude" });
    const matchingRecord = createMockRunRecord({
      agents: [createMockAgentRecord({ agentId: "claude" })],
    });
    const nonMatchingRecord = createMockRunRecord({
      agents: [createMockAgentRecord({ agentId: "gemini" })],
    });

    expect(predicate(matchingRecord)).toBe(true);
    expect(predicate(nonMatchingRecord)).toBe(false);
  });

  it("filters by specPath", () => {
    const predicate = buildRunPredicate({ specPath: "specs/feature.md" });
    const matchingRecord = createMockRunRecord({
      spec: { path: "specs/feature.md" },
    });
    const nonMatchingRecord = createMockRunRecord({
      spec: { path: "specs/other.md" },
    });

    expect(predicate(matchingRecord)).toBe(true);
    expect(predicate(nonMatchingRecord)).toBe(false);
  });

  it("excludes deleted runs by default", () => {
    const predicate = buildRunPredicate({});
    const activeRecord = createMockRunRecord({ deletedAt: undefined });
    const deletedRecord = createMockRunRecord({
      deletedAt: "2024-01-01T00:00:00.000Z",
      status: "pruned",
    });

    expect(predicate(activeRecord)).toBe(true);
    expect(predicate(deletedRecord)).toBe(false);
  });

  it("includes deleted runs when includeDeleted is true", () => {
    const predicate = buildRunPredicate({ includeDeleted: true });
    const activeRecord = createMockRunRecord({ deletedAt: undefined });
    const deletedRecord = createMockRunRecord({
      deletedAt: "2024-01-01T00:00:00.000Z",
      status: "pruned",
    });

    expect(predicate(activeRecord)).toBe(true);
    expect(predicate(deletedRecord)).toBe(true);
  });

  it("applies multiple filters together", () => {
    const filters: RunQueryFilters = {
      runId: "target-run",
      agentId: "claude",
      includeDeleted: false,
    };
    const predicate = buildRunPredicate(filters);

    const fullyMatchingRecord = createMockRunRecord({
      runId: "target-run",
      agents: [createMockAgentRecord({ agentId: "claude" })],
      deletedAt: undefined,
    });

    const wrongRunId = createMockRunRecord({
      runId: "other-run",
      agents: [createMockAgentRecord({ agentId: "claude" })],
      deletedAt: undefined,
    });

    const wrongAgentId = createMockRunRecord({
      runId: "target-run",
      agents: [createMockAgentRecord({ agentId: "gemini" })],
      deletedAt: undefined,
    });

    const deletedRecord = createMockRunRecord({
      runId: "target-run",
      agents: [createMockAgentRecord({ agentId: "claude" })],
      deletedAt: "2024-01-01T00:00:00.000Z",
      status: "pruned",
    });

    expect(predicate(fullyMatchingRecord)).toBe(true);
    expect(predicate(wrongRunId)).toBe(false);
    expect(predicate(wrongAgentId)).toBe(false);
    expect(predicate(deletedRecord)).toBe(false);
  });
});

describe("fetchRuns", () => {
  it("filters records, applies limit, and returns warnings", async () => {
    const records = [
      createMockRunRecord({
        runId: "run-1",
        deletedAt: "2024-01-01T00:00:00.000Z",
        status: "pruned",
      }),
      createMockRunRecord({ runId: "run-2" }),
      createMockRunRecord({ runId: "run-3" }),
    ];
    const warning: RunRecordWarning = {
      kind: "parse-error",
      runId: "run-2",
      recordPath: "/root/.voratiq/runs/sessions/run-2/record.json",
      displayPath: ".voratiq/runs/sessions/run-2/record.json",
      details: "invalid json",
    };
    mockedReadRunRecords.mockImplementation((options) => {
      options.onWarning?.(warning);
      const filtered = options.predicate
        ? records.filter((record) => options.predicate?.(record) ?? true)
        : records;
      const ordered = [...filtered].reverse();
      const limited =
        options.limit !== undefined ? ordered.slice(0, options.limit) : ordered;
      return Promise.resolve(limited);
    });

    const result = await fetchRuns({
      root: "/root",
      runsFilePath: "/root/.voratiq/runs/index.json",
      limit: 1,
    });

    expect(mockedReadRunRecords).toHaveBeenCalledTimes(1);
    const [firstCallOptions] = mockedReadRunRecords.mock.calls[0];
    expect(firstCallOptions.root).toBe("/root");
    expect(firstCallOptions.runsFilePath).toBe(
      "/root/.voratiq/runs/index.json",
    );
    expect(firstCallOptions.limit).toBe(1);
    expect(typeof firstCallOptions.predicate).toBe("function");
    expect(firstCallOptions.onWarning).toBeDefined();
    expect(result.records).toHaveLength(1);
    expect(result.records[0].runId).toBe("run-3");
    expect(result.warnings).toEqual([warning]);
  });
});

describe("fetchRunsSafely", () => {
  it("returns a matching run", async () => {
    const target = createMockRunRecord({ runId: "run-123" });
    mockedReadRunRecords.mockImplementation((options) => {
      const filtered = options.predicate
        ? [target].filter((record) => options.predicate?.(record) ?? true)
        : [target];
      return Promise.resolve(filtered);
    });

    const result = await fetchRunsSafely({
      root: "/root",
      runsFilePath: "/root/.voratiq/runs/index.json",
      runId: "run-123",
    });

    expect(result.records[0]).toBe(target);
    const [callArgs] = mockedReadRunRecords.mock.calls;
    const [callOptions] = callArgs;
    expect(callOptions.root).toBe("/root");
    expect(callOptions.runsFilePath).toBe("/root/.voratiq/runs/index.json");
    expect(callOptions.limit).toBeUndefined();
    expect(typeof callOptions.predicate).toBe("function");
    expect(callOptions.onWarning).toBeDefined();
  });

  it("throws when run is missing", async () => {
    mockedReadRunRecords.mockResolvedValue([]);

    await expect(
      fetchRunsSafely({
        root: "/root",
        runsFilePath: "/root/.voratiq/runs/index.json",
        runId: "run-404",
      }),
    ).rejects.toThrow(RunRecordNotFoundError);
  });

  it("returns deleted run when includeDeleted is true", async () => {
    const deletedRecord = createMockRunRecord({
      runId: "deleted-run",
      deletedAt: "2024-01-01T00:00:00.000Z",
    });
    mockedReadRunRecords.mockResolvedValue([deletedRecord]);

    const result = await fetchRunsSafely({
      root: "/root",
      runsFilePath: "/root/.voratiq/runs/index.json",
      runId: "deleted-run",
      filters: { includeDeleted: true },
    });

    expect(result.records[0]?.runId).toBe("deleted-run");
    expect(result.records[0]?.deletedAt).toBe("2024-01-01T00:00:00.000Z");
  });
  it("throws when storage reports malformed records", async () => {
    mockedReadRunRecords.mockImplementation((options) => {
      options.onWarning?.({
        kind: "parse-error",
        runId: "run-parse",
        recordPath: "/root/.voratiq/runs/sessions/run-parse/record.json",
        displayPath: ".voratiq/runs/sessions/run-parse/record.json",
        details: "bad json",
      });
      return Promise.resolve([]);
    });

    await expect(
      fetchRunsSafely({
        root: "/root",
        runsFilePath: "/root/.voratiq/runs/index.json",
        runId: "run-parse",
      }),
    ).rejects.toThrow(RunRecordParseError);
  });
});
