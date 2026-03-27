import type { SelectionDecision } from "./result.js";

export interface AutoVerificationSelectionProceed {
  kind: "proceed";
}

export interface AutoVerificationSelectionActionRequired {
  kind: "action_required";
  detail: string;
}

export interface AutoVerificationSelectionNonBlocking {
  kind: "non_blocking";
  verifyDetail: string;
  applyDetail: string;
}

export type AutoVerificationSelectionDisposition =
  | AutoVerificationSelectionProceed
  | AutoVerificationSelectionActionRequired
  | AutoVerificationSelectionNonBlocking;

export function classifyAutoVerificationSelection(options: {
  targetKind: "spec" | "run";
  selection?: SelectionDecision;
}): AutoVerificationSelectionDisposition {
  const { targetKind, selection } = options;

  if (selection?.state === "resolvable") {
    return { kind: "proceed" };
  }

  if (isNonBlockingProgrammaticFailure({ targetKind, selection })) {
    return {
      kind: "non_blocking",
      verifyDetail: "No run candidate passed programmatic verification.",
      applyDetail:
        "Skipped apply because no run candidate passed programmatic verification.",
    };
  }

  return {
    kind: "action_required",
    detail: describeActionRequiredSelection({ targetKind, selection }),
  };
}

function describeActionRequiredSelection(options: {
  targetKind: "spec" | "run";
  selection?: SelectionDecision;
}): string {
  const { targetKind, selection } = options;

  if (
    selection?.state === "unresolved" &&
    selection.unresolvedReasons.some(
      (reason) => reason.code === "verifier_disagreement",
    )
  ) {
    return targetKind === "spec"
      ? "Verifiers disagreed on the preferred draft; manual selection required."
      : "Verifiers disagreed on the preferred candidate; manual selection required.";
  }

  return targetKind === "spec"
    ? "Verification did not select a draft; manual selection required."
    : "Verification did not produce a resolvable candidate; manual selection required.";
}

function isNonBlockingProgrammaticFailure(options: {
  targetKind: "spec" | "run";
  selection?: SelectionDecision;
}): boolean {
  const { targetKind, selection } = options;

  return (
    targetKind === "run" &&
    selection?.state === "unresolved" &&
    selection.unresolvedReasons.length > 0 &&
    selection.unresolvedReasons.every(
      (reason) => reason.code === "no_programmatic_candidates_passed",
    )
  );
}
