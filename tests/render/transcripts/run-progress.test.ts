import { describe, expect, it } from "@jest/globals";

import type {
  AgentInvocationRecord,
  RunReport,
} from "../../../src/domains/runs/model/types.js";
import { createRunRenderer } from "../../../src/render/transcripts/run.js";
import { formatCliOutput } from "../../../src/utils/output.js";
import { createRunReport } from "../../support/factories/run-records.js";

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
const CONTROL_SEQUENCE = new RegExp(String.raw`^\x1b\[(\d+)([A-Za-z])`);
const SGR_SEQUENCE = new RegExp(String.raw`^\x1b\[[0-9;]*m`, "u");

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function normalizeFrame(value: string): string {
  return value
    .replace(ANSI_PATTERN, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function createAgentReport(
  status: RunReport["agents"][number]["status"],
): RunReport["agents"][number] {
  return {
    agentId: "test-agent",
    status,
    tokenUsageResult: {
      status: "unavailable",
      reason: "chat_not_captured",
      provider: "unknown",
      modelId: "unknown",
    },
    runtimeManifestPath:
      ".voratiq/runs/sessions/run-123/test-agent/runtime.json",
    baseDirectory: ".voratiq/runs/sessions/run-123/test-agent",
    assets: {},
    startedAt: "2025-11-05T12:00:00.000Z",
    completedAt: "2025-11-05T12:00:03.000Z",
    diffStatistics: "2 files changed, 5 insertions(+)",
    diffAttempted: true,
    diffCaptured: true,
  };
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
  it.each(["succeeded", "failed", "aborted"] as const)(
    "returns one non-TTY final frame for %s",
    (status) => {
      const writes: string[] = [];
      const writer = {
        write: (value: string): boolean => {
          writes.push(value);
          return true;
        },
        isTTY: false,
      };

      const renderer = createRunRenderer({ stdout: writer });
      renderer.begin({
        runId: "run-123",
        status: "running",
        specPath: "specs/test.md",
        workspacePath: ".voratiq/runs/sessions/run-123",
        createdAt: "2025-11-05T12:00:00.000Z",
        baseRevisionSha: "abc123",
      });
      renderer.update({
        agentId: "test-agent",
        model: "test-model",
        status: "running",
        startedAt: "2025-11-05T12:00:00.000Z",
      });

      expect(writes).toEqual([]);

      const transcript = renderer.complete(
        createRunReport({
          runId: "run-123",
          status,
          spec: { path: "specs/test.md" },
          createdAt: "2025-11-05T12:00:00.000Z",
          baseRevisionSha: "abc123",
          agents: [createAgentReport(status)],
        }),
      );

      expect(writes).toEqual([]);
      expect(transcript).toContain("run-123");
      expect(transcript).toContain(status.toUpperCase());
      expect(transcript).toContain("AGENT");
      expect(transcript).toContain("test-agent");
      expect(transcript).not.toContain("EVALS");
      expect((transcript.match(/AGENT/gu) ?? []).length).toBe(1);
    },
  );

  it("keeps TTY redraw behavior and freezes on a final frame that matches non-TTY after ANSI normalization", () => {
    const context = {
      runId: "run-123",
      status: "running" as const,
      specPath: "specs/test.md",
      workspacePath: ".voratiq/runs/sessions/run-123",
      createdAt: "2025-11-05T12:00:00.000Z",
      baseRevisionSha: "abc123",
    };

    const report = createRunReport({
      runId: "run-123",
      status: "succeeded",
      spec: { path: "specs/test.md" },
      createdAt: "2025-11-05T12:00:00.000Z",
      baseRevisionSha: "abc123",
      agents: [createAgentReport("succeeded")],
    });

    const tty = new VirtualTty();
    const ttyRenderer = createRunRenderer({ stdout: tty });
    ttyRenderer.begin(context);
    ttyRenderer.update({
      agentId: "test-agent",
      model: "test-model",
      status: "running",
      startedAt: "2025-11-05T12:00:00.000Z",
    });

    const combinedWrites = tty.writes.join("");
    expect(combinedWrites).toContain("\u001b[2K");

    const ttyHint = ttyRenderer.complete(report);
    tty.write(formatCliOutput(ttyHint));

    const nonTtyWrites: string[] = [];
    const nonTtyRenderer = createRunRenderer({
      stdout: {
        isTTY: false,
        write: (value: string): boolean => {
          nonTtyWrites.push(value);
          return true;
        },
      },
    });
    nonTtyRenderer.begin(context);
    nonTtyRenderer.update({
      agentId: "test-agent",
      model: "test-model",
      status: "running",
      startedAt: "2025-11-05T12:00:00.000Z",
    });
    const nonTtyTranscript = nonTtyRenderer.complete(report);

    expect(nonTtyWrites).toEqual([]);

    const nonTtyFrame =
      nonTtyTranscript.split("\n\nTo review results:")[0] ?? "";
    const ttyFrame = tty.snapshot().split("\n\nTo review results:")[0] ?? "";

    expect(normalizeFrame(ttyFrame)).toBe(normalizeFrame(nonTtyFrame));
  });

  it("shows elapsed and final diff data in the non-TTY final frame", () => {
    const baseTime = new Date("2025-11-05T12:00:00.000Z").getTime();
    const startedAt = "2025-11-05T12:00:10.000Z";
    const completedAt = "2025-11-05T12:01:05.000Z";
    const renderer = createRunRenderer({
      now: () => baseTime + 65000,
      stdout: {
        isTTY: false,
        write: () => true,
      },
    });

    renderer.begin({
      runId: "run-123",
      status: "running",
      specPath: "specs/test.md",
      workspacePath: ".voratiq/runs/sessions/run-123",
      createdAt: "2025-11-05T12:00:00.000Z",
      startedAt,
      baseRevisionSha: "abc123",
    });

    const transcript = renderer.complete(
      createRunReport({
        runId: "run-123",
        status: "succeeded",
        spec: { path: "specs/test.md" },
        createdAt: "2025-11-05T12:00:00.000Z",
        startedAt,
        completedAt,
        baseRevisionSha: "abc123",
        agents: [createAgentReport("succeeded")],
      }),
    );

    const plain = stripAnsi(transcript);
    expect(plain).toContain("Elapsed");
    expect(plain).toContain("55s");
    expect(plain).toContain("2f +5");
    expect(plain).not.toContain("EVALS");
  });

  it("shows live elapsed while keeping running table duration frozen", () => {
    let currentTime = new Date("2025-11-05T12:00:19.000Z").getTime();
    const tty = new VirtualTty();
    const renderer = createRunRenderer({
      now: () => currentTime,
      stdout: tty,
    });

    renderer.begin({
      runId: "run-123",
      status: "running",
      specPath: "specs/test.md",
      workspacePath: ".voratiq/runs/sessions/run-123",
      createdAt: "2025-11-05T12:00:00.000Z",
      startedAt: "2025-11-05T12:00:00.000Z",
      baseRevisionSha: "abc123",
    });
    renderer.update({
      agentId: "test-agent",
      model: "test-model",
      status: "running",
      startedAt: "2025-11-05T12:00:00.000Z",
    });

    let frame = normalizeFrame(tty.snapshot());
    expect(frame).toContain("Elapsed        19s");
    expect(frame).toMatch(/test-agent\s+RUNNING\s+—/u);

    currentTime = new Date("2025-11-05T12:00:23.000Z").getTime();
    renderer.update({
      agentId: "test-agent",
      model: "test-model",
      status: "running",
      startedAt: "2025-11-05T12:00:00.000Z",
    });

    frame = normalizeFrame(tty.snapshot());
    expect(frame).toContain("Elapsed        23s");
    expect(frame).toMatch(/test-agent\s+RUNNING\s+—/u);
  });

  it("disables TTY rendering on write errors and logs warning once", () => {
    const errors: string[] = [];
    const renderer = createRunRenderer({
      stdout: {
        isTTY: true,
        write: () => {
          throw new Error("mock write error");
        },
      },
      stderr: {
        write: (value: string): boolean => {
          errors.push(value);
          return true;
        },
      },
    });

    renderer.begin({
      runId: "run-123",
      status: "running",
      specPath: "specs/test.md",
      workspacePath: ".voratiq/runs/sessions/run-123",
      createdAt: "2025-11-05T12:00:00.000Z",
      baseRevisionSha: "abc123",
    });

    renderer.update({
      agentId: "test-agent",
      model: "test-model",
      status: "queued",
    } as AgentInvocationRecord);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Progressive run output disabled");
    expect(errors[0]).toContain("mock write error");
  });
});
