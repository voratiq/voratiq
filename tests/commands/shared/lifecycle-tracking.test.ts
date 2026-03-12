import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import {
  buildLifecycleStartFields,
  buildOperationLifecycleCompleteFields,
  buildRecordLifecycleCompleteFields,
  resolveLifecycleExecutionDurationMs,
} from "../../../src/domains/shared/lifecycle.js";
import {
  TERMINAL_REDUCTION_STATUSES,
  TERMINAL_REVIEW_STATUSES,
  TERMINAL_RUN_STATUSES,
  TERMINAL_SPEC_STATUSES,
} from "../../../src/status/index.js";

const STARTED_AT = "2026-01-01T00:01:00.000Z";
const COMPLETED_AT = "2026-01-01T00:05:00.000Z";
const NOW_ISO = "2026-01-01T00:10:00.000Z";

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(NOW_ISO));
});

afterEach(() => {
  jest.useRealTimers();
});

describe("buildLifecycleStartFields", () => {
  it("preserves existing startedAt when present", () => {
    const result = buildLifecycleStartFields({
      existingStartedAt: STARTED_AT,
      timestamp: "2026-06-01T00:00:00.000Z",
    });
    expect(result.startedAt).toBe(STARTED_AT);
  });

  it("uses supplied timestamp when startedAt is undefined", () => {
    const result = buildLifecycleStartFields({
      existingStartedAt: undefined,
      timestamp: STARTED_AT,
    });
    expect(result.startedAt).toBe(STARTED_AT);
  });

  it("falls back to current time when both startedAt and timestamp are undefined", () => {
    const result = buildLifecycleStartFields({
      existingStartedAt: undefined,
    });
    expect(result.startedAt).toBe(NOW_ISO);
  });

  it("produces identical fields for spec-shaped and review-shaped records", () => {
    const specStart = buildLifecycleStartFields({
      existingStartedAt: undefined,
      timestamp: STARTED_AT,
    });
    const reviewStart = buildLifecycleStartFields({
      existingStartedAt: undefined,
      timestamp: STARTED_AT,
    });
    expect(specStart).toEqual(reviewStart);
  });
});

describe("buildRecordLifecycleCompleteFields", () => {
  it("uses existing startedAt and generates completedAt when not provided", () => {
    const result = buildRecordLifecycleCompleteFields({
      existing: {
        startedAt: STARTED_AT,
      },
    });
    expect(result.startedAt).toBe(STARTED_AT);
    expect(result.completedAt).toBe(NOW_ISO);
  });

  it("uses explicit completedAt when provided", () => {
    const result = buildRecordLifecycleCompleteFields({
      existing: {
        startedAt: STARTED_AT,
      },
      completedAt: COMPLETED_AT,
    });
    expect(result.startedAt).toBe(STARTED_AT);
    expect(result.completedAt).toBe(COMPLETED_AT);
  });

  it("preserves existing completedAt when explicit is not provided", () => {
    const result = buildRecordLifecycleCompleteFields({
      existing: {
        startedAt: STARTED_AT,
        completedAt: COMPLETED_AT,
      },
    });
    expect(result.startedAt).toBe(STARTED_AT);
    expect(result.completedAt).toBe(COMPLETED_AT);
  });

  it("rejects completion when canonical startedAt is missing", () => {
    expect(() =>
      buildRecordLifecycleCompleteFields({
        existing: {},
        completedAt: COMPLETED_AT,
      }),
    ).toThrow(/startedAt/u);
  });

  it("produces duration-ready timestamps (completedAt >= startedAt)", () => {
    const result = buildRecordLifecycleCompleteFields({
      existing: {
        startedAt: STARTED_AT,
      },
      completedAt: COMPLETED_AT,
    });
    expect(Date.parse(result.completedAt)).toBeGreaterThanOrEqual(
      Date.parse(result.startedAt),
    );
  });
});

