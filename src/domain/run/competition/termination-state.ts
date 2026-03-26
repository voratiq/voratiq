import type { RunStatus } from "../../../status/index.js";

export const RUN_ABORT_WARNING = "Run aborted before agent completed.";

const activeTerminationStatuses = new Map<string, RunStatus>();

export function setActiveTerminationStatus(
  runId: string,
  status: RunStatus | undefined,
): void {
  if (status === undefined) {
    activeTerminationStatuses.delete(runId);
    return;
  }
  activeTerminationStatuses.set(runId, status);
}

export function getActiveTerminationStatus(
  runId: string,
): RunStatus | undefined {
  return activeTerminationStatuses.get(runId);
}
