import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { runSandboxedAgent } from "../../../src/agents/runtime/harness.js";
import { executeCompetitionWithAdapter } from "../../../src/competition/command-adapter.js";
import {
  createReviewCompetitionAdapter,
  type ReviewCompetitionCandidate,
} from "../../../src/domains/reviews/competition/adapter.js";
import { readReviewRecords } from "../../../src/domains/reviews/persistence/adapter.js";
import { extractChatUsageFromArtifact } from "../../../src/workspace/chat/usage-extractor.js";
import { createWorkspace } from "../../../src/workspace/setup.js";
import { REVIEW_ARTIFACT_INFO_FILENAME } from "../../../src/workspace/structure.js";
import {
  createAgentInvocationRecord,
  createRunRecordEnhanced,
} from "../../support/factories/run-records.js";

jest.mock("../../../src/utils/git.js", () => ({
  createDetachedWorktree: jest.fn(
    async ({ worktreePath }: { worktreePath: string }) => {
      await mkdir(worktreePath, { recursive: true });
    },
  ),
  removeWorktree: jest.fn(async () => {}),
}));

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

describe("review competition adapter integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("persists staged extra-context paths and source metadata when preparing reviewers", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-review-adapter-"));
    const external = await mkdtemp(
      join(tmpdir(), "voratiq-review-extra-context-"),
    );
    try {
      await createWorkspace(root);

      await writeFile(
        join(root, ".voratiq", "specs", "seed.md"),
        "# Seed\n\nBody\n",
        "utf8",
      );
      const baseRevisionSha = "abc123";

      const run = createRunRecordEnhanced({
        runId: "run-123",
        baseRevisionSha,
        spec: { path: ".voratiq/specs/seed.md" },
        agents: [
          createAgentInvocationRecord({
            agentId: "candidate-a",
            status: "succeeded",
            commitSha: baseRevisionSha,
            artifacts: {
              diffAttempted: true,
              diffCaptured: true,
            },
            evals: [],
          }),
        ],
      });

      const diffPath = run.agents[0]?.assets.diffPath;
      if (!diffPath) {
        throw new Error("Expected diff path for review candidate");
      }
      await mkdir(dirname(join(root, diffPath)), { recursive: true });
      await writeFile(
        join(root, diffPath),
        "diff --git a/file.txt b/file.txt\n+hello\n",
        "utf8",
      );
      const externalExtraContextPath = join(external, "carry-forward.md");
      await writeFile(externalExtraContextPath, "Carry forward\n", "utf8");

      const adapter = createReviewCompetitionAdapter({
        root,
        reviewId: "review-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        reviewsFilePath: join(root, ".voratiq", "reviews", "index.json"),
        run,
        environment: {},
        extraContextFiles: [
          {
            absolutePath: externalExtraContextPath,
            displayPath: externalExtraContextPath,
            stagedRelativePath: "../context/carry-forward.md",
          },
        ],
      });

      const candidates: ReviewCompetitionCandidate[] = [
        {
          id: "reviewer",
          provider: "codex",
          model: "gpt-5",
          binary: "node",
          argv: [],
        },
      ];

      await adapter.prepareCandidates(candidates);

      await expect(
        readReviewRecords({
          root,
          reviewsFilePath: join(root, ".voratiq", "reviews", "index.json"),
          predicate: (record) => record.sessionId === "review-123",
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          sessionId: "review-123",
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

  it("extracts and persists reviewer provider-native token usage on success", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-review-adapter-"));
    try {
      await createWorkspace(root);
      const run = await seedReviewRunFixture(root);

      runSandboxedAgentMock.mockImplementation(async (input) => {
        const candidateId = await resolveOnlyCandidateId(
          input.paths.workspacePath,
        );
        await writeFile(
          join(input.paths.workspacePath, "review.md"),
          buildReviewMarkdown(candidateId),
          "utf8",
        );
        await writeFile(
          join(input.paths.workspacePath, "recommendation.json"),
          `${JSON.stringify({
            preferred_agent: candidateId,
            ranking: [candidateId],
            rationale: "Looks good",
            next_actions: [],
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
            artifactPath: "/tmp/review.chat.jsonl",
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
      const adapter = createReviewCompetitionAdapter({
        root,
        reviewId: "review-usage",
        createdAt: "2026-01-01T00:00:00.000Z",
        reviewsFilePath: join(root, ".voratiq", "reviews", "index.json"),
        run,
        environment: {},
        renderer: { onProgressEvent } as never,
      });

      const candidates: ReviewCompetitionCandidate[] = [
        {
          id: "reviewer",
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
      expect(onProgressEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "stage.candidate",
          stage: "review",
          candidate: expect.objectContaining({
            reviewerAgentId: "reviewer",
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
      await expect(
        readReviewRecords({
          root,
          reviewsFilePath: join(root, ".voratiq", "reviews", "index.json"),
          predicate: (record) => record.sessionId === "review-usage",
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          reviewers: [
            expect.objectContaining({
              agentId: "reviewer",
              tokenUsage: {
                input_tokens: 120,
                cached_input_tokens: 30,
                output_tokens: 45,
                reasoning_output_tokens: 7,
                total_tokens: 202,
              },
            }),
          ],
        }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps review execution non-fatal when token usage extraction fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-review-adapter-"));
    try {
      await createWorkspace(root);
      const run = await seedReviewRunFixture(root);

      runSandboxedAgentMock.mockImplementation(async (input) => {
        const candidateId = await resolveOnlyCandidateId(
          input.paths.workspacePath,
        );
        await writeFile(
          join(input.paths.workspacePath, "review.md"),
          buildReviewMarkdown(candidateId),
          "utf8",
        );
        await writeFile(
          join(input.paths.workspacePath, "recommendation.json"),
          `${JSON.stringify({
            preferred_agent: candidateId,
            ranking: [candidateId],
            rationale: "Looks good",
            next_actions: [],
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
            artifactPath: "/tmp/review.chat.jsonl",
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

      const adapter = createReviewCompetitionAdapter({
        root,
        reviewId: "review-no-usage",
        createdAt: "2026-01-01T00:00:00.000Z",
        reviewsFilePath: join(root, ".voratiq", "reviews", "index.json"),
        run,
        environment: {},
      });

      const candidates: ReviewCompetitionCandidate[] = [
        {
          id: "reviewer",
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
      const records = await readReviewRecords({
        root,
        reviewsFilePath: join(root, ".voratiq", "reviews", "index.json"),
        predicate: (record) => record.sessionId === "review-no-usage",
      });
      expect(records[0]?.reviewers[0]?.tokenUsage).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function seedReviewRunFixture(root: string) {
  await writeFile(
    join(root, ".voratiq", "specs", "seed.md"),
    "# Seed\n\nBody\n",
    "utf8",
  );
  const baseRevisionSha = "abc123";

  const run = createRunRecordEnhanced({
    runId: "run-123",
    baseRevisionSha,
    spec: { path: ".voratiq/specs/seed.md" },
    agents: [
      createAgentInvocationRecord({
        agentId: "candidate-a",
        status: "succeeded",
        commitSha: baseRevisionSha,
        artifacts: {
          diffAttempted: true,
          diffCaptured: true,
        },
        evals: [],
      }),
    ],
  });

  const diffPath = run.agents[0]?.assets.diffPath;
  if (!diffPath) {
    throw new Error("Expected diff path for review candidate");
  }
  await mkdir(dirname(join(root, diffPath)), { recursive: true });
  await writeFile(
    join(root, diffPath),
    "diff --git a/file.txt b/file.txt\n+hello\n",
    "utf8",
  );
  return run;
}

async function resolveOnlyCandidateId(workspacePath: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(join(workspacePath, REVIEW_ARTIFACT_INFO_FILENAME), "utf8"),
  ) as {
    candidates?: Array<{ candidateId?: string }>;
  };
  const candidateId = manifest.candidates?.[0]?.candidateId;
  if (!candidateId) {
    throw new Error("Expected blinded candidate id in artifact information.");
  }
  return candidateId;
}

function buildReviewMarkdown(candidateId: string): string {
  return [
    "# Review",
    "",
    "## Specification",
    "Summary",
    "",
    "## Key Requirements",
    "- R1",
    "",
    "## Candidate Assessments",
    `### ${candidateId}`,
    "Looks good.",
    "",
    "## Comparison",
    "Comparison details.",
    "",
    "## Ranking",
    `1. ${candidateId}`,
    "",
    "## Recommendation",
    `**Preferred Candidate**: ${candidateId}`,
    "**Rationale**: Reason",
    "**Next Actions**:",
    `voratiq apply --run run-123 --agent ${candidateId}`,
    "",
  ].join("\n");
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
