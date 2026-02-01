import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { createRunRenderer } from "../../../src/render/transcripts/run.js";
import type { AgentInvocationRecord } from "../../../src/runs/records/types.js";
import { formatCliOutput } from "../../../src/utils/output.js";
import { createRunReport } from "../../support/factories/run-records.js";

const SUPPRESS_ENV = "VORATIQ_SUPPRESS_RUN_STATUS_TABLE";
const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
const CONTROL_SEQUENCE = new RegExp(String.raw`^\x1b\[(\d+)([A-Za-z])`);
const originalSuppress = process.env[SUPPRESS_ENV];

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

beforeEach(() => {
  delete process.env[SUPPRESS_ENV];
});

afterEach(() => {
  if (originalSuppress === undefined) {
    delete process.env[SUPPRESS_ENV];
  } else {
    process.env[SUPPRESS_ENV] = originalSuppress;
  }
});

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
    }

    return match[0].length;
  }

  private ensureLine(row: number): void {
    while (this.buffer.length <= row) {
      this.buffer.push("");
    }
  }
}

describe("createRunRenderer", () => {
  describe("non-TTY mode", () => {
    it("prints metadata once and appends tables on updates", () => {
      const lines: string[] = [];
      const mockStdout = {
        write: (data: string) => {
          lines.push(data);
          return true;
        },
        isTTY: false,
      };

      const renderer = createRunRenderer({ stdout: mockStdout });

      renderer.begin({
        runId: "20251105-test-12345",
        status: "running",
        specPath: "specs/test.md",
        workspacePath: ".voratiq/runs/sessions/20251105-test-12345",
        createdAt: "2025-11-05T12:00:00.000Z",
        baseRevisionSha: "abc123",
      });

      expect(lines[0].startsWith("\n")).toBe(true);
      expect(lines[0].endsWith("\n")).toBe(true);

      const queuedRecord: AgentInvocationRecord = {
        agentId: "test-agent",
        model: "test-model",
        status: "queued",
      };

      renderer.update(queuedRecord);

      expect(lines[1].startsWith("\n")).toBe(true);
      expect(lines[1].endsWith("\n")).toBe(true);

      expect(lines.length).toBeGreaterThan(0);
      const output = lines.join("");
      expect(output).toContain("20251105-test-12345");
      expect(output).toContain("RUNNING");
      expect(output).toContain("test-agent");
      expect(output).toContain("QUEUED");
    });

    it("emits a transcript for non-TTY output and leaves a trailing blank line", () => {
      const lines: string[] = [];
      const mockStdout = {
        write: (data: string) => {
          lines.push(data);
          return true;
        },
        isTTY: false,
      };

      const renderer = createRunRenderer({ stdout: mockStdout });

      renderer.begin({
        runId: "20251105-test-12345",
        status: "running",
        specPath: "specs/test.md",
        workspacePath: ".voratiq/runs/sessions/20251105-test-12345",
        createdAt: "2025-11-05T12:00:00.000Z",
        baseRevisionSha: "abc123",
      });

      renderer.update({
        agentId: "test-agent",
        model: "test-model",
        status: "queued",
      });

      const report = createRunReport({
        runId: "20251105-test-12345",
        status: "succeeded",
        spec: { path: "specs/test.md" },
        baseRevisionSha: "abc123",
        createdAt: "2025-11-05T12:00:00.000Z",
        agents: [],
      });

      const transcript = renderer.complete(report);

      expect(transcript).toContain("20251105-test-12345");
      expect(transcript).toContain("SUCCEEDED");
      expect(lines[lines.length - 1].endsWith("\n")).toBe(true);
    });

    it("displays diff statistics when provided", () => {
      const lines: string[] = [];
      const mockStdout = {
        write: (data: string) => {
          lines.push(data);
          return true;
        },
        isTTY: false,
      };

      const renderer = createRunRenderer({ stdout: mockStdout });

      renderer.begin({
        runId: "20251105-test-12345",
        status: "running",
        specPath: "specs/test.md",
        workspacePath: ".voratiq/runs/sessions/20251105-test-12345",
        createdAt: "2025-11-05T12:00:00.000Z",
        baseRevisionSha: "abc123",
      });

      renderer.update({
        agentId: "test-agent",
        model: "test-model",
        status: "succeeded",
        startedAt: "2025-11-05T12:00:00.000Z",
        completedAt: "2025-11-05T12:05:00.000Z",
        diffStatistics: "2 files changed, 5 insertions(+)",
        evals: [
          { slug: "format", status: "succeeded", command: "npm run format" },
        ],
      });

      const output = lines.join("");
      expect(output).toContain("2f +5");
    });
  });

  describe("TTY mode", () => {
    it("redraws in place without clearing unrelated output", () => {
      const tty = new VirtualTty();
      const renderer = createRunRenderer({ stdout: tty });

      renderer.begin({
        runId: "20251105-test-12345",
        status: "running",
        specPath: "specs/test.md",
        workspacePath: ".voratiq/runs/sessions/20251105-test-12345",
        createdAt: "2025-11-05T12:00:00.000Z",
        baseRevisionSha: "abc123",
      });

      renderer.update({
        agentId: "test-agent",
        model: "test-model",
        status: "queued",
      });

      renderer.update({
        agentId: "test-agent",
        model: "test-model",
        status: "running",
        startedAt: "2025-11-05T12:00:01.000Z",
      });

      const combined = tty.writes.join("");
      expect(combined).toContain("\u001b[2K");
      expect(combined).toContain("\u001b[");
      expect(combined).not.toContain("\u001b[J");

      renderer.complete(
        createRunReport({
          runId: "20251105-test-12345",
          status: "succeeded",
          spec: { path: "specs/test.md" },
          baseRevisionSha: "abc123",
          createdAt: "2025-11-05T12:00:00.000Z",
          agents: [],
        }),
      );
    });

    it("leaves previously printed stdout intact while redrawing", () => {
      const tty = new VirtualTty();
      tty.write("preface line\n");

      const renderer = createRunRenderer({ stdout: tty });

      const context = {
        runId: "20251105-test-12345",
        status: "running" as const,
        specPath: "specs/test.md",
        workspacePath: ".voratiq/runs/sessions/20251105-test-12345",
        createdAt: "2025-11-05T12:00:00.000Z",
        baseRevisionSha: "abc123",
      };

      renderer.begin(context);
      renderer.update({
        agentId: "test-agent",
        model: "test-model",
        status: "running",
        startedAt: "2025-11-05T12:00:01.000Z",
      });

      const snapshot = tty.snapshot();
      expect(snapshot).toContain("preface line");

      renderer.complete(
        createRunReport({
          runId: context.runId,
          status: "succeeded",
          spec: { path: context.specPath },
          baseRevisionSha: context.baseRevisionSha,
          createdAt: context.createdAt,
          agents: [],
        }),
      );
    });

    it("clears leftover lines when the redraw shrinks", () => {
      const tty = new VirtualTty();
      const renderer = createRunRenderer({ stdout: tty });

      renderer.begin({
        runId: "20251105-test-12345",
        status: "running",
        specPath: "specs/test.md",
        workspacePath: ".voratiq/runs/sessions/20251105-test-12345",
        createdAt: "2025-11-05T12:00:00.000Z",
        baseRevisionSha: "abc123",
      });

      const firstSnapshot = tty.snapshot();
      expect(firstSnapshot).toContain(
        ".voratiq/runs/sessions/20251105-test-12345",
      );

      renderer.begin({
        runId: "20251105-test-12345",
        status: "running",
        specPath: "",
        workspacePath: "",
        createdAt: "",
        baseRevisionSha: "",
      });

      const secondSnapshot = tty.snapshot();
      expect(secondSnapshot).not.toContain(
        ".voratiq/runs/sessions/20251105-test-12345",
      );
    });

    it("stops redrawing on completion and returns the review hint", () => {
      const tty = new VirtualTty();
      const renderer = createRunRenderer({ stdout: tty });

      const context = {
        runId: "20251105-test-12345",
        status: "running" as const,
        specPath: "specs/test.md",
        workspacePath: ".voratiq/runs/sessions/20251105-test-12345",
        createdAt: "2025-11-05T12:00:00.000Z",
        baseRevisionSha: "abc123",
      };

      renderer.begin(context);

      renderer.update({
        agentId: "test-agent",
        model: "test-model",
        status: "running",
        startedAt: "2025-11-05T12:00:01.000Z",
      });

      const report = createRunReport({
        runId: context.runId,
        status: "succeeded",
        spec: { path: context.specPath },
        baseRevisionSha: context.baseRevisionSha,
        createdAt: context.createdAt,
        agents: [],
      });

      const transcript = renderer.complete(report);
      const afterCompleteSnapshot = tty.snapshot();
      expect(afterCompleteSnapshot).toContain("SUCCEEDED");

      const writesBeforeUpdate = tty.writes.length;
      renderer.update({
        agentId: "another-agent",
        model: "test-model",
        status: "queued",
      });
      expect(tty.writes.length).toBe(writesBeforeUpdate);

      tty.write(formatCliOutput(transcript));
      const finalSnapshot = tty.snapshot();
      expect(transcript).toBe(
        `To review results:\n  voratiq review --run ${context.runId} --agent <agent-id>`,
      );
      expect(finalSnapshot).toContain("SUCCEEDED");
      expect(finalSnapshot).not.toContain("voratiq apply");
    });
  });

  describe("error handling", () => {
    it("disables rendering on error and logs warning", () => {
      const errors: string[] = [];
      const mockStderr = {
        write: (data: string) => {
          errors.push(data);
          return true;
        },
      };

      const mockStdout = {
        write: () => {
          throw new Error("mock write error");
        },
        isTTY: false,
      };

      const renderer = createRunRenderer({
        stdout: mockStdout,
        stderr: mockStderr,
      });

      renderer.begin({
        runId: "20251105-test-12345",
        status: "running",
        specPath: "specs/test.md",
        workspacePath: ".voratiq/runs/sessions/20251105-test-12345",
        createdAt: "2025-11-05T12:00:00.000Z",
        baseRevisionSha: "abc123",
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("Progressive run output disabled");
      expect(errors[0]).toContain("mock write error");

      renderer.update({
        agentId: "test-agent",
        model: "test-model",
        status: "queued",
      });

      expect(errors.length).toBe(1);
    });
  });

  describe("elapsed time formatting", () => {
    it("shows run-level elapsed while agents run and keeps per-agent duration final-only", () => {
      const lines: string[] = [];
      const mockStdout = {
        write: (data: string) => {
          lines.push(data);
          return true;
        },
        isTTY: false,
      };

      const baseTime = new Date("2025-11-05T12:00:00.000Z").getTime();
      const now = () => baseTime + 65000;

      const renderer = createRunRenderer({ stdout: mockStdout, now });

      renderer.begin({
        runId: "20251105-test-12345",
        status: "running",
        specPath: "specs/test.md",
        workspacePath: ".voratiq/runs/sessions/20251105-test-12345",
        createdAt: "2025-11-05T12:00:00.000Z",
        baseRevisionSha: "abc123",
      });

      renderer.update({
        agentId: "test-agent",
        model: "test-model",
        status: "running",
        startedAt: "2025-11-05T12:00:00.000Z",
      });

      const output = lines.join("");
      expect(output).toContain("Elapsed");
      expect(output).toContain("1m 5s");
      expect(stripAnsi(output)).toMatch(/test-agent\s+RUNNING\s+—/);
    });
  });

  describe("eval status rendering", () => {
    it("displays eval slugs with status colors", () => {
      const lines: string[] = [];
      const mockStdout = {
        write: (data: string) => {
          lines.push(data);
          return true;
        },
        isTTY: false,
      };

      const renderer = createRunRenderer({ stdout: mockStdout });

      renderer.begin({
        runId: "20251105-test-12345",
        status: "running",
        specPath: "specs/test.md",
        workspacePath: ".voratiq/runs/sessions/20251105-test-12345",
        createdAt: "2025-11-05T12:00:00.000Z",
        baseRevisionSha: "abc123",
      });

      renderer.update({
        agentId: "test-agent",
        model: "test-model",
        status: "succeeded",
        startedAt: "2025-11-05T12:00:00.000Z",
        completedAt: "2025-11-05T12:01:00.000Z",
        evals: [
          { slug: "format", status: "succeeded", command: "npm run format" },
          { slug: "lint", status: "failed", command: "npm run lint" },
        ],
      });

      const output = lines.join("");
      expect(output).toContain("format");
      expect(output).toContain("lint");
    });
  });
});
