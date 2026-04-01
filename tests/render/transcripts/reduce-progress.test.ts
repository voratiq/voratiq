import { describe, expect, it } from "@jest/globals";

import {
  createReduceRenderer,
  renderReduceTranscript,
} from "../../../src/render/transcripts/reduce.js";

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
  private savedRow: number | null = null;
  private savedCol: number | null = null;

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

    if (sequence.startsWith("\u001b7")) {
      this.savedRow = this.row;
      this.savedCol = this.col;
      return 2;
    }

    if (sequence.startsWith("\u001b8")) {
      if (this.savedRow !== null && this.savedCol !== null) {
        this.row = this.savedRow;
        this.col = this.savedCol;
        this.ensureLine(this.row);
      }
      return 2;
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
    } else if (code === "J") {
      this.ensureLine(this.row);
      this.buffer[this.row] = this.buffer[this.row].slice(0, this.col);
      this.buffer = this.buffer.slice(0, this.row + 1);
    }

    return match[0].length;
  }

  private ensureLine(row: number): void {
    while (this.buffer.length <= row) {
      this.buffer.push("");
    }
  }
}

describe("reduce live progress renderer", () => {
  it("does not emit intermediate non-TTY status-table snapshots", () => {
    const lines: string[] = [];
    const renderer = createReduceRenderer({
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
      reductionId: "reduce-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      workspacePath: ".voratiq/reduce/sessions/reduce-123",
      status: "running",
    });
    renderer.update({
      reducerAgentId: "reducer-a",
      status: "running",
      startedAt: "2026-01-01T00:00:01.000Z",
      tokenUsage: {
        input_tokens: 10,
        output_tokens: 2,
      },
    });
    renderer.update({
      reducerAgentId: "reducer-a",
      status: "succeeded",
      completedAt: "2026-01-01T00:00:04.000Z",
    });
    renderer.complete("succeeded");

    expect(lines).toEqual([]);
  });

  it("freezes a TTY final frame that matches the non-TTY summary frame after ANSI normalization", () => {
    const tty = new VirtualTty();
    const renderer = createReduceRenderer({
      stdout: tty,
      now: () => Date.parse("2026-01-01T00:00:05.000Z"),
    });

    renderer.begin({
      reductionId: "reduce-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      workspacePath: ".voratiq/reduce/sessions/reduce-123",
      status: "running",
    });
    renderer.update({
      reducerAgentId: "reducer-a",
      status: "running",
      startedAt: "2026-01-01T00:00:01.000Z",
      tokenUsage: {
        input_tokens: 10,
        output_tokens: 2,
      },
    });
    renderer.update({
      reducerAgentId: "reducer-a",
      status: "succeeded",
      completedAt: "2026-01-01T00:00:04.000Z",
    });
    renderer.complete("succeeded");

    const nonTtyTranscript = renderReduceTranscript({
      reductionId: "reduce-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "3s",
      workspacePath: ".voratiq/reduce/sessions/reduce-123",
      status: "succeeded",
      reducers: [
        {
          reducerAgentId: "reducer-a",
          outputPath: "reduction.md",
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

  it("shows live elapsed while keeping running table duration frozen", () => {
    let currentTime = Date.parse("2026-01-01T00:00:03.000Z");
    const tty = new VirtualTty();
    const renderer = createReduceRenderer({
      stdout: tty,
      now: () => currentTime,
    });

    renderer.begin({
      reductionId: "reduce-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      workspacePath: ".voratiq/reduce/sessions/reduce-123",
      status: "running",
    });
    renderer.update({
      reducerAgentId: "reducer-a",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    let frame = normalizeFrame(tty.snapshot());
    expect(frame).toContain("Elapsed    3s");
    expect(frame).toMatch(/reducer-a\s+RUNNING\s+—/u);

    currentTime = Date.parse("2026-01-01T00:00:07.000Z");
    renderer.update({
      reducerAgentId: "reducer-a",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    frame = normalizeFrame(tty.snapshot());
    expect(frame).toContain("Elapsed    7s");
    expect(frame).toMatch(/reducer-a\s+RUNNING\s+—/u);
  });

  it("renders '-' for a missing reduction artifact in transcript blocks", () => {
    const transcript = renderReduceTranscript({
      reductionId: "reduce-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "3s",
      workspacePath: ".voratiq/reduce/sessions/reduce-123",
      status: "running",
      reducers: [
        {
          reducerAgentId: "reducer-a",
          duration: "—",
          status: "running",
        },
      ],
      suppressHint: true,
      isTty: false,
      includeSummarySection: true,
    });

    expect(transcript).toContain("Agent: reducer-a");
    expect(transcript).toContain("Output: —");
  });
});
