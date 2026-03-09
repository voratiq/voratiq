import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { runSandboxedAgent } from "../../../src/agents/runtime/harness.js";
import {
  createReduceCompetitionAdapter,
  type ReduceCompetitionCandidate,
} from "../../../src/commands/reduce/competition-adapter.js";
import { executeCompetitionWithAdapter } from "../../../src/competition/command-adapter.js";
import { readReductionRecords } from "../../../src/reductions/records/persistence.js";
import { appendSpecRecord } from "../../../src/specs/records/persistence.js";
import { createWorkspace } from "../../../src/workspace/setup.js";

jest.mock("../../../src/agents/runtime/harness.js", () => ({
  runSandboxedAgent: jest.fn(),
}));

const runSandboxedAgentMock = jest.mocked(runSandboxedAgent);

describe("reduce competition adapter integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("persists staged extra-context paths and source metadata when preparing reducers", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-adapter-"));
    const external = await mkdtemp(
      join(tmpdir(), "voratiq-reduce-extra-context-"),
    );
    try {
      await createWorkspace(root);
      await writeFile(
        join(root, ".voratiq", "specs", "seed.md"),
        "# Seed\n\nBody\n",
        "utf8",
      );
      await appendSpecRecord({
        root,
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        record: {
          sessionId: "spec-seed",
          createdAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:01.000Z",
          status: "saved",
          agentId: "seed-agent",
          title: "Seed",
          slug: "seed",
          outputPath: ".voratiq/specs/seed.md",
          error: null,
        },
      });
      const externalExtraContextPath = join(external, "carry-forward.md");
      await writeFile(externalExtraContextPath, "Carry forward\n", "utf8");

      const adapter = createReduceCompetitionAdapter({
        root,
        reductionId: "reduce-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        reductionsFilePath: join(root, ".voratiq", "reductions", "index.json"),
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        runsFilePath: join(root, ".voratiq", "runs", "index.json"),
        reviewsFilePath: join(root, ".voratiq", "reviews", "index.json"),
        target: { type: "spec", id: "spec-seed" },
        environment: {},
        extraContextFiles: [
          {
            absolutePath: externalExtraContextPath,
            displayPath: externalExtraContextPath,
            stagedRelativePath: "../context/carry-forward.md",
          },
        ],
      });

      const candidates: ReduceCompetitionCandidate[] = [
        {
          id: "alpha",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
      ];

      await adapter.prepareCandidates(candidates);

      await expect(
        readReductionRecords({
          root,
          reductionsFilePath: join(
            root,
            ".voratiq",
            "reductions",
            "index.json",
          ),
          predicate: (record) => record.sessionId === "reduce-123",
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          sessionId: "reduce-123",
          extraContext: ["../context/carry-forward.md"],
          extraContextMetadata: [
            {
              stagedPath: "../context/carry-forward.md",
              sourcePath: externalExtraContextPath,
            },
          ],
        }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  });

  it("prunes transient reducer workspace and context paths after success", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-adapter-"));
    try {
      await createWorkspace(root);
      await writeFile(
        join(root, ".voratiq", "specs", "seed.md"),
        "# Seed\n\nBody\n",
        "utf8",
      );
      await appendSpecRecord({
        root,
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        record: {
          sessionId: "spec-seed",
          createdAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:01.000Z",
          status: "saved",
          agentId: "seed-agent",
          title: "Seed",
          slug: "seed",
          outputPath: ".voratiq/specs/seed.md",
          error: null,
        },
      });

      runSandboxedAgentMock.mockImplementation(async (input) => {
        await writeFile(
          join(input.paths.workspacePath, "reduction.md"),
          "## Reduction\n**Sources**: spec\n**Summary**: ok\n",
          "utf8",
        );
        await writeFile(
          join(input.paths.workspacePath, "reduction.json"),
          `${JSON.stringify({
            summary: "ok",
            directives: ["Use the seed spec."],
            risks: [],
          })}\n`,
          "utf8",
        );

        return {
          exitCode: 0,
          sandboxSettings: {
            network: { allowedDomains: [], deniedDomains: [] },
            filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
          },
          manifestEnv: {},
        };
      });

      const adapter = createReduceCompetitionAdapter({
        root,
        reductionId: "reduce-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        reductionsFilePath: join(root, ".voratiq", "reductions", "index.json"),
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        runsFilePath: join(root, ".voratiq", "runs", "index.json"),
        reviewsFilePath: join(root, ".voratiq", "reviews", "index.json"),
        target: { type: "spec", id: "spec-seed" },
        environment: {},
      });

      const candidates: ReduceCompetitionCandidate[] = [
        {
          id: "alpha",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
      ];

      const results = await executeCompetitionWithAdapter({
        candidates,
        maxParallel: 1,
        adapter,
      });

      expect(results).toHaveLength(1);
      await expect(
        readFile(
          join(
            root,
            ".voratiq",
            "reductions",
            "sessions",
            "reduce-123",
            "alpha",
            "artifacts",
            "reduction.md",
          ),
          "utf8",
        ),
      ).resolves.toContain("## Reduction");
      await expect(
        readFile(
          join(
            root,
            ".voratiq",
            "reductions",
            "sessions",
            "reduce-123",
            "alpha",
            "artifacts",
            "reduction.json",
          ),
          "utf8",
        ),
      ).resolves.toContain('"summary":"ok"');

      await expect(
        access(
          join(
            root,
            ".voratiq",
            "reductions",
            "sessions",
            "reduce-123",
            "alpha",
            "workspace",
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        access(
          join(
            root,
            ".voratiq",
            "reductions",
            "sessions",
            "reduce-123",
            "alpha",
            "context",
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        access(
          join(
            root,
            ".voratiq",
            "reductions",
            "sessions",
            "reduce-123",
            "alpha",
            "runtime",
          ),
        ),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
