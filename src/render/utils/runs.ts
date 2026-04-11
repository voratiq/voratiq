import { getRunStatusStyle } from "../../status/colors.js";
import type { RunStatus } from "../../status/index.js";
import type { TranscriptShellStyleOptions } from "./transcript-shell.js";
import { buildStandardSessionShellSection } from "./transcript-shell.js";

export interface RunDisplayInfo {
  runId: string;
  status?: RunStatus;
  workspacePath?: string;
  elapsed?: string;
  createdAt?: string;
  targetDisplay?: string;
}

export function buildRunMetadataSectionWithStyle(
  info: RunDisplayInfo,
  style: TranscriptShellStyleOptions = {},
): string[] {
  return buildStandardSessionShellSection({
    badgeText: info.runId,
    badgeVariant: "run",
    status: info.status
      ? {
          value: info.status,
          color: getRunStatusStyle(info.status).cli,
        }
      : undefined,
    elapsed: info.elapsed,
    createdAt: info.createdAt,
    workspacePath: info.workspacePath,
    targetDisplay: info.targetDisplay,
    style,
  });
}
