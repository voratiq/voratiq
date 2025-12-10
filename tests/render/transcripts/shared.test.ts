import { describe, expect, it } from "@jest/globals";

import { renderTranscriptWithMetadata } from "../../../src/render/transcripts/shared.js";

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
});
