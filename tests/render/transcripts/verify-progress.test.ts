import { describe, expect, it } from "@jest/globals";

import {
  createVerifyRenderer,
  renderVerifyTranscript,
} from "../../../src/render/transcripts/verify.js";
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

describe("verify live progress renderer", () => {
  it("does not emit intermediate non-TTY status-table snapshots", () => {
    const lines: string[] = [];
    const renderer = createVerifyRenderer({
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
      verificationId: "verify-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      workspacePath: ".voratiq/verify/sessions/verify-123",
      targetKind: "run",
      targetSessionId: "run-123",
      status: "running",
    });
    renderer.update({
      methodKey: "programmatic",
      verifierLabel: "programmatic",
      status: "running",
      startedAt: "2026-01-01T00:00:01.000Z",
    });
    renderer.update({
      methodKey: "programmatic",
      verifierLabel: "programmatic",
      status: "succeeded",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: "2026-01-01T00:00:04.000Z",
      artifactPath: "programmatic/artifacts/result.json",
    });
    renderer.complete("succeeded");

    expect(lines).toEqual([]);
  });

  it("freezes a TTY final frame that matches the non-TTY summary frame after ANSI normalization", () => {
    const tty = new VirtualTty();
    const renderer = createVerifyRenderer({
      stdout: tty,
      now: () => Date.parse("2026-01-01T00:00:05.000Z"),
    });

    renderer.begin({
      verificationId: "verify-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      workspacePath: ".voratiq/verify/sessions/verify-123",
      targetKind: "run",
      targetSessionId: "run-123",
      status: "running",
    });
    renderer.update({
      methodKey: "programmatic",
      verifierLabel: "programmatic",
      status: "running",
      startedAt: "2026-01-01T00:00:01.000Z",
    });
    renderer.update({
      methodKey: "programmatic",
      verifierLabel: "programmatic",
      status: "succeeded",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: "2026-01-01T00:00:04.000Z",
      artifactPath: "programmatic/artifacts/result.json",
    });
    renderer.complete("succeeded");

    const nonTtyTranscript = renderVerifyTranscript({
      verificationId: "verify-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "3s",
      workspacePath: ".voratiq/verify/sessions/verify-123",
      targetKind: "run",
      targetSessionId: "run-123",
      status: "succeeded",
      methods: [
        {
          verifierLabel: "programmatic",
          duration: "3s",
          status: "succeeded",
          artifactPath: "programmatic/artifacts/result.json",
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
    const renderer = createVerifyRenderer({
      stdout: tty,
      now: () => currentTime,
    });

    renderer.begin({
      verificationId: "verify-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      workspacePath: ".voratiq/verify/sessions/verify-123",
      targetKind: "run",
      targetSessionId: "run-123",
      status: "running",
    });
    renderer.update({
      methodKey: "programmatic",
      verifierLabel: "programmatic",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    let frame = normalizeFrame(tty.snapshot());
    expect(frame).toContain("Elapsed    3s");
    expect(frame).toMatch(/—\s+programmatic\s+RUNNING\s+—/u);

    currentTime = Date.parse("2026-01-01T00:00:07.000Z");
    renderer.update({
      methodKey: "programmatic",
      verifierLabel: "programmatic",
      status: "running",
    });

    frame = normalizeFrame(tty.snapshot());
    expect(frame).toContain("Elapsed    7s");
    expect(frame).toMatch(/—\s+programmatic\s+RUNNING\s+—/u);
  });

  it("renders the programmatic verifier label as plain text in TTY summaries", () => {
    const transcript = renderVerifyTranscript({
      verificationId: "verify-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "3s",
      workspacePath: ".voratiq/verify/sessions/verify-123",
      targetKind: "run",
      targetSessionId: "run-123",
      status: "succeeded",
      methods: [
        {
          verifierLabel: "programmatic",
          duration: "3s",
          status: "succeeded",
          artifactPath: "programmatic/artifacts/result.json",
        },
      ],
      suppressHint: true,
      isTty: true,
      includeSummarySection: true,
    });

    expect(transcript).toContain("programmatic");
    expect(transcript).toContain("Target     Run run-123");
  });
});
