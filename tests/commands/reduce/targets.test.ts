import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { assertReductionTargetEligible } from "../../../src/commands/reduce/targets.js";
import type { ReductionRecord } from "../../../src/domains/reductions/model/types.js";
import { appendReductionRecord } from "../../../src/domains/reductions/persistence/adapter.js";
import type { ReviewRecord } from "../../../src/domains/reviews/model/types.js";
import { appendReviewRecord } from "../../../src/domains/reviews/persistence/adapter.js";
import { appendRunRecord } from "../../../src/domains/runs/persistence/adapter.js";
import type { SpecRecord } from "../../../src/domains/specs/model/types.js";
import { appendSpecRecord } from "../../../src/domains/specs/persistence/adapter.js";
import { resolvePath } from "../../../src/utils/path.js";
import {
  getAgentSessionReductionPath,
  getAgentSessionReviewPath,
  resolveWorkspacePath,
  VORATIQ_REDUCTIONS_FILE,
  VORATIQ_REDUCTIONS_SESSIONS_DIR,
  VORATIQ_REVIEWS_FILE,
  VORATIQ_REVIEWS_SESSIONS_DIR,
  VORATIQ_RUNS_FILE,
  VORATIQ_RUNS_SESSIONS_DIR,
  VORATIQ_SPECS_FILE,
  VORATIQ_SPECS_SESSIONS_DIR,
} from "../../../src/workspace/structure.js";
import { createRunRecord } from "../../support/factories/run-records.js";

