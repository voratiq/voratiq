export interface VerifierAgreementSelection {
  verifierAgentId: string;
  selectedCanonicalAgentId: string;
}

export interface SelectorResolutionMatch {
  sourceId: string;
  selectedCanonicalAgentId: string;
}

export type SelectionDecisionUnresolvedReason =
  | {
      code: "no_successful_verifiers";
      failedVerifierAgentIds: readonly string[];
    }
  | {
      code: "verifier_failed";
      failedVerifierAgentIds: readonly string[];
    }
  | {
      code: "verifier_preference_missing";
      verifierAgentId: string;
    }
  | {
      code: "verifier_preference_unresolved";
      verifierAgentId: string;
      preferredCandidateId?: string;
      resolvedPreferredCandidateId?: string;
    }
  | {
      code: "verifier_disagreement";
      selections: readonly VerifierAgreementSelection[];
    }
  | {
      code: "selector_unresolved";
      selector: string;
      availableCanonicalAgentIds: readonly string[];
      availableAliases: readonly string[];
    }
  | {
      code: "selector_ambiguous";
      selector: string;
      resolutions: readonly SelectorResolutionMatch[];
    }
  | {
      code: "no_programmatic_candidates_passed";
      candidateIds: readonly string[];
    }
  | {
      code: "multiple_programmatic_candidates_passed";
      eligibleCanonicalAgentIds: readonly string[];
    }
  | {
      code: "selected_candidate_failed_programmatic";
      selectedCanonicalAgentId: string;
      eligibleCanonicalAgentIds: readonly string[];
    };

export interface ResolvableSelectionDecision {
  state: "resolvable";
  applyable: true;
  selectedCanonicalAgentId: string;
  unresolvedReasons: readonly [];
}

export interface UnresolvedSelectionDecision {
  state: "unresolved";
  applyable: false;
  unresolvedReasons: readonly SelectionDecisionUnresolvedReason[];
}

export type SelectionDecision =
  | ResolvableSelectionDecision
  | UnresolvedSelectionDecision;

export function buildResolvableSelectionDecision(
  selectedCanonicalAgentId: string,
): ResolvableSelectionDecision {
  return {
    state: "resolvable",
    applyable: true,
    selectedCanonicalAgentId,
    unresolvedReasons: [],
  };
}

export function buildUnresolvedSelectionDecision(
  unresolvedReasons: readonly SelectionDecisionUnresolvedReason[],
): UnresolvedSelectionDecision {
  return {
    state: "unresolved",
    applyable: false,
    unresolvedReasons,
  };
}
