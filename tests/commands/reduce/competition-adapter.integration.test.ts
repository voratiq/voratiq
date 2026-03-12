import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { runSandboxedAgent } from "../../../src/agents/runtime/harness.js";
import { executeCompetitionWithAdapter } from "../../../src/competition/command-adapter.js";
import {
  createReduceCompetitionAdapter,
  type ReduceCompetitionCandidate,
} from "../../../src/domains/reductions/competition/adapter.js";
import { appendReductionRecord } from "../../../src/domains/reductions/persistence/adapter.js";
import { readReductionRecords } from "../../../src/domains/reductions/persistence/adapter.js";
import { appendReviewRecord } from "../../../src/domains/reviews/persistence/adapter.js";
import { appendRunRecord } from "../../../src/domains/runs/persistence/adapter.js";
import { appendSpecRecord } from "../../../src/domains/specs/persistence/adapter.js";
import { extractChatUsageFromArtifact } from "../../../src/workspace/chat/usage-extractor.js";
import { createWorkspace } from "../../../src/workspace/setup.js";

jest.mock("../../../src/agents/runtime/harness.js", () => ({
  runSandboxedAgent: jest.fn(),
}));

jest.mock("../../../src/workspace/chat/usage-extractor.js", () => ({
  extractChatUsageFromArtifact: jest.fn(),
}));

