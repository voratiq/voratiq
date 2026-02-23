import { describe, expect, it } from "@jest/globals";

import { renderReviewTranscript } from "../../../src/render/transcripts/review.js";

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

describe("renderReviewTranscript", () => {
  it("renders plain transcript shell output when non-TTY", () => {
    const output = renderReviewTranscript({
      runId: "run-123",
      reviewId: "review-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "10s",
      workspacePath: ".voratiq/reviews/sessions/review-123",
      status: "failed",
      reviewers: [
        {
          reviewerAgentId: "reviewer-a",
          outputPath: "review.md",
          duration: "5s",
          status: "failed",
          errorLine: "reviewer-a failed",
        },
      ],
      suppressHint: true,
      isTty: false,
    });

    expect(output).toContain("review-123");
    expect(output).toContain("FAILED");
    expect(output).toContain("Error: reviewer-a failed");
    expect(output).not.toMatch(ANSI_PATTERN);
  });

  it("includes styled shell elements when TTY", () => {
    const output = renderReviewTranscript({
      runId: "run-123",
      reviewId: "review-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "10s",
      workspacePath: ".voratiq/reviews/sessions/review-123",
      status: "failed",
      reviewers: [
        {
          reviewerAgentId: "reviewer-a",
          outputPath: "review.md",
          duration: "5s",
          status: "failed",
          errorLine: "reviewer-a failed",
        },
      ],
      suppressHint: true,
      isTty: true,
    });

    expect(output).toMatch(ANSI_PATTERN);
  });
});
