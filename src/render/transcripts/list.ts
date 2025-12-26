import type { RunRecord } from "../../runs/records/types.js";
import { formatRunTimestamp } from "../utils/records.js";
import { renderTable } from "../utils/table.js";
import { renderTranscript } from "../utils/transcript.js";

export function renderRunList(records: readonly RunRecord[]): string {
  const rows = records.map((record) => ({
    run: record.runId,
    status: record.status.toUpperCase(),
    spec: record.spec.path,
    created: formatRunTimestamp(record.createdAt),
  }));

  const columns: {
    header: string;
    accessor: (row: (typeof rows)[number]) => string;
  }[] = [
    { header: "RUN", accessor: (row: (typeof rows)[number]) => row.run },
    {
      header: "STATUS",
      accessor: (row: (typeof rows)[number]) => row.status,
    },
    { header: "SPEC", accessor: (row: (typeof rows)[number]) => row.spec },
    {
      header: "CREATED",
      accessor: (row: (typeof rows)[number]) => row.created,
    },
  ];

  const lines = renderTable({
    columns,
    rows,
  });

  return lines.join("\n");
}

export function renderListTranscript(records: readonly RunRecord[]): string {
  if (records.length === 0) {
    return "";
  }

  const tableOutput = renderRunList(records);
  const sections: string[][] = [];

  if (tableOutput.trim().length > 0) {
    sections.push(tableOutput.split("\n"));
  }

  return renderTranscript({
    sections,
    hint: {
      message:
        "To review a run in more detail:\n  voratiq review --run <run-id>",
    },
  });
}
