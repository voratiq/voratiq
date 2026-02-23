import { describe, expect, it } from "@jest/globals";

import { createReviewRenderer } from "../../../src/render/transcripts/review.js";
import { createRunRenderer } from "../../../src/render/transcripts/run.js";

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

function collectWrites(): {
  readonly lines: string[];
  readonly writer: { write: (value: string) => boolean; isTTY: boolean };
} {
  const lines: string[] = [];
  return {
    lines,
    writer: {
      isTTY: false,
      write: (value: string): boolean => {
        lines.push(value);
        return true;
      },
    },
  };
}

describe("review live progress renderer", () => {
  it("streams multi-review transitions in non-TTY mode", () => {
    const { lines, writer } = collectWrites();
    const renderer = createReviewRenderer({
      stdout: writer,
      now: () => Date.parse("2026-01-01T00:00:05.000Z"),
    });

    renderer.begin({
      runId: "run-123",
      reviewId: "review-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      workspacePath: ".voratiq/reviews/sessions/review-123",
      status: "running",
    });
    renderer.update({
      reviewerAgentId: "reviewer-a",
      status: "queued",
    });
    renderer.update({
      reviewerAgentId: "reviewer-b",
      status: "queued",
    });
    renderer.update({
      reviewerAgentId: "reviewer-a",
      status: "running",
      startedAt: "2026-01-01T00:00:01.000Z",
    });
    renderer.update({
      reviewerAgentId: "reviewer-b",
      status: "failed",
      completedAt: "2026-01-01T00:00:02.000Z",
    });
    renderer.update({
      reviewerAgentId: "reviewer-a",
      status: "succeeded",
      completedAt: "2026-01-01T00:00:04.000Z",
    });
    renderer.complete("failed");

    const output = lines.join("");
    expect(output).not.toMatch(ANSI_PATTERN);
    expect(output).toContain("review-123");
    expect(output).toContain("AGENT");
    expect(output).toContain("STATUS");
    expect(output).toContain("DURATION");
    expect(output).toContain("reviewer-a");
    expect(output).toContain("reviewer-b");
    expect(output).toContain("RUNNING");
    expect(output).toContain("FAILED");
    expect(output).toMatch(/reviewer-a\s+SUCCEEDED\s+3s/u);
    expect(output).toMatch(/reviewer-b\s+FAILED\s+—/u);
    expect(output).toContain("3s");
  });
});

describe("shared stage progress event model", () => {
  it("is consumed by both run and review renderers", () => {
    const suppressEnv = process.env["VORATIQ_SUPPRESS_RUN_STATUS_TABLE"];
    delete process.env["VORATIQ_SUPPRESS_RUN_STATUS_TABLE"];

    const runWrites = collectWrites();
    const runRenderer = createRunRenderer({ stdout: runWrites.writer });
    runRenderer.onProgressEvent({
      type: "stage.begin",
      stage: "run",
      context: {
        runId: "run-abc",
        status: "running",
        specPath: "spec.md",
        workspacePath: ".voratiq/runs/sessions/run-abc",
        createdAt: "2026-01-01T00:00:00.000Z",
        baseRevisionSha: "abc123",
      },
    });
    runRenderer.onProgressEvent({
      type: "stage.candidate",
      stage: "run",
      candidate: {
        agentId: "runner",
        model: "gpt-5",
        status: "queued",
      },
    });

    const reviewWrites = collectWrites();
    const reviewRenderer = createReviewRenderer({
      stdout: reviewWrites.writer,
    });
    reviewRenderer.onProgressEvent({
      type: "stage.begin",
      stage: "review",
      context: {
        runId: "run-abc",
        reviewId: "review-abc",
        createdAt: "2026-01-01T00:00:00.000Z",
        workspacePath: ".voratiq/reviews/sessions/review-abc",
        status: "running",
      },
    });
    reviewRenderer.onProgressEvent({
      type: "stage.candidate",
      stage: "review",
      candidate: {
        reviewerAgentId: "reviewer",
        status: "queued",
      },
    });

    expect(runWrites.lines.join("")).toContain("runner");
    expect(runWrites.lines.join("")).toContain("QUEUED");
    expect(reviewWrites.lines.join("")).toContain("reviewer");
    expect(reviewWrites.lines.join("")).toContain("QUEUED");

    if (suppressEnv === undefined) {
      delete process.env["VORATIQ_SUPPRESS_RUN_STATUS_TABLE"];
    } else {
      process.env["VORATIQ_SUPPRESS_RUN_STATUS_TABLE"] = suppressEnv;
    }
  });
});
