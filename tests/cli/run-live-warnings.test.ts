import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { checkPlatformSupport } from "../../src/agents/runtime/sandbox.js";
import { AppApiError } from "../../src/app-session/api-client.js";
import { uploadAppWorkflowSessionBestEffort } from "../../src/app-session/workflow-upload.js";
import { promptForRepositoryLinkIfNeeded } from "../../src/cli/repository-link.js";
import { runRunCommand } from "../../src/cli/run.js";
import { executeRunCommand } from "../../src/commands/run/command.js";
import { resolveExtraContextFiles } from "../../src/competition/shared/extra-context.js";
import {
  ensureCleanWorkingTree,
  ensureSandboxDependencies,
  ensureSpecPath,
  resolveCliContext,
} from "../../src/preflight/index.js";
import { createRunRecord } from "../support/factories/run-records.js";

jest.mock("../../src/agents/runtime/sandbox.js", () => ({
  checkPlatformSupport: jest.fn(),
}));

jest.mock("../../src/competition/shared/extra-context.js", () => ({
  resolveExtraContextFiles: jest.fn(),
}));

jest.mock("../../src/preflight/index.js", () => ({
  ensureCleanWorkingTree: jest.fn(),
  ensureSandboxDependencies: jest.fn(),
  ensureSpecPath: jest.fn(),
  resolveCliContext: jest.fn(),
}));

jest.mock("../../src/commands/run/command.js", () => ({
  executeRunCommand: jest.fn(),
}));

jest.mock("../../src/cli/repository-link.js", () => ({
  promptForRepositoryLinkIfNeeded: jest.fn(),
}));

const checkPlatformSupportMock = jest.mocked(checkPlatformSupport);
const resolveExtraContextFilesMock = jest.mocked(resolveExtraContextFiles);
const resolveCliContextMock = jest.mocked(resolveCliContext);
const ensureSandboxDependenciesMock = jest.mocked(ensureSandboxDependencies);
const ensureCleanWorkingTreeMock = jest.mocked(ensureCleanWorkingTree);
const ensureSpecPathMock = jest.mocked(ensureSpecPath);
const executeRunCommandMock = jest.mocked(executeRunCommand);
const promptForRepositoryLinkIfNeededMock = jest.mocked(
  promptForRepositoryLinkIfNeeded,
);

describe("run live hosted upload warnings", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    checkPlatformSupportMock.mockImplementation(() => {});
    ensureSandboxDependenciesMock.mockImplementation(() => {});
    ensureCleanWorkingTreeMock.mockResolvedValue({
      cleanWorkingTree: true,
    });
    ensureSpecPathMock.mockResolvedValue({
      absolutePath: "/repo/specs/task.md",
      displayPath: "specs/task.md",
    });
    resolveExtraContextFilesMock.mockResolvedValue([]);
    promptForRepositoryLinkIfNeededMock.mockResolvedValue();
    resolveCliContextMock.mockResolvedValue({
      root: "/repo",
      workspaceAutoInitialized: false,
      workspacePaths: {
        root: "/repo",
        workspaceDir: "/repo/.voratiq",
        specsFile: "/repo/.voratiq/spec/index.json",
        specsDir: "/repo/.voratiq/spec",
        runsFile: "/repo/.voratiq/run/index.json",
        runsDir: "/repo/.voratiq/run",
        reductionsDir: "/repo/.voratiq/reduce",
        reductionsFile: "/repo/.voratiq/reduce/index.json",
        verificationsDir: "/repo/.voratiq/verify",
        verificationsFile: "/repo/.voratiq/verify/index.json",
      },
    });
  });

  it("defers hosted upload warnings until after live TTY rendering completes", async () => {
    const stdoutWrites: string[] = [];
    const stderrWrites: string[] = [];
    const consoleWarnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      executeRunCommandMock.mockImplementation(async (input) => {
        input.renderer?.begin({
          runId: "run-123",
          status: "running",
          workspacePath: ".voratiq/run/sessions/run-123",
          createdAt: "2026-04-26T00:00:00.000Z",
          startedAt: "2026-04-26T00:00:00.000Z",
        });
        input.renderer?.update({
          agentId: "agent-a",
          model: "test-model",
          status: "running",
          startedAt: "2026-04-26T00:00:00.000Z",
        });

        await uploadAppWorkflowSessionBestEffort(
          {
            operator: "run",
            root: "/repo",
            record: createRunRecord({
              runId: "run-123",
              status: "running",
              createdAt: "2026-04-26T00:00:00.000Z",
              startedAt: "2026-04-26T00:00:00.000Z",
              spec: { path: "specs/task.md" },
              agents: [],
            }),
            recordUpdatedAt: "2026-04-26T00:00:01.000Z",
          },
          {
            createAppWorkflowSession: () =>
              Promise.reject(
                new AppApiError("Unauthorized", "unauthorized", 401),
              ),
            resolveRepositoryLink: () =>
              Promise.resolve({
                kind: "linked",
                localRepoKey: "repo-local-key",
              }),
            warningCache: new Set<string>(),
          },
        );

        expect(consoleWarnSpy).not.toHaveBeenCalled();
        expect(stderrWrites).toEqual([]);

        return {
          runId: "run-123",
          spec: { path: "specs/task.md" },
          status: "succeeded",
          createdAt: "2026-04-26T00:00:00.000Z",
          startedAt: "2026-04-26T00:00:00.000Z",
          completedAt: "2026-04-26T00:00:05.000Z",
          baseRevisionSha: "abc123",
          agents: [],
          hadAgentFailure: false,
        };
      });

      const result = await runRunCommand({
        specPath: "specs/task.md",
        writeOutput: () => {},
        stdout: {
          isTTY: true,
          write: (value: string | Uint8Array): boolean => {
            stdoutWrites.push(
              typeof value === "string" ? value : value.toString(),
            );
            return true;
          },
        },
        stderr: {
          isTTY: true,
          write: (value: string | Uint8Array): boolean => {
            stderrWrites.push(
              typeof value === "string" ? value : value.toString(),
            );
            return true;
          },
        },
      });

      expect(result.body).toContain("voratiq verify --run run-123");
      expect(stdoutWrites.join("")).toContain("run-123");
      expect(stdoutWrites.join("")).not.toContain("App workflow upload");
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(stderrWrites.join("")).toContain(
        "[voratiq] App workflow upload skipped. Run `voratiq login`.",
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });
});
