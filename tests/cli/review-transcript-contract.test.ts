import { dirname, resolve } from "node:path";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { checkPlatformSupport } from "../../src/agents/runtime/sandbox.js";
import { runReviewCommand } from "../../src/cli/review.js";
import { executeReviewCommand } from "../../src/commands/review/command.js";
import { ReviewGenerationFailedError } from "../../src/commands/review/errors.js";
import { readReviewRecommendation } from "../../src/commands/review/recommendation.js";
import {
  ensureSandboxDependencies,
  resolveCliContext,
} from "../../src/preflight/index.js";
import { readReviewRecords } from "../../src/reviews/records/persistence.js";
import { REVIEW_RECOMMENDATION_FILENAME } from "../../src/workspace/structure.js";

jest.mock("../../src/agents/runtime/sandbox.js", () => ({
  checkPlatformSupport: jest.fn(),
}));

jest.mock("../../src/preflight/index.js", () => ({
  resolveCliContext: jest.fn(),
  ensureSandboxDependencies: jest.fn(),
}));

jest.mock("../../src/commands/review/command.js", () => ({
  executeReviewCommand: jest.fn(),
}));

jest.mock("../../src/reviews/records/persistence.js", () => ({
  readReviewRecords: jest.fn(),
}));

jest.mock("../../src/commands/review/recommendation.js", () => ({
  readReviewRecommendation: jest.fn(),
}));

const checkPlatformSupportMock = jest.mocked(checkPlatformSupport);
const resolveCliContextMock = jest.mocked(resolveCliContext);
const ensureSandboxDependenciesMock = jest.mocked(ensureSandboxDependencies);
const executeReviewCommandMock = jest.mocked(executeReviewCommand);
const readReviewRecordsMock = jest.mocked(readReviewRecords);
const readReviewRecommendationMock = jest.mocked(readReviewRecommendation);

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

