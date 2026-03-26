import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { VerificationConfig } from "../../../../src/configs/verification/types.js";
import type { RunRecord } from "../../../../src/domain/run/model/types.js";
import { executeAndPersistProgrammaticMethod } from "../../../../src/domain/verify/competition/programmatic.js";
import type { VerificationRecordMutators } from "../../../../src/domain/verify/model/mutators.js";
import { executeProgrammaticChecks } from "../../../../src/domain/verify/programmatic/runner.js";
import {
  createDetachedWorktree,
  removeWorktree,
  runGitCommand,
} from "../../../../src/utils/git.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../../../support/factories/run-records.js";

jest.mock("../../../../src/domain/verify/programmatic/runner.js", () => {
  const actual = jest.requireActual<
    typeof import("../../../../src/domain/verify/programmatic/runner.js")
  >("../../../../src/domain/verify/programmatic/runner.js");
  return {
    ...actual,
    executeProgrammaticChecks: jest.fn(),
  };
});

jest.mock("../../../../src/utils/git.js", () => {
  const actual = jest.requireActual<
    typeof import("../../../../src/utils/git.js")
  >("../../../../src/utils/git.js");
  return {
    ...actual,
    createDetachedWorktree: jest.fn(),
    removeWorktree: jest.fn(),
    runGitCommand: jest.fn(),
  };
});

const executeProgrammaticChecksMock = jest.mocked(executeProgrammaticChecks);
const createDetachedWorktreeMock = jest.mocked(createDetachedWorktree);
const removeWorktreeMock = jest.mocked(removeWorktree);
const runGitCommandMock = jest.mocked(runGitCommand);

const verificationConfig: VerificationConfig = {
  spec: { rubric: [] },
  run: {
    programmatic: [{ slug: "tests", command: "npm test -- --runInBand" }],
    rubric: [],
  },
  reduce: { rubric: [] },
};

