import {
  normalizeCandidateSelector,
  resolveCanonicalAgentId,
} from "./resolution.js";
import {
  buildResolvableSelectionDecision,
  buildUnresolvedSelectionDecision,
  type SelectionDecision,
  type SelectionDecisionUnresolvedReason,
  type VerifierAgreementSelection,
} from "./result.js";

export interface VerifierSelectionReviewerInput {
  verifierAgentId: string;
  status: "succeeded" | "failed";
  preferredCandidateId?: string;
  resolvedPreferredCandidateId?: string;
}

export interface VerifierSelectionInput {
  canonicalAgentIds: readonly string[];
  aliasMap?: Readonly<Record<string, string>>;
  verifiers: readonly VerifierSelectionReviewerInput[];
}

export function deriveVerifierSelectionDecision(
  input: VerifierSelectionInput,
): SelectionDecision {
  const failedVerifierAgentIds = input.verifiers
    .filter((verifier) => verifier.status === "failed")
    .map((verifier) => verifier.verifierAgentId);

  const successfulVerifiers = input.verifiers.filter(
    (
      verifier,
    ): verifier is VerifierSelectionReviewerInput & { status: "succeeded" } =>
      verifier.status === "succeeded",
  );

  if (successfulVerifiers.length === 0) {
    return buildUnresolvedSelectionDecision([
      {
        code: "no_successful_verifiers",
        failedVerifierAgentIds,
      },
    ]);
  }

  if (failedVerifierAgentIds.length > 0) {
    return buildUnresolvedSelectionDecision([
      {
        code: "verifier_failed",
        failedVerifierAgentIds,
      },
    ]);
  }

  const unresolvedReasons: SelectionDecisionUnresolvedReason[] = [];
  const resolvedSelections: VerifierAgreementSelection[] = [];

  for (const verifier of successfulVerifiers) {
    const selectedCanonicalAgentId = resolveCanonicalAgentId({
      selectors: [
        verifier.resolvedPreferredCandidateId,
        verifier.preferredCandidateId,
      ],
      canonicalAgentIds: input.canonicalAgentIds,
      aliasMap: input.aliasMap,
    });

    if (selectedCanonicalAgentId) {
      resolvedSelections.push({
        verifierAgentId: verifier.verifierAgentId,
        selectedCanonicalAgentId,
      });
      continue;
    }

    const preferredCandidateId = normalizeCandidateSelector(
      verifier.preferredCandidateId,
    );
    const resolvedPreferredCandidateId = normalizeCandidateSelector(
      verifier.resolvedPreferredCandidateId,
    );

    if (!preferredCandidateId && !resolvedPreferredCandidateId) {
      unresolvedReasons.push({
        code: "verifier_preference_missing",
        verifierAgentId: verifier.verifierAgentId,
      });
      continue;
    }

    unresolvedReasons.push({
      code: "verifier_preference_unresolved",
      verifierAgentId: verifier.verifierAgentId,
      ...(preferredCandidateId ? { preferredCandidateId } : {}),
      ...(resolvedPreferredCandidateId ? { resolvedPreferredCandidateId } : {}),
    });
  }

  const distinctSelections = new Set(
    resolvedSelections.map((selection) => selection.selectedCanonicalAgentId),
  );
  if (distinctSelections.size > 1) {
    unresolvedReasons.push({
      code: "verifier_disagreement",
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
        code: "no_successful_verifiers",
        failedVerifierAgentIds,
      },
    ]);
  }

  return buildResolvableSelectionDecision(selectedCanonicalAgentId);
}
