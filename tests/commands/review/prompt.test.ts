import { describe, expect, it } from "@jest/globals";

import { buildReviewPrompt } from "../../../src/domains/reviews/competition/prompt.js";

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

  it("includes markdown and recommendation artifact requirements", () => {
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
          candidateId: "r_aaaaaaaaaa",
          diffPath: "inputs/candidates/r_a/diff.patch",
        },
      ],
      repoRootPath: "/repo",
      workspacePath:
        "/repo/.voratiq/reviews/sessions/review-1/reviewer/workspace",
    });

    expect(result.prompt).toContain(
      "Save the full review to `review.md` in the workspace root.",
    );
    expect(result.prompt).toContain(
      "Save the machine-readable recommendation to `recommendation.json` in the workspace root, with this shape:",
    );
    expect(result.prompt).toContain(
      '{"preferred_agent":"<candidate-id>","ranking":["<candidate-id>","<candidate-id>"],"rationale":"<summary>","next_actions":["<action>"]}',
    );
    expect(result.prompt).toContain(
      "The machine-readable recommendation must match the same selection described in `## Recommendation`.",
    );
  });

  it("lists staged extra-context files when provided", () => {
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
          candidateId: "r_aaaaaaaaaa",
          diffPath: "inputs/candidates/r_a/diff.patch",
        },
      ],
      repoRootPath: "/repo",
      workspacePath:
        "/repo/.voratiq/reviews/sessions/review-1/reviewer/workspace",
      extraContextFiles: [
        {
          absolutePath: "/repo/notes/a.md",
          displayPath: "notes/a.md",
          stagedRelativePath: "../context/a.md",
        },
      ],
    });

    expect(result.prompt).toContain(
      "Extra context files (staged alongside the workspace):",
    );
    expect(result.prompt).toContain("`../context/a.md` (source: `notes/a.md`)");
  });
});
