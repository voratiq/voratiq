import {
  deriveSelectorSelectionDecision,
  deriveVerifierSelectionDecision,
} from "../../src/policy/index.js";

describe("policy verifier selection decisions", () => {
  it("resolves when successful verifiers unanimously select one canonical agent", () => {
    const decision = deriveVerifierSelectionDecision({
      canonicalAgentIds: ["agent-a", "agent-b"],
      verifiers: [
        {
          verifierAgentId: "verifier-a",
          status: "succeeded",
          preferredCandidateId: "agent-b",
          resolvedPreferredCandidateId: "agent-b",
        },
        {
          verifierAgentId: "verifier-b",
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

  it("is unresolved when successful verifiers disagree", () => {
    const decision = deriveVerifierSelectionDecision({
      canonicalAgentIds: ["agent-a", "agent-b"],
      verifiers: [
        {
          verifierAgentId: "verifier-a",
          status: "succeeded",
          preferredCandidateId: "agent-a",
          resolvedPreferredCandidateId: "agent-a",
        },
        {
          verifierAgentId: "verifier-b",
          status: "succeeded",
          preferredCandidateId: "agent-b",
          resolvedPreferredCandidateId: "agent-b",
        },
      ],
    });

    expect(decision.state).toBe("unresolved");
    expect(decision.applyable).toBe(false);
    expect(decision.unresolvedReasons).toContainEqual({
      code: "verifier_disagreement",
      selections: [
        {
          verifierAgentId: "verifier-a",
          selectedCanonicalAgentId: "agent-a",
        },
        {
          verifierAgentId: "verifier-b",
          selectedCanonicalAgentId: "agent-b",
        },
      ],
    });
  });

  it("is unresolved when a successful verifier does not produce a preference", () => {
    const decision = deriveVerifierSelectionDecision({
      canonicalAgentIds: ["agent-a", "agent-b"],
      verifiers: [
        {
          verifierAgentId: "verifier-a",
          status: "succeeded",
        },
      ],
    });

    expect(decision).toEqual({
      state: "unresolved",
      applyable: false,
      unresolvedReasons: [
        {
          code: "verifier_preference_missing",
          verifierAgentId: "verifier-a",
        },
      ],
    });
  });

  it("is unresolved when any verifier fails, even if successful verifiers agree", () => {
    const decision = deriveVerifierSelectionDecision({
      canonicalAgentIds: ["agent-a", "agent-b"],
      verifiers: [
        {
          verifierAgentId: "verifier-a",
          status: "failed",
        },
        {
          verifierAgentId: "verifier-b",
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
          code: "verifier_failed",
          failedVerifierAgentIds: ["verifier-a"],
        },
      ],
    });
  });

  it("resolves a canonical agent id from the raw preferred candidate when needed", () => {
    const decision = deriveVerifierSelectionDecision({
      canonicalAgentIds: ["agent-a", "agent-b"],
      verifiers: [
        {
          verifierAgentId: "verifier-a",
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
  it("resolves a blinded selector when every matching verification agrees", () => {
    const decision = deriveSelectorSelectionDecision({
      selector: "v_aaaaaaaaaa",
      canonicalAgentIds: ["agent-a", "agent-b"],
      sources: [
        {
          sourceId: "verify-1",
          aliasMap: { v_aaaaaaaaaa: "agent-b" },
        },
        {
          sourceId: "verify-2",
          aliasMap: { v_aaaaaaaaaa: "agent-b" },
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
