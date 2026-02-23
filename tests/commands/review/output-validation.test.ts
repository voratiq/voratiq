import { describe, expect, it } from "@jest/globals";

import { validateReviewOutputContract } from "../../../src/commands/review/output-validation.js";

describe("review output contract validation", () => {
  it("accepts full required structure with a single candidate", () => {
    const markdown = buildReviewMarkdown({
      candidateAssessments: [
        {
          candidateId: "r_aaaaaaaaaa",
          body: "Single candidate assessment.",
        },
      ],
      ranking: ["r_aaaaaaaaaa"],
    });

    const result = validateReviewOutputContract({
      reviewMarkdown: markdown,
      eligibleCandidateIds: ["r_aaaaaaaaaa"],
    });

    expect(result.ranking).toEqual(["r_aaaaaaaaaa"]);
  });

  it("rejects ranking with duplicate candidate ids", () => {
    const markdown = buildReviewMarkdown({
      candidateAssessments: [
        {
          candidateId: "r_aaaaaaaaaa",
          body: "Assessment A.",
        },
        {
          candidateId: "r_bbbbbbbbbb",
          body: "Assessment B.",
        },
      ],
      ranking: ["r_aaaaaaaaaa", "r_aaaaaaaaaa"],
    });

    expect(() =>
      validateReviewOutputContract({
        reviewMarkdown: markdown,
        eligibleCandidateIds: ["r_aaaaaaaaaa", "r_bbbbbbbbbb"],
      }),
    ).toThrow(/duplicate candidate ids/u);
  });

  it("rejects ranking omissions", () => {
    const markdown = buildReviewMarkdown({
      candidateAssessments: [
        {
          candidateId: "r_aaaaaaaaaa",
          body: "Assessment A.",
        },
        {
          candidateId: "r_bbbbbbbbbb",
          body: "Assessment B.",
        },
      ],
      ranking: ["r_aaaaaaaaaa"],
    });

    expect(() =>
      validateReviewOutputContract({
        reviewMarkdown: markdown,
        eligibleCandidateIds: ["r_aaaaaaaaaa", "r_bbbbbbbbbb"],
      }),
    ).toThrow(/must include every eligible candidate exactly once/u);
  });

  it("rejects missing ranking section", () => {
    const markdown = buildReviewMarkdown({
      candidateAssessments: [
        {
          candidateId: "r_aaaaaaaaaa",
          body: "Assessment A.",
        },
      ],
      ranking: ["r_aaaaaaaaaa"],
    }).replace(
      /^## Ranking[\s\S]*?^## Recommendation/mu,
      "## Recommendation\n",
    );

    expect(() =>
      validateReviewOutputContract({
        reviewMarkdown: markdown,
        eligibleCandidateIds: ["r_aaaaaaaaaa"],
      }),
    ).toThrow(/Missing required section heading: ## Ranking/u);
  });

  it("rejects invalid section ordering", () => {
    const markdown = [
      "# Review",
      "",
      "## Specification",
      "Summary",
      "",
      "## Key Requirements",
      "- R1",
      "",
      "## Candidate Assessments",
      "### r_aaaaaaaaaa",
      "Assessment A.",
      "",
      "## Comparison",
      "Comparison.",
      "",
      "## Recommendation",
      "**Preferred Candidate**: r_aaaaaaaaaa",
      "**Rationale**: Reason",
      "**Next Actions**:",
      "none",
      "",
      "## Ranking",
      "1. r_aaaaaaaaaa",
      "",
    ].join("\n");

    expect(() =>
      validateReviewOutputContract({
        reviewMarkdown: markdown,
        eligibleCandidateIds: ["r_aaaaaaaaaa"],
      }),
    ).toThrow(/Section order is invalid/u);
  });

  it("allows non-required sections between ranking and recommendation", () => {
    const markdown = [
      "# Review",
      "",
      "## Specification",
      "Summary",
      "",
      "## Key Requirements",
      "- R1",
      "",
      "## Candidate Assessments",
      "### r_aaaaaaaaaa",
      "Assessment A.",
      "",
      "## Comparison",
      "Comparison.",
      "",
      "## Ranking",
      "1. r_aaaaaaaaaa",
      "",
      "## Notes",
      "Additional optional notes.",
      "",
      "## Recommendation",
      "**Preferred Candidate**: r_aaaaaaaaaa",
      "**Rationale**: Reason",
      "**Next Actions**:",
      "none",
      "",
    ].join("\n");

    expect(() =>
      validateReviewOutputContract({
        reviewMarkdown: markdown,
        eligibleCandidateIds: ["r_aaaaaaaaaa"],
      }),
    ).not.toThrow();
  });

  it("rejects candidate assessments that are not lexicographically ordered", () => {
    const markdown = buildReviewMarkdown({
      candidateAssessments: [
        {
          candidateId: "r_bbbbbbbbbb",
          body: "Assessment B.",
        },
        {
          candidateId: "r_aaaaaaaaaa",
          body: "Assessment A.",
        },
      ],
      ranking: ["r_aaaaaaaaaa", "r_bbbbbbbbbb"],
    });

    expect(() =>
      validateReviewOutputContract({
        reviewMarkdown: markdown,
        eligibleCandidateIds: ["r_aaaaaaaaaa", "r_bbbbbbbbbb"],
      }),
    ).toThrow(/ordered lexicographically/u);
  });

  it("allows cross-candidate references in candidate assessment blocks", () => {
    const markdown = buildReviewMarkdown({
      candidateAssessments: [
        {
          candidateId: "r_aaaaaaaaaa",
          body: "Compared to r_bbbbbbbbbb, this is stronger on requirements coverage.",
        },
        {
          candidateId: "r_bbbbbbbbbb",
          body: "Assessment B.",
        },
      ],
      ranking: ["r_aaaaaaaaaa", "r_bbbbbbbbbb"],
    });

    expect(() =>
      validateReviewOutputContract({
        reviewMarkdown: markdown,
        eligibleCandidateIds: ["r_aaaaaaaaaa", "r_bbbbbbbbbb"],
      }),
    ).not.toThrow();
  });

  it("accepts annotated ranking lines with bold/code-wrapped candidate selectors", () => {
    const markdown = buildReviewMarkdown({
      candidateAssessments: [
        {
          candidateId: "r_aaaaaaaaaa",
          body: "Assessment A.",
        },
        {
          candidateId: "r_bbbbbbbbbb",
          body: "Assessment B.",
        },
        {
          candidateId: "r_cccccccccc",
          body: "Assessment C.",
        },
      ],
      ranking: [],
      rankingLines: [
        "1. **r_aaaaaaaaaa** — strongest foundation",
        "2. r_bbbbbbbbbb - cleaner apply path",
        "3. `r_cccccccccc` (lowest risk)",
      ],
    });

    const result = validateReviewOutputContract({
      reviewMarkdown: markdown,
      eligibleCandidateIds: ["r_aaaaaaaaaa", "r_bbbbbbbbbb", "r_cccccccccc"],
    });

    expect(result.ranking).toEqual([
      "r_aaaaaaaaaa",
      "r_bbbbbbbbbb",
      "r_cccccccccc",
    ]);
  });

  it("rejects ranking entries where the candidate selector is not first", () => {
    const markdown = buildReviewMarkdown({
      candidateAssessments: [
        {
          candidateId: "r_aaaaaaaaaa",
          body: "Assessment A.",
        },
      ],
      ranking: [],
      rankingLines: ["1. strongest option: r_aaaaaaaaaa"],
    });

    expect(() =>
      validateReviewOutputContract({
        reviewMarkdown: markdown,
        eligibleCandidateIds: ["r_aaaaaaaaaa"],
      }),
    ).toThrow(/must begin with a candidate id selector/u);
  });

  it("rejects annotated ranking lines that reference unknown candidate ids", () => {
    const markdown = buildReviewMarkdown({
      candidateAssessments: [
        {
          candidateId: "r_aaaaaaaaaa",
          body: "Assessment A.",
        },
      ],
      ranking: [],
      rankingLines: ["1. **r_zzzzzzzzzz** - not in eligible set"],
    });

    expect(() =>
      validateReviewOutputContract({
        reviewMarkdown: markdown,
        eligibleCandidateIds: ["r_aaaaaaaaaa"],
      }),
    ).toThrow(/Ranking contains unknown candidate id\(s\)/u);
  });
});

function buildReviewMarkdown(options: {
  candidateAssessments: Array<{ candidateId: string; body: string }>;
  ranking: string[];
  rankingLines?: string[];
}): string {
  const {
    candidateAssessments,
    ranking,
    rankingLines: customRankingLines,
  } = options;

  const assessmentLines = candidateAssessments.flatMap((assessment) => [
    `### ${assessment.candidateId}`,
    assessment.body,
    "",
  ]);

  const rankingLines =
    customRankingLines ??
    ranking.map((candidateId, index) => `${index + 1}. ${candidateId}`);

  return [
    "# Review",
    "",
    "## Specification",
    "Summary",
    "",
    "## Key Requirements",
    "- R1",
    "",
    "## Candidate Assessments",
    ...assessmentLines,
    "## Comparison",
    "Comparison details.",
    "",
    "## Ranking",
    ...rankingLines,
    "",
    "## Recommendation",
    "**Preferred Candidate**: r_aaaaaaaaaa",
    "**Rationale**: Reason",
    "**Next Actions**:",
    "voratiq apply --run run-1 --agent r_aaaaaaaaaa",
    "",
  ].join("\n");
}
