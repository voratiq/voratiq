import type { SelectionDecision } from "./result.js";

const UNRESOLVED_VERIFICATION_MESSAGE =
  "Verification did not produce a resolvable candidate; manual review required.";

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
  selection?: SelectionDecision;
}): AutoVerificationSelectionDisposition {
  const { selection } = options;

  if (selection?.state === "resolvable") {
    return { kind: "proceed" };
  }

  return {
    kind: "action_required",
    detail: UNRESOLVED_VERIFICATION_MESSAGE,
  };
}
