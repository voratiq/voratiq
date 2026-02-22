import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { teardownSessionAuth } from "../../../src/agents/runtime/registry.js";
import {
  clearActiveReview,
  registerActiveReview,
  REVIEW_ABORT_DETAIL,
  terminateActiveReview,
} from "../../../src/commands/review/lifecycle.js";
import {
  flushReviewRecordBuffer,
  rewriteReviewRecord,
} from "../../../src/reviews/records/persistence.js";
import type { ReviewRecord } from "../../../src/reviews/records/types.js";

jest.mock("../../../src/reviews/records/persistence.js", () => ({
  rewriteReviewRecord: jest.fn(),
  flushReviewRecordBuffer: jest.fn(),
}));

jest.mock("../../../src/agents/runtime/registry.js", () => ({
  teardownSessionAuth: jest.fn(),
}));

const rewriteReviewRecordMock = jest.mocked(rewriteReviewRecord);
const flushReviewRecordBufferMock = jest.mocked(flushReviewRecordBuffer);
const teardownSessionAuthMock = jest.mocked(teardownSessionAuth);

describe("review lifecycle", () => {
  const REVIEW_ID = "review-123";

  beforeEach(() => {
    jest.clearAllMocks();
    flushReviewRecordBufferMock.mockResolvedValue(undefined);
    teardownSessionAuthMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearActiveReview(REVIEW_ID);
  });

  it("marks running reviewers as aborted and finalizes the review record", async () => {
    registerActiveReview({
      root: "/repo",
      reviewsFilePath: "/repo/.voratiq/reviews/index.json",
      reviewId: REVIEW_ID,
      reviewerAgentIds: ["reviewer-a", "reviewer-b"],
    });

    const existingRecord: ReviewRecord = {
      sessionId: REVIEW_ID,
      runId: "run-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "running",
      reviewers: [
        {
          agentId: "reviewer-a",
          status: "running",
          outputPath:
            ".voratiq/reviews/sessions/review-123/reviewer-a/artifacts/review.md",
        },
        {
          agentId: "reviewer-b",
          status: "succeeded",
          outputPath:
            ".voratiq/reviews/sessions/review-123/reviewer-b/artifacts/review.md",
          completedAt: "2026-01-01T00:01:00.000Z",
          error: null,
        },
      ],
      blinded: {
        enabled: true,
        aliasMap: { r_aaaaaaaaaa: "agent-a" },
      },
    };

    let mutatedRecord: ReviewRecord | undefined;
    rewriteReviewRecordMock.mockImplementation(({ mutate }) => {
      mutatedRecord = mutate(existingRecord);
      return Promise.resolve(mutatedRecord);
    });

    await terminateActiveReview("aborted");

    expect(rewriteReviewRecordMock).toHaveBeenCalledTimes(1);
    expect(flushReviewRecordBufferMock).toHaveBeenCalledWith({
      reviewsFilePath: "/repo/.voratiq/reviews/index.json",
      sessionId: REVIEW_ID,
    });
    expect(teardownSessionAuthMock).toHaveBeenCalledWith(REVIEW_ID);

    expect(mutatedRecord).toBeDefined();
    expect(mutatedRecord?.status).toBe("aborted");
    expect(mutatedRecord?.error).toBe(REVIEW_ABORT_DETAIL);
    expect(mutatedRecord?.completedAt).toEqual(expect.any(String));
    expect(mutatedRecord?.reviewers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "reviewer-a",
          status: "aborted",
          error: REVIEW_ABORT_DETAIL,
          completedAt: expect.any(String),
        }),
        expect.objectContaining({
          agentId: "reviewer-b",
          status: "succeeded",
        }),
      ]),
    );
  });

  it("is a no-op when no active review is registered", async () => {
    await terminateActiveReview("failed");

    expect(rewriteReviewRecordMock).not.toHaveBeenCalled();
    expect(flushReviewRecordBufferMock).not.toHaveBeenCalled();
    expect(teardownSessionAuthMock).not.toHaveBeenCalled();
  });
});