const runSandboxedAgentMock = jest.mocked(runSandboxedAgent);
const extractChatUsageFromArtifactMock = jest.mocked(
  extractChatUsageFromArtifact,
);

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
          startedAt: "2026-01-01T00:00:00.000Z",
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
          startedAt: "2026-01-01T00:00:00.000Z",
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

  it("extracts and persists reducer provider-native token usage on success", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-adapter-"));
    try {
      await createWorkspace(root);
      const seededTargetTokenUsage = {
        input_tokens: 210,
        output_tokens: 65,
        cache_read_input_tokens: 41,
        cache_creation_input_tokens: 11,
      } as const;
      await seedSpecTarget(root, seededTargetTokenUsage);
      let stagedArtifactInfo: Record<string, unknown> | undefined;

      runSandboxedAgentMock.mockImplementation(async (input) => {
        stagedArtifactInfo = JSON.parse(
          await readFile(
            join(input.paths.workspacePath, "artifact-information.json"),
            "utf8",
          ),
        ) as Record<string, unknown>;
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
          signal: null,
          sandboxSettings: minimalSandboxSettings(),
          manifestEnv: {},
          chat: {
            captured: true,
            format: "jsonl",
            artifactPath: "/tmp/reduce.chat.jsonl",
          },
        };
      });

      extractChatUsageFromArtifactMock.mockResolvedValue({
        status: "available",
        provider: "codex",
        modelId: "gpt-5",
        tokenUsage: {
          input_tokens: 120,
          cached_input_tokens: 30,
          output_tokens: 45,
          reasoning_output_tokens: 7,
          total_tokens: 202,
        },
      });

      const onProgressEvent = jest.fn();
      const adapter = createReduceCompetitionAdapter({
        root,
        reductionId: "reduce-usage",
        createdAt: "2026-01-01T00:00:00.000Z",
        reductionsFilePath: join(root, ".voratiq", "reductions", "index.json"),
        specsFilePath: join(root, ".voratiq", "specs", "index.json"),
        runsFilePath: join(root, ".voratiq", "runs", "index.json"),
        reviewsFilePath: join(root, ".voratiq", "reviews", "index.json"),
        target: { type: "spec", id: "spec-seed" },
        environment: {},
        renderer: { onProgressEvent } as never,
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

      expect(results[0]?.tokenUsage).toEqual({
        input_tokens: 120,
        cached_input_tokens: 30,
        output_tokens: 45,
        reasoning_output_tokens: 7,
        total_tokens: 202,
      });
      expect(results[0]?.tokenUsageResult).toEqual({
        status: "available",
        provider: "codex",
        modelId: "gpt-5",
        tokenUsage: {
          input_tokens: 120,
          cached_input_tokens: 30,
          output_tokens: 45,
          reasoning_output_tokens: 7,
          total_tokens: 202,
        },
      });
      expect(stagedArtifactInfo).toEqual(
        expect.objectContaining({
          target: expect.objectContaining({
            operator: "spec",
            tokenUsage: seededTargetTokenUsage,
          }),
        }),
      );
      expect(onProgressEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "stage.candidate",
          stage: "reduce",
          candidate: expect.objectContaining({
            reducerAgentId: "alpha",
            tokenUsage: {
              input_tokens: 120,
              cached_input_tokens: 30,
              output_tokens: 45,
              reasoning_output_tokens: 7,
              total_tokens: 202,
            },
            tokenUsageResult: {
              status: "available",
              provider: "codex",
              modelId: "gpt-5",
              tokenUsage: {
                input_tokens: 120,
                cached_input_tokens: 30,
                output_tokens: 45,
                reasoning_output_tokens: 7,
                total_tokens: 202,
              },
            },
          }),
        }),
      );
      const records = await readReductionRecords({
        root,
        reductionsFilePath: join(root, ".voratiq", "reductions", "index.json"),
        predicate: (record) => record.sessionId === "reduce-usage",
      });
      expect(records[0]?.reducers[0]?.tokenUsage).toEqual({
        input_tokens: 120,
        cached_input_tokens: 30,
        output_tokens: 45,
        reasoning_output_tokens: 7,
        total_tokens: 202,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps reduce execution non-fatal when token usage extraction fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-adapter-"));
    try {
      await createWorkspace(root);
      await seedSpecTarget(root);

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
          signal: null,
          sandboxSettings: minimalSandboxSettings(),
          manifestEnv: {},
          chat: {
            captured: true,
            format: "jsonl",
            artifactPath: "/tmp/reduce.chat.jsonl",
          },
        };
      });

      extractChatUsageFromArtifactMock.mockResolvedValue({
        status: "unavailable",
        reason: "extractor_error",
        provider: "codex",
        modelId: "gpt-5",
        message: "Chat usage extraction failed: boom",
      });

      const adapter = createReduceCompetitionAdapter({
        root,
        reductionId: "reduce-no-usage",
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

      expect(results[0]?.status).toBe("succeeded");
      expect(results[0]?.tokenUsage).toBeUndefined();
      expect(results[0]?.tokenUsageResult).toEqual({
        status: "unavailable",
        reason: "extractor_error",
        provider: "codex",
        modelId: "gpt-5",
        message: "Chat usage extraction failed: boom",
      });
      const records = await readReductionRecords({
        root,
        reductionsFilePath: join(root, ".voratiq", "reductions", "index.json"),
        predicate: (record) => record.sessionId === "reduce-no-usage",
      });
      expect(records[0]?.reducers[0]?.tokenUsage).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("threads review and reduction native token usage into staged artifact manifests", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-adapter-"));
    try {
      await createWorkspace(root);
      await seedSpecTarget(root);
      await seedRunTarget(root);
      await seedReviewTarget(root);
      await seedReductionTarget(root);

      const candidates: ReduceCompetitionCandidate[] = [
        {
          id: "alpha",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
      ];

      const assertions: Array<{
        reductionId: string;
        target: { type: "run" | "review" | "reduction"; id: string };
        expectedArtifactKind: "run-agent" | "reviewer" | "reducer";
        expectedTokenUsage: Record<string, number>;
      }> = [
        {
          reductionId: "reduce-run-target",
          target: { type: "run", id: "run-seed" },
          expectedArtifactKind: "run-agent",
          expectedTokenUsage: {
            input_tokens: 130,
            cached_input_tokens: 21,
            output_tokens: 34,
            reasoning_output_tokens: 5,
            total_tokens: 190,
          },
        },
        {
          reductionId: "reduce-review-target",
          target: { type: "review", id: "review-seed" },
          expectedArtifactKind: "reviewer",
          expectedTokenUsage: {
            input_tokens: 90,
            output_tokens: 20,
            cache_read_input_tokens: 9,
            cache_creation_input_tokens: 4,
          },
        },
        {
          reductionId: "reduce-reduction-target",
          target: { type: "reduction", id: "reduction-seed" },
          expectedArtifactKind: "reducer",
          expectedTokenUsage: {
            input: 80,
            output: 22,
            cached: 6,
            thoughts: 5,
            tool: 3,
            total: 116,
          },
        },
      ];

      for (const entry of assertions) {
        let stagedArtifactInfo: Record<string, unknown> | undefined;
        runSandboxedAgentMock.mockImplementationOnce(async (input) => {
          stagedArtifactInfo = JSON.parse(
            await readFile(
              join(input.paths.workspacePath, "artifact-information.json"),
              "utf8",
            ),
          ) as Record<string, unknown>;
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
            signal: null,
            sandboxSettings: minimalSandboxSettings(),
            manifestEnv: {},
          };
        });

        const adapter = createReduceCompetitionAdapter({
          root,
          reductionId: entry.reductionId,
          createdAt: "2026-01-01T00:00:00.000Z",
          reductionsFilePath: join(
            root,
            ".voratiq",
            "reductions",
            "index.json",
          ),
          specsFilePath: join(root, ".voratiq", "specs", "index.json"),
          runsFilePath: join(root, ".voratiq", "runs", "index.json"),
          reviewsFilePath: join(root, ".voratiq", "reviews", "index.json"),
          target: entry.target,
          environment: {},
        });

        await executeCompetitionWithAdapter({
          candidates,
          maxParallel: 1,
          adapter,
        });

        const artifacts =
          (stagedArtifactInfo?.["artifacts"] as Array<
            Record<string, unknown>
          >) ?? [];
        const matchedArtifact = artifacts.find(
          (artifact) => artifact["kind"] === entry.expectedArtifactKind,
        );
        const tokenUsage = matchedArtifact?.["tokenUsage"];
        expect(tokenUsage).toEqual(entry.expectedTokenUsage);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function seedSpecTarget(
  root: string,
  tokenUsage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  },
): Promise<void> {
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
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      status: "saved",
      agentId: "seed-agent",
      title: "Seed",
      slug: "seed",
      outputPath: ".voratiq/specs/seed.md",
      ...(tokenUsage ? { tokenUsage } : {}),
      error: null,
    },
  });
}

async function seedRunTarget(root: string): Promise<void> {
  const runSpecPath = ".voratiq/specs/run-target.md";
  await writeFile(join(root, runSpecPath), "# Run Target\n\nBody\n", "utf8");

  await appendRunRecord({
    root,
    runsFilePath: join(root, ".voratiq", "runs", "index.json"),
    record: {
      runId: "run-seed",
      baseRevisionSha: "abc123",
      rootPath: ".",
      spec: { path: runSpecPath },
      status: "succeeded",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      agents: [
        {
          agentId: "run-agent",
          model: "gpt-5",
          status: "succeeded",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:01.000Z",
          evals: [],
          artifacts: {
            stdoutCaptured: true,
            stderrCaptured: true,
            diffCaptured: false,
            summaryCaptured: false,
          },
          tokenUsage: {
            input_tokens: 130,
            cached_input_tokens: 21,
            output_tokens: 34,
            reasoning_output_tokens: 5,
            total_tokens: 190,
          },
          error: undefined,
        },
      ],
      deletedAt: null,
    },
  });
}

async function seedReviewTarget(root: string): Promise<void> {
  const reviewPath =
    ".voratiq/reviews/sessions/review-seed/reviewer/artifacts/review.md";
  const recommendationPath =
    ".voratiq/reviews/sessions/review-seed/reviewer/artifacts/recommendation.json";

  await mkdir(dirname(join(root, reviewPath)), { recursive: true });
  await mkdir(dirname(join(root, recommendationPath)), { recursive: true });
  await writeFile(join(root, reviewPath), "## Review\n\nLooks good.\n", "utf8");
  await writeFile(
    join(root, recommendationPath),
    `${JSON.stringify({
      preferred_agent: "candidate-a",
      ranking: ["candidate-a"],
      rationale: "Best option",
      next_actions: [],
    })}\n`,
    "utf8",
  );

  await appendReviewRecord({
    root,
    reviewsFilePath: join(root, ".voratiq", "reviews", "index.json"),
    record: {
      sessionId: "review-seed",
      runId: "run-seed",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      status: "succeeded",
      reviewers: [
        {
          agentId: "reviewer",
          status: "succeeded",
          outputPath: reviewPath,
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:01.000Z",
          tokenUsage: {
            input_tokens: 90,
            output_tokens: 20,
            cache_read_input_tokens: 9,
            cache_creation_input_tokens: 4,
          },
          error: null,
        },
      ],
      error: null,
    },
  });
}

async function seedReductionTarget(root: string): Promise<void> {
  const reductionPath =
    ".voratiq/reductions/sessions/reduction-seed/reducer/artifacts/reduction.md";
  const reductionDataPath =
    ".voratiq/reductions/sessions/reduction-seed/reducer/artifacts/reduction.json";

  await mkdir(dirname(join(root, reductionPath)), { recursive: true });
  await mkdir(dirname(join(root, reductionDataPath)), { recursive: true });
  await writeFile(
    join(root, reductionPath),
    "## Reduction\n**Sources**: spec\n**Summary**: seeded\n",
    "utf8",
  );
  await writeFile(
    join(root, reductionDataPath),
    `${JSON.stringify({
      summary: "seeded",
      directives: ["Keep going."],
      risks: [],
    })}\n`,
    "utf8",
  );

  await appendReductionRecord({
    root,
    reductionsFilePath: join(root, ".voratiq", "reductions", "index.json"),
    record: {
      sessionId: "reduction-seed",
      target: { type: "spec", id: "spec-seed" },
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      status: "succeeded",
      reducers: [
        {
          agentId: "reducer",
          status: "succeeded",
          outputPath: reductionPath,
          dataPath: reductionDataPath,
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:01.000Z",
          tokenUsage: {
            input: 80,
            output: 22,
            cached: 6,
            thoughts: 5,
            tool: 3,
            total: 116,
          },
          error: null,
        },
      ],
      error: null,
    },
  });
}

function minimalSandboxSettings(): {
  network: { allowedDomains: string[]; deniedDomains: string[] };
  filesystem: { denyRead: string[]; allowWrite: string[]; denyWrite: string[] };
} {
  return {
    network: { allowedDomains: [], deniedDomains: [] },
    filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
  };
}
