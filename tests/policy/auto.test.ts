import { classifyAutoVerificationSelection } from "../../src/policy/index.js";

describe("policy auto verification selection", () => {
  it("requires action with the canonical message when spec verifiers disagree", () => {
    const disposition = classifyAutoVerificationSelection({
      selection: {
        state: "unresolved",
        applyable: false,
        unresolvedReasons: [
          {
            code: "verifier_disagreement",
            selections: [
              {
                verifierAgentId: "verifier-a",
                selectedCanonicalAgentId: "alpha",
              },
              {
                verifierAgentId: "verifier-b",
                selectedCanonicalAgentId: "beta",
              },
            ],
          },
        ],
      },
    });

    expect(disposition).toEqual({
      kind: "action_required",
      detail:
        "Verification did not produce a resolvable candidate; manual review required.",
    });
  });

  it("treats run programmatic-only failure as action required with the canonical message", () => {
    const disposition = classifyAutoVerificationSelection({
      selection: {
        state: "unresolved",
        applyable: false,
        unresolvedReasons: [
          {
            code: "no_successful_verifiers",
            failedVerifierAgentIds: [],
          },
        ],
      },
    });

    expect(disposition).toEqual({
      kind: "action_required",
      detail:
        "Verification did not produce a resolvable candidate; manual review required.",
    });
  });

  it("proceeds when selection is resolvable", () => {
    const disposition = classifyAutoVerificationSelection({
      selection: {
        state: "resolvable",
        applyable: true,
        selectedCanonicalAgentId: "alpha",
        unresolvedReasons: [],
      },
    });

    expect(disposition).toEqual({ kind: "proceed" });
  });
});
