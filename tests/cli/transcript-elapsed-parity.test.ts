import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { checkPlatformSupport } from "../../src/agents/runtime/sandbox.js";
import { runReduceCommand } from "../../src/cli/reduce.js";
import { runReviewCommand } from "../../src/cli/review.js";
import { runRunCommand } from "../../src/cli/run.js";
import { executeReduceCommand } from "../../src/commands/reduce/command.js";
import { executeReviewCommand } from "../../src/commands/review/command.js";
import { executeRunCommand } from "../../src/commands/run/command.js";
import { readReductionRecords } from "../../src/domains/reductions/persistence/adapter.js";
import { readReviewRecords } from "../../src/domains/reviews/persistence/adapter.js";
import {
  ensureCleanWorkingTree,
  ensureSandboxDependencies,
  ensureSpecPath,
  resolveCliContext,
} from "../../src/preflight/index.js";
import { createRunReport } from "../support/factories/run-records.js";

jest.mock("../../src/agents/runtime/sandbox.js", () => ({
  checkPlatformSupport: jest.fn(),
}));

jest.mock("../../src/preflight/index.js", () => ({
  resolveCliContext: jest.fn(),
  ensureSandboxDependencies: jest.fn(),
  ensureCleanWorkingTree: jest.fn(),
  ensureSpecPath: jest.fn(),
}));

jest.mock("../../src/commands/run/command.js", () => ({
  executeRunCommand: jest.fn(),
}));

jest.mock("../../src/commands/review/command.js", () => ({
  executeReviewCommand: jest.fn(),
}));

jest.mock("../../src/commands/reduce/command.js", () => ({
  executeReduceCommand: jest.fn(),
}));

jest.mock("../../src/domains/reviews/persistence/adapter.js", () => ({
  readReviewRecords: jest.fn(),
}));

jest.mock("../../src/domains/reductions/persistence/adapter.js", () => ({
  readReductionRecords: jest.fn(),
}));

const checkPlatformSupportMock = jest.mocked(checkPlatformSupport);
const resolveCliContextMock = jest.mocked(resolveCliContext);
const ensureSandboxDependenciesMock = jest.mocked(ensureSandboxDependencies);
const ensureCleanWorkingTreeMock = jest.mocked(ensureCleanWorkingTree);
const ensureSpecPathMock = jest.mocked(ensureSpecPath);
const executeRunCommandMock = jest.mocked(executeRunCommand);
const executeReviewCommandMock = jest.mocked(executeReviewCommand);
const executeReduceCommandMock = jest.mocked(executeReduceCommand);
const readReviewRecordsMock = jest.mocked(readReviewRecords);
const readReductionRecordsMock = jest.mocked(readReductionRecords);

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function extractElapsedValue(value: string): string {
  const match = stripAnsi(value).match(/^\s*Elapsed\s+(.+)$/mu);
  if (!match?.[1]) {
    throw new Error(`Expected transcript to contain an Elapsed row.\n${value}`);
  }

  return match[1].trim();
}

describe("transcript elapsed parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkPlatformSupportMock.mockImplementation(() => {});
    ensureSandboxDependenciesMock.mockImplementation(() => {});
    ensureCleanWorkingTreeMock.mockResolvedValue({
      cleanWorkingTree: true,
    });
    ensureSpecPathMock.mockResolvedValue({
      absolutePath: "/repo/specs/parity.md",
      displayPath: "specs/parity.md",
    });
    resolveCliContextMock.mockResolvedValue({
      root: "/repo",
      workspaceAutoInitialized: false,
      workspacePaths: {
        root: "/repo",
        workspaceDir: "/repo/.voratiq",
        runsDir: "/repo/.voratiq/runs",
        runsFile: "/repo/.voratiq/runs/index.json",
        reviewsDir: "/repo/.voratiq/reviews",
        reviewsFile: "/repo/.voratiq/reviews/index.json",
        reductionsDir: "/repo/.voratiq/reductions",
        reductionsFile: "/repo/.voratiq/reductions/index.json",
        specsDir: "/repo/.voratiq/specs",
        specsFile: "/repo/.voratiq/specs/index.json",
      },
    });
  });

  it("keeps run, review, and reduce elapsed labels in sync", async () => {
    executeRunCommandMock.mockResolvedValue(
      createRunReport({
        runId: "run-123",
        status: "succeeded",
        spec: { path: "specs/parity.md" },
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:10.000Z",
        completedAt: "2026-01-01T00:01:05.000Z",
        baseRevisionSha: "abc12345def67890abc12345def67890abc12345",
        agents: [],
      }),
    );

    executeReviewCommandMock.mockResolvedValue({
      reviewId: "review-123",
      runRecord: { runId: "run-123" },
      reviews: [],
    } as unknown as Awaited<ReturnType<typeof executeReviewCommand>>);
    readReviewRecordsMock.mockResolvedValue([
      {
        sessionId: "review-123",
        runId: "run-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:10.000Z",
        completedAt: "2026-01-01T00:01:05.000Z",
        status: "succeeded",
        reviewers: [],
        error: null,
      },
    ]);

    executeReduceCommandMock.mockResolvedValue({
      reductionId: "reduce-123",
      target: { type: "run", id: "run-123" },
      reducerAgentIds: [],
      reductions: [],
    } as unknown as Awaited<ReturnType<typeof executeReduceCommand>>);
    readReductionRecordsMock.mockResolvedValue([
      {
        sessionId: "reduce-123",
        target: { type: "run", id: "run-123" },
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:10.000Z",
        completedAt: "2026-01-01T00:01:05.000Z",
        status: "succeeded",
        reducers: [],
        error: null,
      },
    ]);

    const [runResult, reviewResult, reduceResult] = await Promise.all([
      runRunCommand({
        specPath: "specs/parity.md",
        stdout: { isTTY: false, write: () => true },
        stderr: { isTTY: false, write: () => true },
        writeOutput: () => undefined,
      }),
      runReviewCommand({
        runId: "run-123",
        stdout: { isTTY: false, write: () => true },
        stderr: { isTTY: false, write: () => true },
        writeOutput: () => undefined,
      }),
      runReduceCommand({
        target: { type: "run", id: "run-123" },
        stdout: { isTTY: false, write: () => true },
        writeOutput: () => undefined,
      }),
    ]);

    expect({
      run: extractElapsedValue(runResult.body),
      review: extractElapsedValue(reviewResult.body),
      reduce: extractElapsedValue(reduceResult.body),
    }).toMatchInlineSnapshot(`
      {
        "reduce": "55s",
        "review": "55s",
        "run": "55s",
      }
    `);
  });
});
