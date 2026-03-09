import { describe, expect, it } from "@jest/globals";

import { parseReductionArtifact } from "../../../src/domains/reductions/competition/reduction.js";

describe("parseReductionArtifact", () => {
  it("accepts the compact propagated payload", () => {
    const parsed = parseReductionArtifact(
      JSON.stringify({
        summary: "ok",
        directives: ["Do the thing."],
        risks: ["Might break."],
      }),
    );

    expect(parsed).toEqual({
      summary: "ok",
      directives: ["Do the thing."],
      risks: ["Might break."],
    });
  });

  it("rejects payloads without directives", () => {
    expect(() =>
      parseReductionArtifact(
        JSON.stringify({
          summary: "ok",
          directives: [],
          risks: [],
        }),
      ),
    ).toThrow(/schema validation failed/i);
  });
});
