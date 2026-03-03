import { getRunStatusStyle } from "../../status/colors.js";
import type { RunStatus } from "../../status/index.js";
import type { TranscriptShellStyleOptions } from "./transcript-shell.js";
import { buildTranscriptShellSection } from "./transcript-shell.js";

export interface RunDisplayInfo {
  runId: string;
  status?: RunStatus;
  specPath?: string;
  workspacePath?: string;
  elapsed?: string;
  createdAt?: string;
  baseRevisionSha?: string;
  outcome?: string;
}

type RunMetadataRow = {
  label: string;
  value: string;
};

export function getRunMetadata(info: RunDisplayInfo): RunMetadataRow[] {
  const detailRows = [
    { label: "Outcome", value: info.outcome },
    { label: "Elapsed", value: info.elapsed },
    { label: "Created", value: info.createdAt },
    { label: "Spec", value: info.specPath },
    { label: "Workspace", value: info.workspacePath },
    {
      label: "Base Revision",
      value: info.baseRevisionSha
        ? info.baseRevisionSha.slice(0, 8)
        : undefined,
    },
  ];

  return detailRows.filter(
    (row): row is RunMetadataRow =>
      typeof row.value === "string" && row.value.length > 0,
  );
}

export function buildRunMetadataSectionWithStyle(
  info: RunDisplayInfo,
  style: TranscriptShellStyleOptions = {},
): string[] {
  const detailRows = getRunMetadata(info);

  return buildTranscriptShellSection({
    badgeText: info.runId,
    badgeVariant: "run",
    status: info.status
      ? {
          value: info.status,
          color: getRunStatusStyle(info.status).cli,
        }
      : undefined,
    detailRows,
    style,
  });
}
