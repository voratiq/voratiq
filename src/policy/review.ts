import {
  normalizeCandidateSelector,
  resolveCanonicalAgentId,
} from "./resolution.js";
import {
  buildResolvableSelectionDecision,
  buildUnresolvedSelectionDecision,
  type ReviewAgreementSelection,
  type SelectionDecision,
  type SelectionDecisionUnresolvedReason,
} from "./result.js";

export interface ReviewSelectionReviewerInput {
  reviewerAgentId: string;
  status: "succeeded" | "failed";
  preferredCandidateId?: string;
  resolvedPreferredCandidateId?: string;
}

export interface ReviewSelectionInput {
  canonicalAgentIds: readonly string[];
  aliasMap?: Readonly<Record<string, string>>;
  reviewers: readonly ReviewSelectionReviewerInput[];
}

export function deriveReviewSelectionDecision(
  input: ReviewSelectionInput,
): SelectionDecision {
  const failedReviewerAgentIds = input.reviewers
    .filter((reviewer) => reviewer.status === "failed")
    .map((reviewer) => reviewer.reviewerAgentId);

  const successfulReviewers = input.reviewers.filter(
    (
      reviewer,
    ): reviewer is ReviewSelectionReviewerInput & { status: "succeeded" } =>
      reviewer.status === "succeeded",
  );

  if (successfulReviewers.length === 0) {
    return buildUnresolvedSelectionDecision([
      {
        code: "no_successful_reviewers",
        failedReviewerAgentIds,
      },
    ]);
  }

  if (failedReviewerAgentIds.length > 0) {
    return buildUnresolvedSelectionDecision([
      {
        code: "reviewer_failed",
        failedReviewerAgentIds,
      },
    ]);
  }

  const unresolvedReasons: SelectionDecisionUnresolvedReason[] = [];
  const resolvedSelections: ReviewAgreementSelection[] = [];

  for (const reviewer of successfulReviewers) {
    const selectedCanonicalAgentId = resolveCanonicalAgentId({
      selectors: [
        reviewer.resolvedPreferredCandidateId,
        reviewer.preferredCandidateId,
      ],
      canonicalAgentIds: input.canonicalAgentIds,
      aliasMap: input.aliasMap,
    });

    if (selectedCanonicalAgentId) {
      resolvedSelections.push({
        reviewerAgentId: reviewer.reviewerAgentId,
        selectedCanonicalAgentId,
      });
      continue;
    }

    const preferredCandidateId = normalizeCandidateSelector(
      reviewer.preferredCandidateId,
    );
    const resolvedPreferredCandidateId = normalizeCandidateSelector(
      reviewer.resolvedPreferredCandidateId,
    );

    if (!preferredCandidateId && !resolvedPreferredCandidateId) {
      unresolvedReasons.push({
        code: "reviewer_preference_missing",
        reviewerAgentId: reviewer.reviewerAgentId,
      });
      continue;
    }

    unresolvedReasons.push({
      code: "reviewer_preference_unresolved",
      reviewerAgentId: reviewer.reviewerAgentId,
      ...(preferredCandidateId ? { preferredCandidateId } : {}),
      ...(resolvedPreferredCandidateId ? { resolvedPreferredCandidateId } : {}),
    });
  }

  const distinctSelections = new Set(
    resolvedSelections.map((selection) => selection.selectedCanonicalAgentId),
  );
  if (distinctSelections.size > 1) {
    unresolvedReasons.push({
      code: "reviewer_disagreement",
      selections: resolvedSelections,
    });
  }

  if (unresolvedReasons.length > 0) {
    return buildUnresolvedSelectionDecision(unresolvedReasons);
  }

  const selectedCanonicalAgentId =
    resolvedSelections[0]?.selectedCanonicalAgentId;
  if (!selectedCanonicalAgentId) {
    return buildUnresolvedSelectionDecision([
      {
        code: "no_successful_reviewers",
        failedReviewerAgentIds,
      },
    ]);
  }

  return buildResolvableSelectionDecision(selectedCanonicalAgentId);
}
