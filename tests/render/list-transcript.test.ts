import { renderListTranscript } from "../../src/render/transcripts/list.js";
import type { RunRecord } from "../../src/runs/records/types.js";
import { createRunRecord } from "../support/factories/run-records.js";

describe("renderListTranscript", () => {
  it("renders the run list table followed by a review hint", () => {
    const records: RunRecord[] = [
      buildRunRecord({
        runId: "20251016-133651-woeqr",
        specPath: "specs/onboarding-ux.md",
        createdAt: "2025-10-16T13:36:51.000Z",
      }),
    ];

    const output = renderListTranscript(records);

    expect(output).toContain("RUN");
    expect(output).toContain("STATUS");
    expect(output).toContain("SPEC");
    expect(output).toContain("20251016-133651-woeqr");
    expect(output).toContain(
      "To review a run in more detail:\n  voratiq review --run <run-id>",
    );
  });

  it("omits the hint when no records are provided", () => {
    const output = renderListTranscript([]);
    expect(output).toBe("");
  });
});

function buildRunRecord(params: {
  runId: string;
  specPath: string;
  createdAt: string;
}): RunRecord {
  return createRunRecord({
    runId: params.runId,
    baseRevisionSha: "abc123",
    spec: { path: params.specPath },
    status: "succeeded",
    createdAt: params.createdAt,
    agents: [],
  });
}
