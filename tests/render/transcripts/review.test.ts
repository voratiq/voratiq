import { describe, expect, it } from "@jest/globals";

import { renderReviewTranscript } from "../../../src/render/transcripts/review.js";

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

describe("renderReviewTranscript", () => {
  it.each(["succeeded", "failed", "aborted"] as const)(
    "renders one non-TTY summary frame for %s",
    (status) => {
      const output = renderReviewTranscript({
        runId: "run-123",
        reviewId: "review-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        elapsed: "10s",
        workspacePath: ".voratiq/reviews/sessions/review-123",
        status,
        reviewers: [
          {
            reviewerAgentId: "reviewer-a",
            outputPath: "review.md",
            duration: "5s",
            status,
          },
        ],
        suppressHint: true,
        isTty: false,
      });

      expect(output).toContain(`review-123 ${status.toUpperCase()}`);
      expect((output.match(/\bAGENT\b/gu) ?? []).length).toBe(1);
      expect(output).toContain("reviewer-a");
      expect(output).not.toMatch(ANSI_PATTERN);
    },
  );

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

  it("renders concrete apply hint agent when recommendation is resolved", () => {
    const output = renderReviewTranscript({
      runId: "run-123",
      reviewId: "review-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "10s",
      workspacePath: ".voratiq/reviews/sessions/review-123",
      status: "succeeded",
      reviewers: [],
      recommendedAgentId: "agent-a",
      isTty: false,
    });

    expect(output).toContain("To apply a solution:");
    expect(output).toContain("voratiq apply --run run-123 --agent agent-a");
    expect(output).not.toContain(
      "voratiq apply --run run-123 --agent <agent-id>",
    );
  });

  it("falls back to placeholder apply hint agent when recommendation is unavailable", () => {
    const output = renderReviewTranscript({
      runId: "run-123",
      reviewId: "review-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "10s",
      workspacePath: ".voratiq/reviews/sessions/review-123",
      status: "succeeded",
      reviewers: [],
      isTty: false,
    });

    expect(output).toContain("To apply a solution:");
    expect(output).toContain("voratiq apply --run run-123 --agent <agent-id>");
  });
});