describe("review transcript contract", () => {
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
        reviewsDir: "/repo/.voratiq/reviews",
        reviewsFile: "/repo/.voratiq/reviews/index.json",
        specsDir: "/repo/.voratiq/specs",
        specsFile: "/repo/.voratiq/specs/index.json",
      },
    });
  });

  it("renders reviewer blocks from persisted reviewer output paths with persisted statuses", async () => {
    executeReviewCommandMock.mockResolvedValue({
      reviewId: "review-123",
      runRecord: { runId: "run-123" },
      reviews: [
        {
          agentId: "reviewer-a",
          outputPath: "should/not/be-used/reviewer-a/review.md",
          status: "succeeded",
          missingArtifacts: [],
        },
        {
          agentId: "reviewer-b",
          outputPath: "should/not/be-used/reviewer-b/review.md",
          status: "succeeded",
          missingArtifacts: [],
        },
      ],
      agentId: "reviewer-a",
      outputPath: "should/not/be-used/reviewer-a/review.md",
      missingArtifacts: [],
    } as unknown as Awaited<ReturnType<typeof executeReviewCommand>>);

    readReviewRecordsMock.mockResolvedValue([
      {
        sessionId: "review-123",
        runId: "run-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:10.000Z",
        status: "succeeded",
        reviewers: [
          {
            agentId: "reviewer-a",
            status: "failed",
            outputPath:
              ".voratiq/reviews/sessions/review-123/reviewer-a/artifacts/review.md",
            completedAt: "2026-01-01T00:00:05.000Z",
            error: "failed reviewer",
          },
          {
            agentId: "reviewer-b",
            status: "succeeded",
            outputPath:
              ".voratiq/reviews/sessions/review-123/reviewer-b/artifacts/review.md",
            completedAt: "2026-01-01T00:00:08.000Z",
            error: null,
          },
        ],
        blinded: {
          enabled: true,
          aliasMap: {
            r_aaaaaaaaaa: "agent-a",
            r_bbbbbbbbbb: "agent-b",
          },
        },
        error: null,
      },
    ]);

    readReviewRecommendationMock.mockImplementation((path: string) => {
      if (path.endsWith("/reviewer-a/artifacts/recommendation.json")) {
        return Promise.resolve({
          preferred_agent: "r_aaaaaaaaaa",
          rationale: "Reviewer A rationale.",
          next_actions: ["voratiq apply --run run-123 --agent r_aaaaaaaaaa"],
        });
      }
      return Promise.resolve({
        preferred_agent: "r_bbbbbbbbbb",
        rationale: "Reviewer B rationale for r_bbbbbbbbbb.",
        next_actions: [
          "voratiq apply --run run-123 --agent r_bbbbbbbbbb",
          "Follow up on r_bbbbbbbbbb cleanup",
        ],
      });
    });

    const result = await runReviewCommand({
      runId: "run-123",
      agentIds: ["reviewer-a", "reviewer-b"],
      writeOutput: () => undefined,
    });

    const reviewerBRecommendationPath = resolve(
      "/repo",
      dirname(
        ".voratiq/reviews/sessions/review-123/reviewer-b/artifacts/review.md",
      ),
      REVIEW_RECOMMENDATION_FILENAME,
    );
    expect(readReviewRecommendationMock).toHaveBeenCalledTimes(1);
    expect(readReviewRecommendationMock).toHaveBeenNthCalledWith(
      1,
      reviewerBRecommendationPath,
    );

    const body = stripAnsi(result.body);
    expect(body).toContain("Reviewer: reviewer-a");
    expect(body).toContain("Reviewer: reviewer-b");
    expect(body).not.toContain(
      "Review: .voratiq/reviews/sessions/review-123/reviewer-a/artifacts/review.md",
    );
    expect(body).toContain(
      "Review: .voratiq/reviews/sessions/review-123/reviewer-b/artifacts/review.md",
    );
    expect(body).toContain("**Rationale**: Reviewer B rationale for agent-b.");
    expect(body).toContain("Follow up on agent-b cleanup");
    expect(body).toContain("Error: failed reviewer");
    expect(body).toContain("FAILED");
    expect(body).toContain("SUCCEEDED");
    expect(body.match(/\n---\n/gu)?.length ?? 0).toBe(3);
  });

  it("fails hard when any reviewer recommendation artifact cannot be loaded", async () => {
    executeReviewCommandMock.mockResolvedValue({
      reviewId: "review-123",
      runRecord: { runId: "run-123" },
      reviews: [
        {
          agentId: "reviewer-a",
          outputPath: "ignored/reviewer-a/review.md",
          status: "succeeded",
          missingArtifacts: [],
        },
      ],
      agentId: "reviewer-a",
      outputPath: "ignored/reviewer-a/review.md",
      missingArtifacts: [],
    } as unknown as Awaited<ReturnType<typeof executeReviewCommand>>);

    readReviewRecordsMock.mockResolvedValue([
      {
        sessionId: "review-123",
        runId: "run-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "succeeded",
        reviewers: [
          {
            agentId: "reviewer-a",
            status: "succeeded",
            outputPath:
              ".voratiq/reviews/sessions/review-123/reviewer-a/artifacts/review.md",
          },
        ],
      },
    ]);
    readReviewRecommendationMock.mockRejectedValue(new Error("ENOENT"));

    await expect(
      runReviewCommand({
        runId: "run-123",
        agentIds: ["reviewer-a"],
        writeOutput: () => undefined,
      }),
    ).rejects.toBeInstanceOf(ReviewGenerationFailedError);

    await expect(
      runReviewCommand({
        runId: "run-123",
        agentIds: ["reviewer-a"],
        writeOutput: () => undefined,
      }),
    ).rejects.toMatchObject({
      detailLines: [
        "Failed to load recommendation artifact for reviewer reviewer-a.",
      ],
    });
  });
});