describe("executeAndPersistProgrammaticMethod", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reconstructs a temporary workspace for pruned run candidates", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-programmatic-pruned-"));

    try {
      const runId = "run-pruned";
      const candidateId = "agent-1";
      const artifactsDir = join(
        root,
        ".voratiq",
        "run",
        "sessions",
        runId,
        candidateId,
        "artifacts",
      );
      await mkdir(artifactsDir, { recursive: true });
      await writeFile(join(artifactsDir, "diff.patch"), "diff --git\n", "utf8");

      createDetachedWorktreeMock.mockImplementation(async (options) => {
        await mkdir(options.worktreePath, { recursive: true });
      });
      removeWorktreeMock.mockImplementation(async (options) => {
        await rm(options.worktreePath, { recursive: true, force: true });
      });
      runGitCommandMock.mockResolvedValue("");
      executeProgrammaticChecksMock.mockResolvedValue({
        results: [{ slug: "tests", status: "succeeded" }],
        warnings: [],
      });

      const snapshots: unknown[] = [];
      const result = await executeAndPersistProgrammaticMethod({
        root,
        verificationId: "verify-123",
        resolvedTarget: buildRunTarget({
          runId,
          candidateId,
          diffCaptured: true,
        }),
        verificationConfig,
        environment: {},
        mutators: createMutators(snapshots),
      });

      expect(result?.status).toBe("succeeded");
      expect(createDetachedWorktreeMock).toHaveBeenCalledTimes(1);
      expect(runGitCommandMock).toHaveBeenCalledWith(
        [
          "apply",
          "--whitespace=nowarn",
          "--",
          join(artifactsDir, "diff.patch"),
        ],
        expect.objectContaining({
          cwd: expect.stringContaining(
            "/.voratiq/verify/sessions/verify-123/programmatic/reconstructed/agent-1-",
          ),
        }),
      );
      expect(removeWorktreeMock).toHaveBeenCalledTimes(1);
      expect(executeProgrammaticChecksMock).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: expect.stringContaining(
            "/.voratiq/verify/sessions/verify-123/programmatic/reconstructed/agent-1-",
          ),
        }),
      );
      expect(snapshots).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails clearly when a recorded diff artifact is missing during reconstruction", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-programmatic-pruned-missing-"),
    );

    try {
      createDetachedWorktreeMock.mockImplementation(async (options) => {
        await mkdir(options.worktreePath, { recursive: true });
      });
      removeWorktreeMock.mockResolvedValue(undefined);
      runGitCommandMock.mockResolvedValue("");
      executeProgrammaticChecksMock.mockResolvedValue({
        results: [{ slug: "tests", status: "succeeded" }],
        warnings: [],
      });

      const snapshots: Array<{ status?: string; error?: string }> = [];
      const result = await executeAndPersistProgrammaticMethod({
        root,
        verificationId: "verify-456",
        resolvedTarget: buildRunTarget({
          runId: "run-missing-diff",
          candidateId: "agent-1",
          diffCaptured: true,
        }),
        verificationConfig,
        environment: {},
        mutators: createMutators(snapshots),
      });

      expect(result?.status).toBe("failed");
      expect(result?.error).toMatch(/missing required durable diff artifact/iu);
      expect(executeProgrammaticChecksMock).not.toHaveBeenCalled();
      expect(runGitCommandMock).not.toHaveBeenCalled();
      expect(removeWorktreeMock).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats an empty retained diff as a valid no-op during reconstruction", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "voratiq-programmatic-pruned-empty-diff-"),
    );

    try {
      const runId = "run-empty-diff";
      const candidateId = "agent-1";
      const artifactsDir = join(
        root,
        ".voratiq",
        "run",
        "sessions",
        runId,
        candidateId,
        "artifacts",
      );
      await mkdir(artifactsDir, { recursive: true });
      await writeFile(join(artifactsDir, "diff.patch"), "", "utf8");

      createDetachedWorktreeMock.mockImplementation(async (options) => {
        await mkdir(options.worktreePath, { recursive: true });
      });
      removeWorktreeMock.mockImplementation(async (options) => {
        await rm(options.worktreePath, { recursive: true, force: true });
      });
      executeProgrammaticChecksMock.mockResolvedValue({
        results: [{ slug: "tests", status: "succeeded" }],
        warnings: [],
      });

      const snapshots: unknown[] = [];
      const result = await executeAndPersistProgrammaticMethod({
        root,
        verificationId: "verify-empty-diff",
        resolvedTarget: buildRunTarget({
          runId,
          candidateId,
          diffCaptured: true,
        }),
        verificationConfig,
        environment: {},
        mutators: createMutators(snapshots),
      });

      expect(result?.status).toBe("succeeded");
      expect(createDetachedWorktreeMock).toHaveBeenCalledTimes(1);
      expect(runGitCommandMock).not.toHaveBeenCalled();
      expect(executeProgrammaticChecksMock).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: expect.stringContaining(
            "/.voratiq/verify/sessions/verify-empty-diff/programmatic/reconstructed/agent-1-",
          ),
        }),
      );
      expect(removeWorktreeMock).toHaveBeenCalledTimes(1);
      expect(snapshots).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function createMutators(snapshots: unknown[]): VerificationRecordMutators {
  return {
    recordVerificationRunning: () => Promise.resolve(),
    recordMethodSnapshot: (method) => {
      snapshots.push(method);
      return Promise.resolve();
    },
    completeVerification: () =>
      Promise.reject(new Error("not used in programmatic test")),
    readRecord: () => Promise.resolve(undefined),
  };
}

function buildRunTarget(options: {
  runId: string;
  candidateId: string;
  diffCaptured: boolean;
}) {
  const { runId, candidateId, diffCaptured } = options;
  const runRecord: RunRecord = createRunRecord({
    runId,
    status: "pruned",
    deletedAt: new Date().toISOString(),
    agents: [
      createAgentInvocationRecord({
        agentId: candidateId,
        artifacts: {
          diffCaptured,
          summaryCaptured: true,
          stdoutCaptured: true,
          stderrCaptured: true,
        },
      }),
    ],
  });

  return {
    baseRevisionSha: runRecord.baseRevisionSha,
    competitiveCandidates: [
      { canonicalId: candidateId, forbiddenIdentityTokens: [candidateId] },
    ],
    target: {
      kind: "run" as const,
      sessionId: runRecord.runId,
      candidateIds: [candidateId],
    },
    runRecord,
  };
}
