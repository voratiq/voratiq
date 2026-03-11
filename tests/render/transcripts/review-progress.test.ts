import { describe, expect, it } from "@jest/globals";

import {
  createReviewRenderer,
  renderReviewTranscript,
} from "../../../src/render/transcripts/review.js";
import { createRunRenderer } from "../../../src/render/transcripts/run.js";

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
const CONTROL_SEQUENCE = new RegExp(String.raw`^\x1b\[(\d+)([A-Za-z])`);
const SGR_SEQUENCE = new RegExp(String.raw`^\x1b\[[0-9;]*m`, "u");

function normalizeFrame(value: string): string {
  return value
    .replace(ANSI_PATTERN, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

class VirtualTty {
  readonly writes: string[] = [];
  readonly isTTY = true;

  private buffer: string[] = [""];
  private row = 0;
  private col = 0;

  write = (data: string): boolean => {
    this.writes.push(data);
    this.apply(data);
    return true;
  };

  snapshot(): string {
    return this.buffer.join("\n");
  }

  private apply(data: string): void {
    let index = 0;
    while (index < data.length) {
      const char = data[index];
      if (char === "\u001b") {
        const consumed = this.handleEscape(data.slice(index));
        index += consumed;
        continue;
      }
      if (char === "\n") {
        this.row += 1;
        this.col = 0;
        this.ensureLine(this.row);
        index += 1;
        continue;
      }
      this.ensureLine(this.row);
      const line = this.buffer[this.row];
      const padded = line.padEnd(this.col, " ");
      this.buffer[this.row] =
        padded.slice(0, this.col) + char + padded.slice(this.col + 1);
      this.col += 1;
      index += 1;
    }
  }

  private handleEscape(sequence: string): number {
    const sgrMatch = SGR_SEQUENCE.exec(sequence);
    if (sgrMatch) {
      return sgrMatch[0].length;
    }

    const match = CONTROL_SEQUENCE.exec(sequence);
    if (!match) {
      return 1;
    }

    const [, countString, code] = match;
    const count = parseInt(countString, 10);

    if (code === "F") {
      this.row = Math.max(0, this.row - count);
      this.col = 0;
      this.ensureLine(this.row);
    } else if (code === "G") {
      this.col = Math.max(0, count - 1);
      this.ensureLine(this.row);
    } else if (code === "K") {
      this.ensureLine(this.row);
      this.buffer[this.row] = "";
      this.col = 0;
    }

    return match[0].length;
  }

  private ensureLine(row: number): void {
    while (this.buffer.length <= row) {
      this.buffer.push("");
    }
  }
}

describe("review live progress renderer", () => {
  it("does not emit intermediate non-TTY status-table snapshots", () => {
    const lines: string[] = [];
    const renderer = createReviewRenderer({
      stdout: {
        isTTY: false,
        write: (value: string): boolean => {
          lines.push(value);
          return true;
        },
      },
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
      status: "running",
      startedAt: "2026-01-01T00:00:01.000Z",
    });
    renderer.update({
      reviewerAgentId: "reviewer-a",
      status: "succeeded",
      completedAt: "2026-01-01T00:00:04.000Z",
    });
    renderer.complete("succeeded");

    expect(lines).toEqual([]);
  });

  it("freezes a TTY final frame that matches the non-TTY summary frame after ANSI normalization", () => {
    const tty = new VirtualTty();
    const renderer = createReviewRenderer({
      stdout: tty,
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
      status: "running",
      startedAt: "2026-01-01T00:00:01.000Z",
    });
    renderer.update({
      reviewerAgentId: "reviewer-a",
      status: "succeeded",
      completedAt: "2026-01-01T00:00:04.000Z",
    });
    renderer.complete("succeeded");

    const nonTtyTranscript = renderReviewTranscript({
      runId: "run-123",
      reviewId: "review-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "5s",
      workspacePath: ".voratiq/reviews/sessions/review-123",
      status: "succeeded",
      reviewers: [
        {
          reviewerAgentId: "reviewer-a",
          outputPath: "review.md",
          duration: "3s",
          status: "succeeded",
        },
      ],
      suppressHint: true,
      isTty: false,
      includeSummarySection: true,
    });

    const ttyFrame = tty.snapshot().split("\n\n---")[0] ?? "";
    const nonTtyFrame = nonTtyTranscript.split("\n\n---")[0] ?? "";

    expect(normalizeFrame(ttyFrame)).toBe(normalizeFrame(nonTtyFrame));
  });
});

describe("shared stage progress event model", () => {
  it("is consumed by both run and review renderers", () => {
    const runWrites: string[] = [];
    const runRenderer = createRunRenderer({
      stdout: {
        isTTY: true,
        write: (value: string): boolean => {
          runWrites.push(value);
          return true;
        },
      },
    });
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

    const reviewWrites: string[] = [];
    const reviewRenderer = createReviewRenderer({
      stdout: {
        isTTY: true,
        write: (value: string): boolean => {
          reviewWrites.push(value);
          return true;
        },
      },
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
        tokenUsage: {
          input_tokens: 12,
          output_tokens: 4,
        },
      },
    });

    expect(runWrites.join("")).toContain("runner");
    expect(runWrites.join("")).toContain("QUEUED");
    expect(reviewWrites.join("")).toContain("reviewer");
    expect(reviewWrites.join("")).toContain("QUEUED");
  });
});
