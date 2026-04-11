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

  it("rewrites the final TTY frame to unresolved when selection downgrades the result", () => {
    const tty = new VirtualTty();
    const renderer = createVerifyRenderer({
      stdout: tty,
      now: () => Date.parse("2026-01-01T00:00:05.000Z"),
    });

    renderer.begin({
      verificationId: "verify-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      workspacePath: ".voratiq/verify/sessions/verify-123",
      status: "running",
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
    renderer.complete("unresolved", {
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: "2026-01-01T00:00:04.000Z",
    });

    const nonTtyTranscript = renderVerifyTranscript({
      verificationId: "verify-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "3s",
      workspacePath: ".voratiq/verify/sessions/verify-123",
      status: "unresolved",
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
    expect(transcript).not.toContain("Run        run-123");
    expect(transcript).toContain("Agent: —");
    expect(transcript).toContain("Verifier: programmatic");
  });

  it("renders '-' for a missing artifact in transcript blocks", () => {
    const transcript = renderVerifyTranscript({
      verificationId: "verify-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "3s",
      workspacePath: ".voratiq/verify/sessions/verify-123",
      status: "running",
      methods: [
        {
          verifierLabel: "programmatic",
          duration: "—",
          status: "running",
        },
      ],
      suppressHint: true,
      isTty: false,
      includeSummarySection: true,
    });

    expect(transcript).toContain("Output: —");
  });

  it("renders the target row inside the summary shell when provided", () => {
    const transcript = renderVerifyTranscript({
      verificationId: "verify-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "3s",
      workspacePath: ".voratiq/verify/sessions/verify-123",
      status: "succeeded",
      target: {
        kind: "run",
        sessionId: "run-123",
      },
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

    const summaryShell = transcript.split("\n\n---\n\nAgent:")[0] ?? "";
    expect(summaryShell).toContain("Target     run:run-123");
    expect(summaryShell).toContain("AGENT");
  });

  it("renders mixed outcomes with a succeeded session summary and failed method rows", () => {
    const transcript = renderVerifyTranscript({
      verificationId: "verify-mixed",
      createdAt: "2026-01-01T00:00:00.000Z",
      elapsed: "3s",
      workspacePath: ".voratiq/verify/sessions/verify-mixed",
      status: "succeeded",
      methods: [
        {
          verifierLabel: "run-verification",
          agentLabel: "verifier-a",
          duration: "2s",
          status: "succeeded",
          artifactPath: "verifier-a/result.json",
        },
        {
          verifierLabel: "run-verification",
          agentLabel: "verifier-b",
          duration: "2s",
          status: "failed",
          artifactPath: "verifier-b/result.json",
          errorLine: "verifier output invalid",
        },
      ],
      suppressHint: true,
      isTty: false,
      includeSummarySection: true,
    });

    expect(transcript).toContain("verify-mixed SUCCEEDED");
    expect(transcript).toContain("verifier-b");
    expect(transcript).toContain("FAILED");
    expect(transcript).toContain("Error: verifier output invalid");
  });
});
