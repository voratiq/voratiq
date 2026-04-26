import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { createReduceCompetitionAdapter } from "../../../../src/domain/reduce/competition/adapter.js";
import { appendRunRecord } from "../../../../src/domain/run/persistence/adapter.js";
import { readSpecRecords } from "../../../../src/domain/spec/persistence/adapter.js";
import { pathExists } from "../../../../src/utils/fs.js";
import { createWorkspace } from "../../../../src/workspace/setup.js";
import {
  createAgentInvocationRecord,
  createRunRecord,
} from "../../../support/factories/run-records.js";

jest.mock("../../../../src/domain/spec/persistence/adapter.js", () => ({
  readSpecRecords: jest.fn(),
}));

const readSpecRecordsMock = jest.mocked(readSpecRecords);

describe("reduce competition teardown", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("retains artifacts while pruning reducer scratch state", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-teardown-"));

    try {
      const sourceDir = join(root, "source");
      await mkdir(sourceDir, { recursive: true });
      const specPath = join(sourceDir, "spec.md");
      const dataPath = join(sourceDir, "spec.json");
      await writeFile(specPath, "# Spec\n", "utf8");
      await writeFile(dataPath, '{"title":"Spec"}\n', "utf8");

      readSpecRecordsMock.mockResolvedValue([
        {
          sessionId: "spec-123",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "succeeded",
          baseRevisionSha: "base-sha",
          description: "Draft a spec",
          agents: [
            {
              agentId: "author",
              status: "succeeded",
              outputPath: "source/spec.md",
              dataPath: "source/spec.json",
            },
          ],
        },
      ] as never);

      const adapter = createReduceCompetitionAdapter({
        root,
        reductionId: "reduce-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        runsFilePath: join(root, ".voratiq", "runs", "index.json"),
        messagesFilePath: join(root, ".voratiq", "message", "index.json"),
        verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
        target: { type: "spec", id: "spec-123" },
        environment: {},
      });

      const preparation = await adapter.prepareCandidates([
        {
          id: "reducer",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
      ]);
      const prepared = preparation.ready[0];
      expect(prepared).toBeDefined();

      const paths = prepared.workspacePaths;
      await mkdir(paths.workspacePath, { recursive: true });
      await mkdir(paths.contextPath, { recursive: true });
      await mkdir(paths.runtimePath, { recursive: true });
      await mkdir(paths.sandboxPath, { recursive: true });
      await mkdir(paths.artifactsPath, { recursive: true });

      await adapter.finalizeCompetition?.();

      await expect(pathExists(paths.workspacePath)).resolves.toBe(false);
      await expect(pathExists(paths.contextPath)).resolves.toBe(false);
      await expect(pathExists(paths.runtimePath)).resolves.toBe(false);
      await expect(pathExists(paths.sandboxPath)).resolves.toBe(false);
      await expect(pathExists(paths.artifactsPath)).resolves.toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stages only succeeded reducers when reducing a mixed-outcome reduction session", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-source-"));

    try {
      await createWorkspace(root);

      const sourceReductionId = "reduce-source";
      const succeededOutput = `.voratiq/reduce/sessions/${sourceReductionId}/alpha/artifacts/reduction.md`;
      const succeededData = `.voratiq/reduce/sessions/${sourceReductionId}/alpha/artifacts/reduction.json`;
      await mkdir(
        join(
          root,
          ".voratiq",
          "reduce",
          "sessions",
          sourceReductionId,
          "alpha",
          "artifacts",
        ),
        {
          recursive: true,
        },
      );
      await writeFile(join(root, succeededOutput), "# Alpha\n", "utf8");
      await writeFile(
        join(root, succeededData),
        '{"summary":"alpha"}\n',
        "utf8",
      );

      await writeReductionSession(root, {
        sessionId: sourceReductionId,
        target: { type: "run", id: "run-123" },
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:05.000Z",
        status: "succeeded",
        reducers: [
          {
            agentId: "alpha",
            status: "succeeded",
            outputPath: succeededOutput,
            dataPath: succeededData,
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:02.000Z",
            error: null,
          },
          {
            agentId: "beta",
            status: "failed",
            outputPath: `.voratiq/reduce/sessions/${sourceReductionId}/beta/artifacts/reduction.md`,
            dataPath: `.voratiq/reduce/sessions/${sourceReductionId}/beta/artifacts/reduction.json`,
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:03.000Z",
            error: "contract mismatch",
          },
        ],
        error: null,
      });

      const adapter = createReduceCompetitionAdapter({
        root,
        reductionId: "reduce-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        runsFilePath: join(root, ".voratiq", "runs", "index.json"),
        messagesFilePath: join(root, ".voratiq", "message", "index.json"),
        verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
        target: { type: "reduce", id: sourceReductionId },
        environment: {},
      });

      const preparation = await adapter.prepareCandidates([
        {
          id: "reducer",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
      ]);
      const prepared = preparation.ready[0];
      expect(prepared).toBeDefined();

      const alphaMarkdown = join(
        prepared.workspacePaths.workspacePath,
        "inputs",
        "reducers",
        "alpha",
        "reduction.md",
      );
      const alphaData = join(
        prepared.workspacePaths.workspacePath,
        "inputs",
        "reducers",
        "alpha",
        "reduction.json",
      );
      const betaMarkdown = join(
        prepared.workspacePaths.workspacePath,
        "inputs",
        "reducers",
        "beta",
        "reduction.md",
      );

      await expect(readFile(alphaMarkdown, "utf8")).resolves.toContain(
        "# Alpha",
      );
      await expect(readFile(alphaData, "utf8")).resolves.toContain("alpha");
      await expect(pathExists(betaMarkdown)).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips missing run summaries while staging reduction inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-run-summary-"));

    try {
      await createWorkspace(root);

      const runId = "run-optional-summary";
      const agentId = "agent-1";
      const specPath = "specs/run-optional-summary.md";
      await mkdir(join(root, "specs"), { recursive: true });
      await writeFile(join(root, specPath), "# Spec\n", "utf8");

      const artifactsDir = join(
        root,
        ".voratiq",
        "run",
        "sessions",
        runId,
        agentId,
        "artifacts",
      );
      await mkdir(artifactsDir, { recursive: true });
      await writeFile(join(artifactsDir, "diff.patch"), "diff --git\n", "utf8");

      await appendRunRecord({
        root,
        runsFilePath: join(root, ".voratiq", "run", "index.json"),
        record: createRunRecord({
          runId,
          status: "succeeded",
          spec: { path: specPath },
          agents: [
            createAgentInvocationRecord({
              agentId,
              status: "succeeded",
              artifacts: {
                diffCaptured: true,
                summaryCaptured: true,
                stdoutCaptured: true,
                stderrCaptured: true,
              },
            }),
          ],
        }),
      });

      const adapter = createReduceCompetitionAdapter({
        root,
        reductionId: "reduce-run-summary",
        createdAt: "2026-01-01T00:00:00.000Z",
        reductionsFilePath: join(root, ".voratiq", "reduce", "index.json"),
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        runsFilePath: join(root, ".voratiq", "run", "index.json"),
        messagesFilePath: join(root, ".voratiq", "message", "index.json"),
        verificationsFilePath: join(root, ".voratiq", "verify", "index.json"),
        target: { type: "run", id: runId },
        environment: {},
      });

      const preparation = await adapter.prepareCandidates([
        {
          id: "reducer",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
      ]);
      const prepared = preparation.ready[0];
      expect(prepared).toBeDefined();

      const diffInput = join(
        prepared.workspacePaths.workspacePath,
        "inputs",
        "agents",
        agentId,
        "diff.patch",
      );
      const summaryInput = join(
        prepared.workspacePaths.workspacePath,
        "inputs",
        "agents",
        agentId,
        "summary.txt",
      );

      await expect(readFile(diffInput, "utf8")).resolves.toContain(
        "diff --git",
      );
      await expect(pathExists(summaryInput)).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function writeReductionSession(
  root: string,
  record: {
    sessionId: string;
    target: { type: "run"; id: string };
    createdAt: string;
    startedAt: string;
    completedAt: string;
    status: "succeeded";
    reducers: Array<{
      agentId: string;
      status: "succeeded" | "failed";
      outputPath: string;
      dataPath: string;
      startedAt: string;
      completedAt: string;
      error: string | null;
    }>;
    error: string | null;
  },
): Promise<void> {
  const reduceDir = join(root, ".voratiq", "reduce");
  const sessionsDir = join(reduceDir, "sessions", record.sessionId);
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(reduceDir, "index.json"),
    JSON.stringify({
      version: 1,
      sessions: [
        {
          sessionId: record.sessionId,
          createdAt: record.createdAt,
          status: record.status,
        },
      ],
    }),
    "utf8",
  );
  await writeFile(
    join(sessionsDir, "record.json"),
    JSON.stringify(record),
    "utf8",
  );
}
