import { describe, expect, it } from "@jest/globals";

import {
  createSpecRenderer,
  renderSpecTranscript,
} from "../../../src/render/transcripts/spec.js";

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

describe("spec live progress renderer", () => {
  it("keeps live elapsed moving while running agent rows stay dashed", () => {
    let currentTime = Date.parse("2026-01-01T00:00:03.000Z");
    const tty = new VirtualTty();
    const renderer = createSpecRenderer({
      stdout: tty,
      now: () => currentTime,
    });

    renderer.begin({
      sessionId: "spec-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      workspacePath: ".voratiq/spec/sessions/spec-123",
      status: "running",
    });
    renderer.update({
      agentId: "agent-a",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    let frame = normalizeFrame(tty.snapshot().split("\n\n---")[0] ?? "");
    expect(frame).toContain("Elapsed    3s");
    expect(frame).toMatch(/agent-a\s+RUNNING\s+—/u);

    const staticFrame = normalizeFrame(
      renderSpecTranscript({
        sessionId: "spec-123",
        createdAt: "2026-01-01T00:00:00.000Z",
        elapsed: "3s",
        workspacePath: ".voratiq/spec/sessions/spec-123",
        status: "running",
        agents: [
          {
            agentId: "agent-a",
            status: "running",
            duration: "—",
          },
        ],
        isTty: false,
      }).split("\n\n---")[0] ?? "",
    );

    expect(frame).toBe(staticFrame);

    currentTime = Date.parse("2026-01-01T00:00:07.000Z");
    renderer.update({
      agentId: "agent-a",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    frame = normalizeFrame(tty.snapshot().split("\n\n---")[0] ?? "");
    expect(frame).toContain("Elapsed    7s");
    expect(frame).toMatch(/agent-a\s+RUNNING\s+—/u);
  });
});
