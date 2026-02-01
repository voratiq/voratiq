import { getRunStatusStyle } from "../../status/colors.js";
import type { RunStatus } from "../../status/index.js";
import { colorize } from "../../utils/colors.js";
import { formatRunBadge } from "./badges.js";
import { renderTable } from "./table.js";

export interface RunDisplayInfo {
  runId: string;
  status?: RunStatus;
  specPath?: string;
  workspacePath?: string;
  elapsed?: string;
  createdAt?: string;
  baseRevisionSha?: string;
}

type RunMetadataRow = {
  label: string;
  value: string;
};

export function getRunMetadata(info: RunDisplayInfo): RunMetadataRow[] {
  const detailRows = [
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

export function buildRunMetadataSection(info: RunDisplayInfo): string[] {
  const lines: string[] = [];
  const badge = formatRunBadge(info.runId);
  if (info.status) {
    const statusStyle = getRunStatusStyle(info.status);
    lines.push(
      `${badge} ${colorize(info.status.toUpperCase(), statusStyle.cli)}`,
    );
  } else {
    lines.push(badge);
  }

  const detailRows = getRunMetadata(info);

  if (detailRows.length > 0) {
    const tableLines = renderTable({
      columns: [
        {
          header: "FIELD",
          accessor: (row: (typeof detailRows)[number]) => row.label,
        },
        {
          header: "VALUE",
          accessor: (row: (typeof detailRows)[number]) => row.value ?? "—",
        },
      ],
      rows: detailRows,
    });

    const [, ...bodyLines] = tableLines;
    if (bodyLines.length > 0) {
      lines.push("", ...bodyLines);
    }
  }

  return lines;
}
