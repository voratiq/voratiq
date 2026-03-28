import type { RunRecord } from "../../domain/run/model/types.js";
import { formatRunTimestamp } from "../utils/records.js";
import { renderTable } from "../utils/table.js";
import { renderTranscript } from "../utils/transcript.js";

interface ListRenderOptions {
  isTty?: boolean;
  columns?: number;
}

const COLUMN_GAP = "  ";
const MIN_SPEC_WIDTH = 24;
const MIN_WRAP_WIDTH = 10;
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function renderRunList(
  records: readonly RunRecord[],
  options: ListRenderOptions = {},
): string {
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

  const isTty = options.isTty ?? Boolean(process.stdout.isTTY);
  const columnsWidth = options.columns ?? process.stdout.columns;

  const lines =
    isTty && typeof columnsWidth === "number" && columnsWidth > 0
      ? renderWrappedRunTable(rows, columnsWidth)
      : renderTable({ columns, rows });

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

  return renderTranscript({ sections });
}

function renderWrappedRunTable(
  rows: ReadonlyArray<{
    run: string;
    status: string;
    spec: string;
    created: string;
  }>,
  terminalColumns: number,
): string[] {
  const runWidth = Math.max("RUN".length, ...rows.map((row) => row.run.length));
  const statusWidth = Math.max(
    "STATUS".length,
    ...rows.map((row) => row.status.length),
  );
  const createdWidth = Math.max(
    "CREATED".length,
    ...rows.map((row) => row.created.length),
  );
  const fixedWidth =
    runWidth + statusWidth + createdWidth + COLUMN_GAP.length * 3;
  const remaining = terminalColumns - fixedWidth;
  const specWidth = Math.max(
    MIN_WRAP_WIDTH,
    Math.min(Math.max("SPEC".length, MIN_SPEC_WIDTH), remaining),
  );

  if (
    specWidth <= MIN_WRAP_WIDTH ||
    terminalColumns < fixedWidth + MIN_WRAP_WIDTH
  ) {
    return renderTable({
      columns: [
        { header: "RUN", accessor: (row) => row.run },
        { header: "STATUS", accessor: (row) => row.status },
        { header: "SPEC", accessor: (row) => row.spec },
        { header: "CREATED", accessor: (row) => row.created },
      ],
      rows,
    });
  }

  const lines: string[] = [
    [
      padVisible("RUN", runWidth),
      padVisible("STATUS", statusWidth),
      padVisible("SPEC", specWidth),
      padVisible("CREATED", createdWidth),
    ].join(COLUMN_GAP),
  ];

  for (const row of rows) {
    const runLines = wrapForColumn(row.run, runWidth);
    const statusLines = wrapForColumn(row.status, statusWidth);
    const specLines = wrapForColumn(row.spec, specWidth);
    const createdLines = wrapForColumn(row.created, createdWidth);
    const rowHeight = Math.max(
      runLines.length,
      statusLines.length,
      specLines.length,
      createdLines.length,
    );

    for (let index = 0; index < rowHeight; index += 1) {
      lines.push(
        [
          padVisible(runLines[index] ?? "", runWidth),
          padVisible(statusLines[index] ?? "", statusWidth),
          padVisible(specLines[index] ?? "", specWidth),
          padVisible(createdLines[index] ?? "", createdWidth),
        ].join(COLUMN_GAP),
      );
    }
  }

  return lines;
}

function wrapForColumn(value: string, width: number): string[] {
  if (visibleLength(value) <= width) {
    return [value];
  }

  const lines: string[] = [];
  let remaining = value;
  while (visibleLength(remaining) > width) {
    const chunk = remaining.slice(0, width);
    const splitIndex = findWrapSplit(chunk);
    lines.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }
  lines.push(remaining);
  return lines;
}

function findWrapSplit(chunk: string): number {
  const minimumUsefulBreak = Math.floor(chunk.length * 0.6);

  for (let index = chunk.length - 1; index >= 0; index -= 1) {
    const char = chunk[index];
    if (char === " " || char === "/" || char === "\\") {
      if (index + 1 >= minimumUsefulBreak) {
        return index + 1;
      }
      break;
    }
  }

  return chunk.length;
}

function visibleLength(value: string): number {
  return value.replace(ANSI_PATTERN, "").length;
}

function padVisible(value: string, width: number): string {
  const length = visibleLength(value);
  if (length >= width) {
    return value;
  }

  return value + " ".repeat(width - length);
}