describe("buildOperationLifecycleCompleteFields", () => {
  it("preserves existing startedAt and uses explicit completedAt", () => {
    const result = buildOperationLifecycleCompleteFields({
      existing: { startedAt: STARTED_AT },
      completedAt: COMPLETED_AT,
    });
    expect(result.startedAt).toBe(STARTED_AT);
    expect(result.completedAt).toBe(COMPLETED_AT);
  });

  it("rejects completion when canonical startedAt is missing", () => {
    expect(() =>
      buildOperationLifecycleCompleteFields({
        existing: {},
        completedAt: COMPLETED_AT,
      }),
    ).toThrow(/startedAt/u);
  });

  it("preserves existing completedAt when explicit is not provided", () => {
    const result = buildOperationLifecycleCompleteFields({
      existing: { startedAt: STARTED_AT, completedAt: COMPLETED_AT },
    });
    expect(result.startedAt).toBe(STARTED_AT);
    expect(result.completedAt).toBe(COMPLETED_AT);
  });

  it("generates completedAt from current time when not provided and not existing", () => {
    const result = buildOperationLifecycleCompleteFields({
      existing: { startedAt: STARTED_AT },
    });
    expect(result.startedAt).toBe(STARTED_AT);
    expect(result.completedAt).toBe(NOW_ISO);
  });

  it("produces duration-ready timestamps (completedAt >= startedAt)", () => {
    const result = buildOperationLifecycleCompleteFields({
      existing: { startedAt: STARTED_AT },
      completedAt: COMPLETED_AT,
    });
    expect(Date.parse(result.completedAt)).toBeGreaterThanOrEqual(
      Date.parse(result.startedAt),
    );
  });
});

