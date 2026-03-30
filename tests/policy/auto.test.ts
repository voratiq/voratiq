import { classifyAutoVerificationSelection } from "../../src/policy/index.js";

describe("policy auto verification selection", () => {
  it("requires action when spec verifiers disagree", () => {
    const disposition = classifyAutoVerificationSelection({
      targetKind: "spec",
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
        "Verifiers disagreed on the preferred draft; manual selection required.",
    });
  });

  it("treats run programmatic-only failure as action required", () => {
    const disposition = classifyAutoVerificationSelection({
      targetKind: "run",
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
        "Verification did not produce a resolvable candidate; manual selection required.",
    });
  });

  it("proceeds when selection is resolvable", () => {
    const disposition = classifyAutoVerificationSelection({
      targetKind: "run",
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
