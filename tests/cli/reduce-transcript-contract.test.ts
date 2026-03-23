import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { checkPlatformSupport } from "../../src/agents/runtime/sandbox.js";
import { runReduceCommand } from "../../src/cli/reduce.js";
import { executeReduceCommand } from "../../src/commands/reduce/command.js";
import { readReductionRecords } from "../../src/domains/reductions/persistence/adapter.js";
import {
  ensureSandboxDependencies,
  resolveCliContext,
} from "../../src/preflight/index.js";

jest.mock("node:fs/promises", () => ({
  readFile: jest.fn(),
}));

jest.mock("../../src/agents/runtime/sandbox.js", () => ({
  checkPlatformSupport: jest.fn(),
}));

jest.mock("../../src/preflight/index.js", () => ({
  resolveCliContext: jest.fn(),
  ensureSandboxDependencies: jest.fn(),
}));

jest.mock("../../src/commands/reduce/command.js", () => ({
  executeReduceCommand: jest.fn(),
}));

jest.mock("../../src/domains/reductions/persistence/adapter.js", () => ({
  readReductionRecords: jest.fn(),
}));

const readFileMock = jest.mocked(readFile);
const checkPlatformSupportMock = jest.mocked(checkPlatformSupport);
const resolveCliContextMock = jest.mocked(resolveCliContext);
const ensureSandboxDependenciesMock = jest.mocked(ensureSandboxDependencies);
const executeReduceCommandMock = jest.mocked(executeReduceCommand);
const readReductionRecordsMock = jest.mocked(readReductionRecords);

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