describe("cross-operator parity: record-level lifecycle complete", () => {
  interface OperatorRecordShape {
    startedAt?: string;
    completedAt?: string;
  }

  function buildCompleteForOperator(existing: OperatorRecordShape) {
    return buildRecordLifecycleCompleteFields({ existing });
  }

  it("all operators produce identical fields when startedAt is already set", () => {
    const base: OperatorRecordShape = {
      startedAt: STARTED_AT,
    };

    const spec = buildCompleteForOperator(base);
    const run = buildCompleteForOperator(base);
    const review = buildCompleteForOperator(base);
    const reduce = buildCompleteForOperator(base);

    expect(spec).toEqual(run);
    expect(run).toEqual(review);
    expect(review).toEqual(reduce);
  });

  it("all operators reject completion when startedAt is missing", () => {
    const base: OperatorRecordShape = {};

    expect(() => buildCompleteForOperator(base)).toThrow(/startedAt/u);
    expect(() => buildCompleteForOperator(base)).toThrow(/startedAt/u);
    expect(() => buildCompleteForOperator(base)).toThrow(/startedAt/u);
    expect(() => buildCompleteForOperator(base)).toThrow(/startedAt/u);
  });

  it("all operators produce the same completedAt when none existed before", () => {
    const base: OperatorRecordShape = {
      startedAt: STARTED_AT,
    };

    const spec = buildCompleteForOperator(base);
    const run = buildCompleteForOperator(base);
    const review = buildCompleteForOperator(base);
    const reduce = buildCompleteForOperator(base);

    expect(spec.completedAt).toBe(NOW_ISO);
    expect(run.completedAt).toBe(NOW_ISO);
    expect(review.completedAt).toBe(NOW_ISO);
    expect(reduce.completedAt).toBe(NOW_ISO);
  });

  it("all operators compute non-negative duration from produced fields", () => {
    const base: OperatorRecordShape = {
      startedAt: STARTED_AT,
    };

    const results = [
      buildCompleteForOperator(base),
      buildCompleteForOperator(base),
      buildCompleteForOperator(base),
      buildCompleteForOperator(base),
    ];

    for (const result of results) {
      const duration =
        Date.parse(result.completedAt) - Date.parse(result.startedAt);
      expect(duration).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("cross-operator parity: operation-level lifecycle complete", () => {
  interface OperationShape {
    startedAt?: string;
    completedAt?: string;
  }

  function buildCompleteForOperation(existing: OperationShape) {
    return buildOperationLifecycleCompleteFields({
      existing,
      completedAt: COMPLETED_AT,
    });
  }

  it("agent/reviewer/reducer operations produce identical fields", () => {
    const runningOp: OperationShape = { startedAt: STARTED_AT };

    const agent = buildCompleteForOperation(runningOp);
    const reviewer = buildCompleteForOperation(runningOp);
    const reducer = buildCompleteForOperation(runningOp);

    expect(agent).toEqual(reviewer);
    expect(reviewer).toEqual(reducer);
  });

  it("queued operations (never started) are rejected", () => {
    const queuedOp: OperationShape = {};

    expect(() => buildCompleteForOperation(queuedOp)).toThrow(/startedAt/u);
    expect(() => buildCompleteForOperation(queuedOp)).toThrow(/startedAt/u);
    expect(() => buildCompleteForOperation(queuedOp)).toThrow(/startedAt/u);
  });

  it("all operations compute non-negative duration", () => {
    const ops: OperationShape[] = [
      { startedAt: STARTED_AT },
      { startedAt: STARTED_AT, completedAt: COMPLETED_AT },
    ];

    for (const op of ops) {
      const result = buildCompleteForOperation(op);
      const duration =
        Date.parse(result.completedAt) - Date.parse(result.startedAt);
      expect(duration).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("lifecycle start → complete sequencing", () => {
  it("start then complete produces monotonic timestamps", () => {
    const startResult = buildLifecycleStartFields({
      existingStartedAt: undefined,
      timestamp: STARTED_AT,
    });

    const completeResult = buildRecordLifecycleCompleteFields({
      existing: {
        startedAt: startResult.startedAt,
      },
      completedAt: COMPLETED_AT,
    });

    expect(Date.parse(completeResult.completedAt)).toBeGreaterThanOrEqual(
      Date.parse(completeResult.startedAt),
    );
    expect(completeResult.startedAt).toBe(STARTED_AT);
    expect(completeResult.completedAt).toBe(COMPLETED_AT);
  });

  it("operation start then complete produces monotonic timestamps", () => {
    const startResult = buildLifecycleStartFields({
      existingStartedAt: undefined,
      timestamp: STARTED_AT,
    });

    const completeResult = buildOperationLifecycleCompleteFields({
      existing: { startedAt: startResult.startedAt },
      completedAt: COMPLETED_AT,
    });

    expect(Date.parse(completeResult.completedAt)).toBeGreaterThanOrEqual(
      Date.parse(completeResult.startedAt),
    );
    expect(completeResult.startedAt).toBe(STARTED_AT);
    expect(completeResult.completedAt).toBe(COMPLETED_AT);
  });
});

describe("abort lifecycle parity", () => {
  const ABORT_TIME = "2026-01-01T00:03:00.000Z";

  it("record-level abort uses same helper as normal completion", () => {
    const runRecord = {
      startedAt: STARTED_AT,
    };
    const reviewRecord = {
      startedAt: STARTED_AT,
    };

    const runAbort = buildRecordLifecycleCompleteFields({
      existing: runRecord,
      completedAt: ABORT_TIME,
    });
    const reviewAbort = buildRecordLifecycleCompleteFields({
      existing: reviewRecord,
      completedAt: ABORT_TIME,
    });

    expect(runAbort).toEqual(reviewAbort);
    expect(runAbort.completedAt).toBe(ABORT_TIME);
    expect(runAbort.startedAt).toBe(STARTED_AT);
  });

  it("operation-level abort produces consistent fields for agents/reviewers/reducers", () => {
    const runningOp = { startedAt: STARTED_AT };
    const queuedOp = {};

    const agentRunning = buildOperationLifecycleCompleteFields({
      existing: runningOp,
      completedAt: ABORT_TIME,
    });
    const reviewerRunning = buildOperationLifecycleCompleteFields({
      existing: runningOp,
      completedAt: ABORT_TIME,
    });
    const reducerRunning = buildOperationLifecycleCompleteFields({
      existing: runningOp,
      completedAt: ABORT_TIME,
    });

    expect(agentRunning).toEqual(reviewerRunning);
    expect(reviewerRunning).toEqual(reducerRunning);

    const agentQueued = buildOperationLifecycleCompleteFields({
      existing: queuedOp,
      startedAt: ABORT_TIME,
      completedAt: ABORT_TIME,
    });
    const reviewerQueued = buildOperationLifecycleCompleteFields({
      existing: queuedOp,
      startedAt: ABORT_TIME,
      completedAt: ABORT_TIME,
    });
    const reducerQueued = buildOperationLifecycleCompleteFields({
      existing: queuedOp,
      startedAt: ABORT_TIME,
      completedAt: ABORT_TIME,
    });

    expect(agentQueued).toEqual(reviewerQueued);
    expect(reviewerQueued).toEqual(reducerQueued);
    expect(agentQueued.startedAt).toBe(ABORT_TIME);
  });
});

describe("cross-operator parity: lifecycle execution duration", () => {
  const RUNNING_NOW_MS = Date.parse(NOW_ISO);

  it("uses `now - startedAt` for running statuses across operators", () => {
    const specRunning = resolveLifecycleExecutionDurationMs(
      {
        status: "drafting",
        startedAt: STARTED_AT,
      },
      {
        statusGroups: {
          running: ["drafting", "saving"],
          terminal: TERMINAL_SPEC_STATUSES,
        },
        now: RUNNING_NOW_MS,
      },
    );
    const runRunning = resolveLifecycleExecutionDurationMs(
      {
        status: "running",
        startedAt: STARTED_AT,
      },
      {
        statusGroups: {
          running: ["running"],
          terminal: TERMINAL_RUN_STATUSES,
        },
        now: RUNNING_NOW_MS,
      },
    );
    const reviewRunning = resolveLifecycleExecutionDurationMs(
      {
        status: "running",
        startedAt: STARTED_AT,
      },
      {
        statusGroups: {
          running: ["running"],
          terminal: TERMINAL_REVIEW_STATUSES,
        },
        now: RUNNING_NOW_MS,
      },
    );
    const reduceRunning = resolveLifecycleExecutionDurationMs(
      {
        status: "running",
        startedAt: STARTED_AT,
      },
      {
        statusGroups: {
          running: ["running"],
          terminal: TERMINAL_REDUCTION_STATUSES,
        },
        now: RUNNING_NOW_MS,
      },
    );

    const expectedMs = RUNNING_NOW_MS - Date.parse(STARTED_AT);
    expect(specRunning).toBe(expectedMs);
    expect(runRunning).toBe(expectedMs);
    expect(reviewRunning).toBe(expectedMs);
    expect(reduceRunning).toBe(expectedMs);
  });

  it("uses `completedAt - startedAt` for terminal statuses across operators", () => {
    const specTerminal = resolveLifecycleExecutionDurationMs(
      {
        status: "saved",
        startedAt: STARTED_AT,
        completedAt: COMPLETED_AT,
      },
      {
        statusGroups: {
          running: ["drafting", "saving"],
          terminal: TERMINAL_SPEC_STATUSES,
        },
      },
    );
    const runTerminal = resolveLifecycleExecutionDurationMs(
      {
        status: "succeeded",
        startedAt: STARTED_AT,
        completedAt: COMPLETED_AT,
      },
      {
        statusGroups: {
          running: ["running"],
          terminal: TERMINAL_RUN_STATUSES,
        },
      },
    );
    const reviewTerminal = resolveLifecycleExecutionDurationMs(
      {
        status: "succeeded",
        startedAt: STARTED_AT,
        completedAt: COMPLETED_AT,
      },
      {
        statusGroups: {
          running: ["running"],
          terminal: TERMINAL_REVIEW_STATUSES,
        },
      },
    );
    const reduceTerminal = resolveLifecycleExecutionDurationMs(
      {
        status: "succeeded",
        startedAt: STARTED_AT,
        completedAt: COMPLETED_AT,
      },
      {
        statusGroups: {
          running: ["running"],
          terminal: TERMINAL_REDUCTION_STATUSES,
        },
      },
    );

    const expectedMs = Date.parse(COMPLETED_AT) - Date.parse(STARTED_AT);
    expect(specTerminal).toBe(expectedMs);
    expect(runTerminal).toBe(expectedMs);
    expect(reviewTerminal).toBe(expectedMs);
    expect(reduceTerminal).toBe(expectedMs);
  });

  it("returns undefined for missing or invalid lifecycle timestamps", () => {
    const missingStarted = resolveLifecycleExecutionDurationMs(
      {
        status: "running",
        startedAt: undefined,
      },
      {
        statusGroups: {
          running: ["running"],
          terminal: TERMINAL_RUN_STATUSES,
        },
        now: RUNNING_NOW_MS,
      },
    );
    const missingCompleted = resolveLifecycleExecutionDurationMs(
      {
        status: "succeeded",
        startedAt: STARTED_AT,
        completedAt: undefined,
      },
      {
        statusGroups: {
          running: ["running"],
          terminal: TERMINAL_REVIEW_STATUSES,
        },
      },
    );
    const invertedRange = resolveLifecycleExecutionDurationMs(
      {
        status: "succeeded",
        startedAt: COMPLETED_AT,
        completedAt: STARTED_AT,
      },
      {
        statusGroups: {
          running: ["running"],
          terminal: TERMINAL_REDUCTION_STATUSES,
        },
      },
    );
    const invalidTimestamp = resolveLifecycleExecutionDurationMs(
      {
        status: "drafting",
        startedAt: "not-a-timestamp",
      },
      {
        statusGroups: {
          running: ["drafting", "saving"],
          terminal: TERMINAL_SPEC_STATUSES,
        },
        now: RUNNING_NOW_MS,
      },
    );

    expect(missingStarted).toBeUndefined();
    expect(missingCompleted).toBeUndefined();
    expect(invertedRange).toBeUndefined();
    expect(invalidTimestamp).toBeUndefined();
  });
});
