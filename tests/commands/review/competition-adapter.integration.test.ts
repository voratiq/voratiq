import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, jest } from "@jest/globals";

import {
  createReviewCompetitionAdapter,
  type ReviewCompetitionCandidate,
} from "../../../src/domains/reviews/competition/adapter.js";
import { readReviewRecords } from "../../../src/domains/reviews/persistence/adapter.js";
import { createWorkspace } from "../../../src/workspace/setup.js";
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

describe("review competition adapter integration", () => {
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
});