describe("reduce transcript contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkPlatformSupportMock.mockImplementation(() => {});
    ensureSandboxDependenciesMock.mockImplementation(() => {});
    resolveCliContextMock.mockResolvedValue({
      root: "/repo",
      workspacePaths: {
        root: "/repo",
        workspaceDir: "/repo/.voratiq",
        runsDir: "/repo/.voratiq/runs",
        runsFile: "/repo/.voratiq/runs/index.json",
        reductionsDir: "/repo/.voratiq/reductions",
        reductionsFile: "/repo/.voratiq/reductions/index.json",
        specsDir: "/repo/.voratiq/specs",
        specsFile: "/repo/.voratiq/specs/index.json",
        verificationsDir: "/repo/.voratiq/verifications",
        verificationsFile: "/repo/.voratiq/verifications/index.json",
      },
    });
  });

  it("renders mixed-outcome reducers without a continuation hint", async () => {
    executeReduceCommandMock.mockResolvedValue({
      reductionId: "reduce-123",
      target: { type: "run", id: "run-123" },
      reducerAgentIds: ["alpha", "beta", "gamma"],
      reductions: [],
    } as unknown as Awaited<ReturnType<typeof executeReduceCommand>>);

    readReductionRecordsMock.mockResolvedValue([
      {
        sessionId: "reduce-123",
        target: { type: "run", id: "run-123" },
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:10.000Z",
        status: "failed",
        reducers: [
          {
            agentId: "alpha",
            status: "succeeded",
            outputPath:
              ".voratiq/reductions/sessions/reduce-123/alpha/artifacts/reduction.md",
            dataPath:
              ".voratiq/reductions/sessions/reduce-123/alpha/artifacts/reduction.json",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:02.000Z",
            error: null,
          },
          {
            agentId: "beta",
            status: "succeeded",
            outputPath:
              ".voratiq/reductions/sessions/reduce-123/beta/artifacts/reduction.md",
            dataPath:
              ".voratiq/reductions/sessions/reduce-123/beta/artifacts/reduction.json",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:03.000Z",
            error: null,
          },
          {
            agentId: "gamma",
            status: "failed",
            outputPath:
              ".voratiq/reductions/sessions/reduce-123/gamma/artifacts/reduction.md",
            dataPath:
              ".voratiq/reductions/sessions/reduce-123/gamma/artifacts/reduction.json",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:04.000Z",
            error: "reducer failed",
          },
        ],
        error: null,
      },
    ]);

    readFileMock.mockResolvedValue(
      "## Reduction\n**Sources**: x\n**Summary**: ok\n",
    );

    const result = await runReduceCommand({
      target: { type: "run", id: "run-123" },
      stdout: { write: () => true, isTTY: false },
      writeOutput: () => undefined,
    });

    const body = stripAnsi(result.body);
    expect(body).toContain("reduce-123");
    expect(body).toContain("Workspace");
    expect(body).toContain("Reducer: alpha");
    expect(body).toContain("Reducer: beta");
    expect(body).toContain("Reducer: gamma");
    expect(body).toContain("SUCCEEDED");
    expect(body).toContain("FAILED");

    expect(body).not.toContain("Next:");
    expect(body).not.toContain("--extra-context");
  });

  it("does not emit a continuation hint for verification targets either", async () => {
    executeReduceCommandMock.mockResolvedValue({
      reductionId: "reduce-789",
      target: { type: "verification", id: "verify-123" },
      reducerAgentIds: ["alpha"],
      reductions: [],
    } as unknown as Awaited<ReturnType<typeof executeReduceCommand>>);

    readReductionRecordsMock.mockResolvedValue([
      {
        sessionId: "reduce-789",
        target: { type: "verification", id: "verify-123" },
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:10.000Z",
        status: "succeeded",
        reducers: [
          {
            agentId: "alpha",
            status: "succeeded",
            outputPath:
              ".voratiq/reductions/sessions/reduce-789/alpha/artifacts/reduction.md",
            dataPath:
              ".voratiq/reductions/sessions/reduce-789/alpha/artifacts/reduction.json",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:02.000Z",
            error: null,
          },
        ],
        error: null,
      },
    ]);

    readFileMock.mockResolvedValue(
      "## Reduction\n**Sources**: x\n**Summary**: ok\n",
    );
    const result = await runReduceCommand({
      target: { type: "verification", id: "verify-123" },
      stdout: { write: () => true, isTTY: false },
      writeOutput: () => undefined,
    });

    const body = stripAnsi(result.body);
    expect(body).not.toContain("Next:");
    expect(body).not.toContain("--extra-context");
  });

  it("does not emit reuse hints on full failure", async () => {
    executeReduceCommandMock.mockResolvedValue({
      reductionId: "reduce-456",
      target: { type: "verification", id: "verify-123" },
      reducerAgentIds: ["alpha", "beta"],
      reductions: [],
    } as unknown as Awaited<ReturnType<typeof executeReduceCommand>>);

    readReductionRecordsMock.mockResolvedValue([
      {
        sessionId: "reduce-456",
        target: { type: "verification", id: "verify-123" },
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:10.000Z",
        status: "failed",
        reducers: [
          {
            agentId: "alpha",
            status: "failed",
            outputPath:
              ".voratiq/reductions/sessions/reduce-456/alpha/artifacts/reduction.md",
            dataPath:
              ".voratiq/reductions/sessions/reduce-456/alpha/artifacts/reduction.json",
            completedAt: "2026-01-01T00:00:02.000Z",
            error: "boom",
          },
          {
            agentId: "beta",
            status: "failed",
            outputPath:
              ".voratiq/reductions/sessions/reduce-456/beta/artifacts/reduction.md",
            dataPath:
              ".voratiq/reductions/sessions/reduce-456/beta/artifacts/reduction.json",
            completedAt: "2026-01-01T00:00:03.000Z",
            error: "boom",
          },
        ],
        error: null,
      },
    ]);

    const result = await runReduceCommand({
      target: { type: "verification", id: "verify-123" },
      stdout: { write: () => true, isTTY: true },
      writeOutput: () => undefined,
    });

    const body = stripAnsi(result.body);
    expect(body).toContain("Reducer: alpha");
    expect(body).toContain("Reducer: beta");
    expect(body).toContain("Error:");
    expect(body).not.toContain("Next:");
    expect(body).not.toContain("--extra-context");
  });
});