describe("assertReductionTargetEligible", () => {
  it("rejects specs missing output artifacts", async () => {
    const workspace = await createWorkspaceRoot();
    try {
      const specId = "spec-missing-output";
      const specRecord: SpecRecord = {
        sessionId: specId,
        createdAt: new Date().toISOString(),
        status: "saved",
        agentId: "alpha",
        title: "Spec title",
        slug: "spec-title",
        outputPath: "specs/spec-title.md",
      };

      await appendSpecRecord({
        root: workspace.root,
        specsFilePath: workspace.specsFilePath,
        record: specRecord,
      });

      await expect(
        assertReductionTargetEligible({
          root: workspace.root,
          specsFilePath: workspace.specsFilePath,
          runsFilePath: workspace.runsFilePath,
          reviewsFilePath: workspace.reviewsFilePath,
          reductionsFilePath: workspace.reductionsFilePath,
          target: { type: "spec", id: specId },
        }),
      ).rejects.toThrow(/missing its output file/i);
    } finally {
      await workspace.cleanup();
    }
  });

  it("rejects runs that are still in progress", async () => {
    const workspace = await createWorkspaceRoot();
    try {
      const runRecord = createRunRecord({
        runId: "run-in-progress",
        status: "running",
      });
      await appendRunRecord({
        root: workspace.root,
        runsFilePath: workspace.runsFilePath,
        record: runRecord,
      });

      await expect(
        assertReductionTargetEligible({
          root: workspace.root,
          specsFilePath: workspace.specsFilePath,
          runsFilePath: workspace.runsFilePath,
          reviewsFilePath: workspace.reviewsFilePath,
          reductionsFilePath: workspace.reductionsFilePath,
          target: { type: "run", id: runRecord.runId },
        }),
      ).rejects.toThrow(/not complete/i);
    } finally {
      await workspace.cleanup();
    }
  });

  it("rejects reviews missing artifacts", async () => {
    const workspace = await createWorkspaceRoot();
    try {
      const reviewId = "review-missing-artifacts";
      const outputPath = getAgentSessionReviewPath(
        "reviews",
        reviewId,
        "alpha",
      );
      const reviewRecord: ReviewRecord = {
        sessionId: reviewId,
        runId: "run-123",
        createdAt: new Date().toISOString(),
        status: "succeeded",
        reviewers: [
          {
            agentId: "alpha",
            status: "succeeded",
            outputPath,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        ],
      };

      await appendReviewRecord({
        root: workspace.root,
        reviewsFilePath: workspace.reviewsFilePath,
        record: reviewRecord,
      });

      await expect(
        assertReductionTargetEligible({
          root: workspace.root,
          specsFilePath: workspace.specsFilePath,
          runsFilePath: workspace.runsFilePath,
          reviewsFilePath: workspace.reviewsFilePath,
          reductionsFilePath: workspace.reductionsFilePath,
          target: { type: "review", id: reviewId },
        }),
      ).rejects.toThrow(/missing required artifacts/i);
    } finally {
      await workspace.cleanup();
    }
  });

  it("accepts completed reduction targets with artifacts", async () => {
    const workspace = await createWorkspaceRoot();
    try {
      const reductionId = "reduction-ok";
      const outputPath = getAgentSessionReductionPath(
        "reductions",
        reductionId,
        "alpha",
      );
      const dataPath = outputPath.replace(/reduction\.md$/u, "reduction.json");

      const outputAbsolute = resolvePath(workspace.root, outputPath);
      const dataAbsolute = resolvePath(workspace.root, dataPath);
      await mkdir(
        resolveWorkspacePath(
          workspace.root,
          VORATIQ_REDUCTIONS_SESSIONS_DIR,
          reductionId,
          "alpha",
          "artifacts",
        ),
        { recursive: true },
      );
      await writeFile(outputAbsolute, "ok", "utf8");
      await writeFile(
        dataAbsolute,
        JSON.stringify(
          {
            summary: "ok",
            directives: ["Do the thing."],
            risks: [],
          },
          null,
          2,
        ),
        "utf8",
      );

      const reductionRecord: ReductionRecord = {
        sessionId: reductionId,
        target: { type: "run", id: "run-123" },
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: "succeeded",
        reducers: [
          {
            agentId: "alpha",
            status: "succeeded",
            outputPath,
            dataPath,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        ],
      };

      await appendReductionRecord({
        root: workspace.root,
        reductionsFilePath: workspace.reductionsFilePath,
        record: reductionRecord,
      });

      await expect(
        assertReductionTargetEligible({
          root: workspace.root,
          specsFilePath: workspace.specsFilePath,
          runsFilePath: workspace.runsFilePath,
          reviewsFilePath: workspace.reviewsFilePath,
          reductionsFilePath: workspace.reductionsFilePath,
          target: { type: "reduction", id: reductionId },
        }),
      ).resolves.toBeUndefined();
    } finally {
      await workspace.cleanup();
    }
  });

  it("rejects reduction targets missing reduction.json", async () => {
    const workspace = await createWorkspaceRoot();
    try {
      const reductionId = "reduction-missing-json";
      const outputPath = getAgentSessionReductionPath(
        "reductions",
        reductionId,
        "alpha",
      );

      const outputAbsolute = resolvePath(workspace.root, outputPath);
      await mkdir(
        resolveWorkspacePath(
          workspace.root,
          VORATIQ_REDUCTIONS_SESSIONS_DIR,
          reductionId,
          "alpha",
          "artifacts",
        ),
        { recursive: true },
      );
      await writeFile(outputAbsolute, "ok", "utf8");

      const reductionRecord: ReductionRecord = {
        sessionId: reductionId,
        target: { type: "run", id: "run-123" },
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: "succeeded",
        reducers: [
          {
            agentId: "alpha",
            status: "succeeded",
            outputPath,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        ],
      };

      await appendReductionRecord({
        root: workspace.root,
        reductionsFilePath: workspace.reductionsFilePath,
        record: reductionRecord,
      });

      await expect(
        assertReductionTargetEligible({
          root: workspace.root,
          specsFilePath: workspace.specsFilePath,
          runsFilePath: workspace.runsFilePath,
          reviewsFilePath: workspace.reviewsFilePath,
          reductionsFilePath: workspace.reductionsFilePath,
          target: { type: "reduction", id: reductionId },
        }),
      ).rejects.toThrow(/missing required artifacts/i);
    } finally {
      await workspace.cleanup();
    }
  });

  it("rejects runs missing referenced diff artifacts", async () => {
    const workspace = await createWorkspaceRoot();
    try {
      const runId = "run-missing-diff";
      const runRecord = createRunRecord({
        runId,
        status: "succeeded",
        spec: { path: "specs/task.md" },
        agents: [
          {
            agentId: "alpha",
            model: "gpt-test",
            status: "succeeded",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            artifacts: {
              stdoutCaptured: true,
              stderrCaptured: true,
              diffCaptured: true,
              summaryCaptured: false,
            },
            evals: [],
          },
        ],
      });

      await mkdir(resolvePath(workspace.root, "specs"), { recursive: true });
      await writeFile(
        resolvePath(workspace.root, "specs/task.md"),
        "# task\n",
        "utf8",
      );
      await appendRunRecord({
        root: workspace.root,
        runsFilePath: workspace.runsFilePath,
        record: runRecord,
      });

      await expect(
        assertReductionTargetEligible({
          root: workspace.root,
          specsFilePath: workspace.specsFilePath,
          runsFilePath: workspace.runsFilePath,
          reviewsFilePath: workspace.reviewsFilePath,
          reductionsFilePath: workspace.reductionsFilePath,
          target: { type: "run", id: runId },
        }),
      ).rejects.toThrow(/missing required artifacts/i);
    } finally {
      await workspace.cleanup();
    }
  });
});

async function createWorkspaceRoot(): Promise<{
  root: string;
  specsFilePath: string;
  runsFilePath: string;
  reviewsFilePath: string;
  reductionsFilePath: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "voratiq-reduce-targets-"));

  const specsFilePath = resolveWorkspacePath(root, VORATIQ_SPECS_FILE);
  const runsFilePath = resolveWorkspacePath(root, VORATIQ_RUNS_FILE);
  const reviewsFilePath = resolveWorkspacePath(root, VORATIQ_REVIEWS_FILE);
  const reductionsFilePath = resolveWorkspacePath(
    root,
    VORATIQ_REDUCTIONS_FILE,
  );

  await mkdir(resolveWorkspacePath(root, VORATIQ_SPECS_SESSIONS_DIR), {
    recursive: true,
  });
  await mkdir(resolveWorkspacePath(root, VORATIQ_RUNS_SESSIONS_DIR), {
    recursive: true,
  });
  await mkdir(resolveWorkspacePath(root, VORATIQ_REVIEWS_SESSIONS_DIR), {
    recursive: true,
  });
  await mkdir(resolveWorkspacePath(root, VORATIQ_REDUCTIONS_SESSIONS_DIR), {
    recursive: true,
  });

  await writeFile(
    specsFilePath,
    JSON.stringify({ version: 1, sessions: [] }, null, 2),
    "utf8",
  );
  await writeFile(
    runsFilePath,
    JSON.stringify({ version: 2, sessions: [] }, null, 2),
    "utf8",
  );
  await writeFile(
    reviewsFilePath,
    JSON.stringify({ version: 1, sessions: [] }, null, 2),
    "utf8",
  );
  await writeFile(
    reductionsFilePath,
    JSON.stringify({ version: 1, sessions: [] }, null, 2),
    "utf8",
  );

  return {
    root,
    specsFilePath,
    runsFilePath,
    reviewsFilePath,
    reductionsFilePath,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}
