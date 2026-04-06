import type { MessageRecord } from "../../domain/message/model/types.js";
import type { ReductionRecord } from "../../domain/reduce/model/types.js";
import type { RunRecord } from "../../domain/run/model/types.js";
import type { SpecRecord } from "../../domain/spec/model/types.js";
import type { VerificationRecord } from "../../domain/verify/model/types.js";
import { formatRunTimestamp } from "../utils/records.js";
import { renderTable } from "../utils/table.js";
import { renderTranscript } from "../utils/transcript.js";

const DASH = "—";
const SPEC_DESCRIPTION_PREVIEW_LENGTH = 32;
const MESSAGE_PROMPT_PREVIEW_LENGTH = 32;

export function renderRunList(records: readonly RunRecord[]): string {
  const rows = records.map((record) => ({
    run: record.runId,
    spec: record.spec.path,
    status: record.status.toUpperCase(),
    created: formatRunTimestamp(record.createdAt),
  }));

  const columns: {
    header: string;
    accessor: (row: (typeof rows)[number]) => string;
  }[] = [
    { header: "RUN", accessor: (row: (typeof rows)[number]) => row.run },
    { header: "SPEC", accessor: (row: (typeof rows)[number]) => row.spec },
    {
      header: "STATUS",
      accessor: (row: (typeof rows)[number]) => row.status,
    },
    {
      header: "CREATED",
      accessor: (row: (typeof rows)[number]) => row.created,
    },
  ];

  return renderTable({ columns, rows }).join("\n");
}

export function renderListTranscript(records: readonly RunRecord[]): string {
  if (records.length === 0) {
    return "";
  }

  const tableOutput = renderRunList(records);
  return renderListTableTranscript(tableOutput);
}

export function renderSpecList(records: readonly SpecRecord[]): string {
  return renderTable({
    columns: [
      {
        header: "SPEC",
        accessor: (record) => record.sessionId,
      },
      {
        header: "DESCRIPTION",
        accessor: (record) =>
          truncatePreview(record.description, SPEC_DESCRIPTION_PREVIEW_LENGTH),
      },
      {
        header: "STATUS",
        accessor: (record) => record.status.toUpperCase(),
      },
      {
        header: "CREATED",
        accessor: (record) => formatRunTimestamp(record.createdAt),
      },
    ],
    rows: records,
  }).join("\n");
}

export function renderReduceList(records: readonly ReductionRecord[]): string {
  return renderTable({
    columns: [
      {
        header: "REDUCE",
        accessor: (record) => record.sessionId,
      },
      {
        header: "TARGET",
        accessor: (record) => `${record.target.type}:${record.target.id}`,
      },
      {
        header: "STATUS",
        accessor: (record) => record.status.toUpperCase(),
      },
      {
        header: "CREATED",
        accessor: (record) => formatRunTimestamp(record.createdAt),
      },
    ],
    rows: records,
  }).join("\n");
}

export function renderMessageList(records: readonly MessageRecord[]): string {
  return renderTable({
    columns: [
      {
        header: "MESSAGE",
        accessor: (record) => record.sessionId,
      },
      {
        header: "PROMPT",
        accessor: (record) =>
          truncatePreview(record.prompt, MESSAGE_PROMPT_PREVIEW_LENGTH),
      },
      {
        header: "STATUS",
        accessor: (record) => record.status.toUpperCase(),
      },
      {
        header: "CREATED",
        accessor: (record) => formatRunTimestamp(record.createdAt),
      },
    ],
    rows: records,
  }).join("\n");
}

export function renderVerifyList(
  records: readonly VerificationRecord[],
): string {
  return renderTable({
    columns: [
      {
        header: "VERIFY",
        accessor: (record) => record.sessionId,
      },
      {
        header: "TARGET",
        accessor: (record) =>
          `${record.target.kind}:${record.target.sessionId}`,
      },
      {
        header: "STATUS",
        accessor: (record) => record.status.toUpperCase(),
      },
      {
        header: "CREATED",
        accessor: (record) => formatRunTimestamp(record.createdAt),
      },
    ],
    rows: records,
  }).join("\n");
}

export function renderListTableTranscript(tableOutput: string): string {
  if (tableOutput.trim().length === 0) {
    return "";
  }

  const sections: string[][] = [];

  sections.push(tableOutput.split("\n"));

  return renderTranscript({ sections });
}

function truncatePreview(
  value: string | null | undefined,
  maxLength: number,
): string {
  if (!value) {
    return DASH;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return DASH;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  if (maxLength <= 3) {
    return normalized.slice(0, maxLength);
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}
