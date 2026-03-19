import {
  deriveReviewSelectionDecision,
  deriveSelectorSelectionDecision,
} from "../../src/policy/index.js";

describe("policy review selection decisions", () => {
  it("resolves when successful reviewers unanimously select one canonical agent", () => {
    const decision = deriveReviewSelectionDecision({
      canonicalAgentIds: ["agent-a", "agent-b"],
      reviewers: [
        {
          reviewerAgentId: "reviewer-a",
          status: "succeeded",
          preferredCandidateId: "agent-b",
          resolvedPreferredCandidateId: "agent-b",
        },
        {
          reviewerAgentId: "reviewer-b",
          status: "succeeded",
          preferredCandidateId: "agent-b",
          resolvedPreferredCandidateId: "agent-b",
        },
      ],
    });

    expect(decision).toEqual({
      state: "resolvable",
      applyable: true,
      selectedCanonicalAgentId: "agent-b",
      unresolvedReasons: [],
    });
  });

  it("is unresolved when successful reviewers disagree", () => {
    const decision = deriveReviewSelectionDecision({
      canonicalAgentIds: ["agent-a", "agent-b"],
      reviewers: [
        {
          reviewerAgentId: "reviewer-a",
          status: "succeeded",
          preferredCandidateId: "agent-a",
          resolvedPreferredCandidateId: "agent-a",
        },
        {
          reviewerAgentId: "reviewer-b",
          status: "succeeded",
          preferredCandidateId: "agent-b",
          resolvedPreferredCandidateId: "agent-b",
        },
      ],
    });

    expect(decision.state).toBe("unresolved");
    expect(decision.applyable).toBe(false);
    expect(decision.unresolvedReasons).toContainEqual({
      code: "reviewer_disagreement",
      selections: [
        {
          reviewerAgentId: "reviewer-a",
          selectedCanonicalAgentId: "agent-a",
        },
        {
          reviewerAgentId: "reviewer-b",
          selectedCanonicalAgentId: "agent-b",
        },
      ],
    });
  });

  it("is unresolved when a successful reviewer does not produce a preference", () => {
    const decision = deriveReviewSelectionDecision({
      canonicalAgentIds: ["agent-a", "agent-b"],
      reviewers: [
        {
          reviewerAgentId: "reviewer-a",
          status: "succeeded",
        },
      ],
    });

    expect(decision).toEqual({
      state: "unresolved",
      applyable: false,
      unresolvedReasons: [
        {
          code: "reviewer_preference_missing",
          reviewerAgentId: "reviewer-a",
        },
      ],
    });
  });

  it("is unresolved when any reviewer fails, even if successful reviewers agree", () => {
    const decision = deriveReviewSelectionDecision({
      canonicalAgentIds: ["agent-a", "agent-b"],
      reviewers: [
        {
          reviewerAgentId: "reviewer-a",
          status: "failed",
        },
        {
          reviewerAgentId: "reviewer-b",
          status: "succeeded",
          preferredCandidateId: "agent-b",
          resolvedPreferredCandidateId: "agent-b",
        },
      ],
    });

    expect(decision).toEqual({
      state: "unresolved",
      applyable: false,
      unresolvedReasons: [
        {
          code: "reviewer_failed",
          failedReviewerAgentIds: ["reviewer-a"],
        },
      ],
    });
  });

  it("resolves a canonical agent id from the raw preferred candidate when needed", () => {
    const decision = deriveReviewSelectionDecision({
      canonicalAgentIds: ["agent-a", "agent-b"],
      reviewers: [
        {
          reviewerAgentId: "reviewer-a",
          status: "succeeded",
          preferredCandidateId: "agent-a",
        },
      ],
    });

    expect(decision).toEqual({
      state: "resolvable",
      applyable: true,
      selectedCanonicalAgentId: "agent-a",
      unresolvedReasons: [],
    });
  });
});

describe("policy selector selection decisions", () => {
  it("resolves a blinded selector when every matching review session agrees", () => {
    const decision = deriveSelectorSelectionDecision({
      selector: "r_aaaaaaaaaa",
      canonicalAgentIds: ["agent-a", "agent-b"],
      sources: [
        {
          sourceId: "review-1",
          aliasMap: { r_aaaaaaaaaa: "agent-b" },
        },
        {
          sourceId: "review-2",
          aliasMap: { r_aaaaaaaaaa: "agent-b" },
        },
      ],
    });

    expect(decision).toEqual({
      state: "resolvable",
      applyable: true,
      selectedCanonicalAgentId: "agent-b",
      unresolvedReasons: [],
    });
  });
});
