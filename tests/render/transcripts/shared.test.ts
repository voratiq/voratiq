import { describe, expect, it } from "@jest/globals";

import { renderTranscriptWithMetadata } from "../../../src/render/transcripts/shared.js";

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

describe("renderTranscriptWithMetadata", () => {
  it("renders metadata, notes, agents, warnings, and hints in order", () => {
    const transcript = renderTranscriptWithMetadata({
      metadata: {
        runId: "run_123",
        status: "queued",
        specPath: "spec.md",
      },
      agents: [
        {
          agentId: "agent-alpha",
          status: "succeeded",
          startedAt: "2024-01-01T00:00:00.000Z",
          completedAt: "2024-01-01T00:01:00.000Z",
        },
      ],
      beforeAgents: [["Preface"]],
      warnings: ["Warning"],
      afterAgents: [["Done"]],
      hint: { message: "Hint" },
    });

    const prefaceIndex = transcript.indexOf("Preface");
    const agentIndex = transcript.indexOf("agent-alpha");
    const warningIndex = transcript.indexOf("Warning");
    const doneIndex = transcript.indexOf("Done");
    const hintIndex = transcript.lastIndexOf("Hint");

    expect(prefaceIndex).toBeGreaterThan(-1);
    expect(agentIndex).toBeGreaterThan(prefaceIndex);
    expect(warningIndex).toBeGreaterThan(agentIndex);
    expect(doneIndex).toBeGreaterThan(warningIndex);
    expect(hintIndex).toBeGreaterThan(doneIndex);
  });

  it("omits ANSI escapes for non-TTY shell output", () => {
    const transcript = renderTranscriptWithMetadata({
      metadata: {
        runId: "run_123",
        status: "failed",
        specPath: "spec.md",
      },
      agents: [
        {
          agentId: "agent-alpha",
          status: "failed",
          startedAt: "2024-01-01T00:00:00.000Z",
          completedAt: "2024-01-01T00:01:00.000Z",
          error: "agent-alpha failed",
        },
      ],
      hint: { message: "Hint" },
      isTty: false,
    });

    expect(transcript).toContain("run_123");
    expect(transcript).toContain("FAILED");
    expect(transcript).toContain("Error: agent-alpha failed");
    expect(transcript).not.toMatch(ANSI_PATTERN);
  });
});
