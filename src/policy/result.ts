export interface ReviewAgreementSelection {
  reviewerAgentId: string;
  selectedCanonicalAgentId: string;
}

export interface SelectorResolutionMatch {
  sourceId: string;
  selectedCanonicalAgentId: string;
}

export type SelectionDecisionUnresolvedReason =
  | {
      code: "no_successful_reviewers";
      failedReviewerAgentIds: readonly string[];
    }
  | {
      code: "reviewer_failed";
      failedReviewerAgentIds: readonly string[];
    }
  | {
      code: "reviewer_preference_missing";
      reviewerAgentId: string;
    }
  | {
      code: "reviewer_preference_unresolved";
      reviewerAgentId: string;
      preferredCandidateId?: string;
      resolvedPreferredCandidateId?: string;
    }
  | {
      code: "reviewer_disagreement";
      selections: readonly ReviewAgreementSelection[];
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
