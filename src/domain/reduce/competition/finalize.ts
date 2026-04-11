import type { ReductionRecord } from "../model/types.js";

/**
 * Derive the reduction session status from per-reducer outcomes.
 * Returns "succeeded" when at least one reducer succeeds, "aborted" when all
 * terminal reducers aborted, and "failed" otherwise.
 */
export function deriveReductionStatusFromReducers(
  reducers: readonly Pick<ReductionRecord["reducers"][number], "status">[],
): ReductionRecord["status"] {
  const terminalReducers = reducers.filter(
    (reducer) =>
      reducer.status === "succeeded" ||
      reducer.status === "failed" ||
      reducer.status === "aborted",
  );
  const hasSucceeded = terminalReducers.some(
    (reducer) => reducer.status === "succeeded",
  );
  if (hasSucceeded) {
    return "succeeded";
  }

  if (
    terminalReducers.length > 0 &&
    terminalReducers.every((reducer) => reducer.status === "aborted")
  ) {
    return "aborted";
  }

  return "failed";
}
