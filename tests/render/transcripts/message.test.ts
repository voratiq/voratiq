import { describe, expect, it } from "@jest/globals";

import {
  createMessageRenderer,
  renderMessageTranscript,
} from "../../../src/render/transcripts/message.js";

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

describe("message live progress renderer", () => {
  it("does not emit intermediate non-TTY status-table snapshots", () => {
    const lines: string[] = [];
    const renderer = createMessageRenderer({
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
      messageId: "message-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      workspacePath: ".voratiq/message/sessions/message-123",
      status: "running",
    });
    renderer.update({
      agentId: "agent-a",
      status: "running",
      startedAt: "2026-01-01T00:00:01.000Z",
    });
    renderer.update({
      agentId: "agent-a",
      status: "succeeded",
      completedAt: "2026-01-01T00:00:04.000Z",
      outputPath: "agent-a/artifacts/response.md",
    });
    renderer.complete("succeeded");

    expect(lines).toEqual([]);
  });

  it("freezes a TTY final frame that matches the non-TTY summary frame after ANSI normalization", () => {
    const tty = new VirtualTty();
    const renderer = createMessageRenderer({
      stdout: tty,
      now: () => Date.parse("2026-01-01T00:00:05.000Z"),
    });

    renderer.begin({
      messageId: "message-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      workspacePath: ".voratiq/message/sessions/message-123",
      status: "running",
    });
    renderer.update({
      agentId: "agent-a",
      status: "running",
      startedAt: "2026-01-01T00:00:01.000Z",
    });
    renderer.update({
      agentId: "agent-a",
      status: "succeeded",
      completedAt: "2026-01-01T00:00:04.000Z",
      outputPath: "agent-a/artifacts/response.md",
    });
    renderer.complete("succeeded");

    const nonTtyTranscript = renderMessageTranscript({
      messageId: "message-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "3s",
      workspacePath: ".voratiq/message/sessions/message-123",
      status: "succeeded",
      recipients: [
        {
          agentId: "agent-a",
          status: "succeeded",
          duration: "3s",
          outputPath: "agent-a/artifacts/response.md",
        },
      ],
      isTty: false,
    });

    const ttyFrame = tty.snapshot().split("\n\n---")[0] ?? "";
    const nonTtyFrame = nonTtyTranscript.split("\n\n---")[0] ?? "";

    expect(normalizeFrame(ttyFrame)).toBe(normalizeFrame(nonTtyFrame));
  });

  it("shows live elapsed while keeping running table duration frozen", () => {
    let currentTime = Date.parse("2026-01-01T00:00:03.000Z");
    const tty = new VirtualTty();
    const renderer = createMessageRenderer({
      stdout: tty,
      now: () => currentTime,
    });

    renderer.begin({
      messageId: "message-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      workspacePath: ".voratiq/message/sessions/message-123",
      status: "running",
    });
    renderer.update({
      agentId: "agent-a",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    let frame = normalizeFrame(tty.snapshot());
    expect(frame).toContain("Elapsed    3s");
    expect(frame).toMatch(/agent-a\s+RUNNING\s+—/u);

    currentTime = Date.parse("2026-01-01T00:00:07.000Z");
    renderer.update({
      agentId: "agent-a",
      status: "running",
    });

    frame = normalizeFrame(tty.snapshot());
    expect(frame).toContain("Elapsed    7s");
    expect(frame).toMatch(/agent-a\s+RUNNING\s+—/u);
  });
});

describe("renderMessageTranscript", () => {
  it("matches the standard operator detail layout", () => {
    const transcript = renderMessageTranscript({
      messageId: "message-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "3s",
      workspacePath: ".voratiq/message/sessions/message-123",
      status: "succeeded",
      recipients: [
        {
          agentId: "agent-a",
          status: "succeeded",
          duration: "3s",
          outputPath:
            ".voratiq/message/sessions/message-123/agent-a/artifacts/response.md",
        },
        {
          agentId: "agent-b",
          status: "failed",
          duration: "2s",
          errorLine: "boom",
        },
      ],
      isTty: false,
    });

    expect(transcript).toContain("AGENT");
    expect(transcript).toContain("Agent: agent-a");
    expect(transcript).toContain(
      "Output: .voratiq/message/sessions/message-123/agent-a/artifacts/response.md",
    );
    expect(transcript).toContain("Agent: agent-b");
    expect(transcript).toContain("Output: —");
    expect(transcript).toContain("\n---\n");
    expect(transcript.trimEnd().endsWith("---")).toBe(false);
    expect(transcript).not.toContain("Request:");
    expect(transcript).not.toContain("Response:");
    expect(transcript).not.toContain("Response data:");
    expect(transcript).not.toContain("\nStatus: ");
    expect(transcript).not.toContain("\nDuration: ");
  });

  it("uses styled status labels in TTY mode", () => {
    const transcript = renderMessageTranscript({
      messageId: "message-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "3s",
      workspacePath: ".voratiq/message/sessions/message-123",
      status: "running",
      recipients: [
        {
          agentId: "agent-a",
          status: "running",
          duration: "—",
        },
      ],
      isTty: true,
    });

    expect(transcript).toContain("AGENT");
    expect(transcript).toContain("RUNNING");
    expect(transcript).toContain(ESC);
  });

  it("can suppress the summary shell for detail-only final TTY output", () => {
    const transcript = renderMessageTranscript({
      messageId: "message-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "3s",
      workspacePath: ".voratiq/message/sessions/message-123",
      status: "succeeded",
      recipients: [
        {
          agentId: "agent-a",
          status: "succeeded",
          duration: "3s",
          outputPath:
            ".voratiq/message/sessions/message-123/agent-a/artifacts/response.md",
        },
      ],
      isTty: true,
      includeSummarySection: false,
    });

    expect(transcript).toContain("Agent: agent-a");
    expect(transcript).toContain("Output:");
    expect(transcript).not.toContain("AGENT");
    expect(transcript).not.toContain("Elapsed");
  });
});
