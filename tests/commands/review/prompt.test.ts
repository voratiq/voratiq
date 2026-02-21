import { describe, expect, it } from "@jest/globals";

import { buildReviewPrompt } from "../../../src/commands/review/prompt.js";

describe("review prompt generation", () => {
  it("fails when no eligible candidates are provided", () => {
    expect(() =>
      buildReviewPrompt({
        runId: "run-1",
        runStatus: "succeeded",
        specPath: ".voratiq/specs/spec.md",
        baseRevisionSha: "deadbeef",
        createdAt: "2026-01-01T00:00:00.000Z",
        artifactInfoPath: "review-artifact-info.json",
        outputPath: "review.md",
        baseSnapshotPath: ".voratiq/reviews/sessions/review-1/reviewer/base",
        candidates: [],
        repoRootPath: "/repo",
        workspacePath:
          "/repo/.voratiq/reviews/sessions/review-1/reviewer/workspace",
      }),
    ).toThrow(/at least one eligible candidate/u);
  });

  it("includes strict ranking instructions for all candidates", () => {
    const result = buildReviewPrompt({
      runId: "run-1",
      runStatus: "succeeded",
      specPath: ".voratiq/specs/spec.md",
      baseRevisionSha: "deadbeef",
      createdAt: "2026-01-01T00:00:00.000Z",
      artifactInfoPath: "review-artifact-info.json",
      outputPath: "review.md",
      baseSnapshotPath: ".voratiq/reviews/sessions/review-1/reviewer/base",
      candidates: [
        {
          candidateId: "r_bbbbbbbbbb",
          diffPath: "inputs/candidates/r_b/diff.patch",
        },
        {
          candidateId: "r_aaaaaaaaaa",
          diffPath: "inputs/candidates/r_a/diff.patch",
        },
      ],
      repoRootPath: "/repo",
      workspacePath:
        "/repo/.voratiq/reviews/sessions/review-1/reviewer/workspace",
    });

    expect(result.prompt).toContain(
      "`## Ranking` must be a strict best-to-worst list of all candidates with no ties.",
    );
    expect(result.prompt).toContain("  - r_aaaaaaaaaa");
    expect(result.prompt).toContain("  - r_bbbbbbbbbb");
    expect(result.prompt.indexOf("  - r_aaaaaaaaaa")).toBeLessThan(
      result.prompt.indexOf("  - r_bbbbbbbbbb"),
    );
  });
});
