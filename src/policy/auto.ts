import type { SelectionDecision } from "./result.js";

export interface AutoVerificationSelectionProceed {
  kind: "proceed";
}

export interface AutoVerificationSelectionActionRequired {
  kind: "action_required";
  detail: string;
}

export type AutoVerificationSelectionDisposition =
  | AutoVerificationSelectionProceed
  | AutoVerificationSelectionActionRequired;

export function classifyAutoVerificationSelection(options: {
  targetKind: "spec" | "run";
  selection?: SelectionDecision;
}): AutoVerificationSelectionDisposition {
  const { targetKind, selection } = options;

  if (selection?.state === "resolvable") {
    return { kind: "proceed" };
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
