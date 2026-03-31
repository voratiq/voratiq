import type { TerminalColor } from "../../utils/colors.js";
import { colorize } from "../../utils/colors.js";
import { formatAlertMessage } from "../../utils/output.js";
import { formatRunTimestamp } from "./records.js";
import { renderTable } from "./table.js";

export interface TranscriptShellStyleOptions {
  isTty?: boolean;
  columns?: number;
}

export interface TranscriptShellStyle {
  isTty: boolean;
  columns?: number;
}

type TerminalLikeWriter = {
  isTTY?: boolean;
  columns?: number;
};

export function resolveTranscriptShellStyle(
  options: TranscriptShellStyleOptions = {},
): TranscriptShellStyle {
  return {
    isTty: options.isTty ?? Boolean(process.stdout.isTTY),
    columns: options.columns,
  };
}

export function resolveTranscriptShellStyleFromWriter(
  writer: TerminalLikeWriter,
  options: { forceTty?: boolean } = {},
): TranscriptShellStyleOptions {
  return {
    isTty: options.forceTty === true ? true : Boolean(writer.isTTY),
    columns: writer.columns,
  };
}

const ANSI_RESET = "\u001B[0m";
const ANSI_BOLD = "\u001B[1m";
const ESC = "\u001B[";

type AnsiCode = string;

interface BadgeStyle {
  foreground?: AnsiCode;
  background?: AnsiCode;
  bold?: boolean;
  padding?: number;
}

export type TranscriptBadgeVariant =
  | "run"
  | "verify"
  | "reduce"
  | "spec"
  | "agent";

const BRAND_COLOR = "164;203;153";
const VERIFY_COLOR = "255;238;140";
const REDUCE_COLOR = "226;159;115";
const SPEC_COLOR = "144;190;228";

const BADGE_STYLES: Record<TranscriptBadgeVariant, BadgeStyle> = {
  run: {
    foreground: `${ESC}38;2;0;0;0m`,
    background: `${ESC}48;2;${BRAND_COLOR}m`,
    bold: true,
  },
  verify: {
    foreground: `${ESC}38;2;0;0;0m`,
    background: `${ESC}48;2;${VERIFY_COLOR}m`,
    bold: true,
  },
  reduce: {
    foreground: `${ESC}38;2;0;0;0m`,
    background: `${ESC}48;2;${REDUCE_COLOR}m`,
    bold: true,
  },
  spec: {
    foreground: `${ESC}38;2;0;0;0m`,
    background: `${ESC}48;2;${SPEC_COLOR}m`,
    bold: true,
  },
  agent: {
    bold: true,
  },
};

function applyBadgeStyle(text: string, style: BadgeStyle): string {
  const padding = Math.max(0, style.padding ?? 0);
  const pad = padding === 0 ? "" : " ".repeat(padding);
  const padded = `${pad}${text}${pad}`;
  const parts: string[] = [];

  if (typeof style.background === "string" && style.background.length > 0) {
    parts.push(style.background);
  }

  if (typeof style.foreground === "string" && style.foreground.length > 0) {
    parts.push(style.foreground);
  }

  if (style.bold === true) {
    parts.push(ANSI_BOLD);
  }

  parts.push(padded, ANSI_RESET);
  return parts.join("");
}

export function formatTranscriptBadge(
  text: string,
  variant: TranscriptBadgeVariant,
  style: TranscriptShellStyle,
): string {
  if (!style.isTty) {
    return text;
  }

  return applyBadgeStyle(text, BADGE_STYLES[variant]);
}

export function formatTranscriptStatusLabel(
  status: string,
  color: TerminalColor,
  style: TranscriptShellStyle,
): string {
  const label = status.toUpperCase();
  return style.isTty ? colorize(label, color) : label;
}

export function formatTranscriptErrorLine(
  message: string,
  style: TranscriptShellStyle,
): string {
  if (!style.isTty) {
    return `Error: ${message}`;
  }

  return formatAlertMessage("Error", "red", message);
}

export type TranscriptDetailRow = {
  label: string;
  value: string;
};

export function buildStandardSessionDetailRows(options: {
  elapsed?: string;
  createdAt?: string;
  workspacePath?: string;
}): TranscriptDetailRow[] {
  const rows = [
    { label: "Elapsed", value: options.elapsed },
    {
      label: "Created",
      value: options.createdAt
        ? formatRunTimestamp(options.createdAt)
        : undefined,
    },
    { label: "Workspace", value: options.workspacePath },
  ];

  return rows.filter(
    (row): row is TranscriptDetailRow =>
      typeof row.value === "string" && row.value.length > 0,
  );
}

export function buildTranscriptDetailBodyRows(
  rows: readonly TranscriptDetailRow[],
): string[] {
  if (rows.length === 0) {
    return [];
  }

  const labelWidth = rows.reduce(
    (max, row) => Math.max(max, row.label.length),
    0,
  );

  const bodyLines: string[] = [];
  for (const row of rows) {
    const value = row.value ?? "—";
    const prefix = `${row.label.padEnd(labelWidth)}  `;
    bodyLines.push(`${prefix}${value}`.trimEnd());
  }

  return bodyLines;
}

export function buildTranscriptShellSection(options: {
  badgeText: string;
  badgeVariant: TranscriptBadgeVariant;
  status?: { value: string; color: TerminalColor };
  detailRows?: readonly TranscriptDetailRow[];
  style?: TranscriptShellStyleOptions;
}): string[] {
  const style = resolveTranscriptShellStyle(options.style);
  const lines: string[] = [];

  const badge = formatTranscriptBadge(
    options.badgeText,
    options.badgeVariant,
    style,
  );

  if (options.status) {
    const statusLabel = formatTranscriptStatusLabel(
      options.status.value,
      options.status.color,
      style,
    );
    lines.push(`${badge} ${statusLabel}`);
  } else {
    lines.push(badge);
  }

  const detailBody = buildTranscriptDetailBodyRows(options.detailRows ?? []);
  if (detailBody.length > 0) {
    lines.push("", ...detailBody);
  }

  return lines;
}

export function buildStandardSessionShellSection(options: {
  badgeText: string;
  badgeVariant: TranscriptBadgeVariant;
  status?: { value: string; color: TerminalColor };
  elapsed?: string;
  createdAt?: string;
  workspacePath?: string;
  style?: TranscriptShellStyleOptions;
}): string[] {
  return buildTranscriptShellSection({
    badgeText: options.badgeText,
    badgeVariant: options.badgeVariant,
    status: options.status,
    detailRows: buildStandardSessionDetailRows({
      elapsed: options.elapsed,
      createdAt: options.createdAt,
      workspacePath: options.workspacePath,
    }),
    style: options.style,
  });
}

export interface TranscriptStatusTableColumn<Row> {
  header: string;
  accessor: (row: Row) => string;
  align?: "left" | "right";
}

export function renderTranscriptStatusTable<Row>(options: {
  rows: readonly Row[];
  agent: (row: Row) => string;
  status: (row: Row) => string;
  duration: (row: Row) => string;
  extras?: readonly TranscriptStatusTableColumn<Row>[];
}): string[] {
  const extras = options.extras ?? [];

  return renderTable({
    columns: [
      { header: "AGENT", accessor: options.agent },
      { header: "STATUS", accessor: options.status },
      { header: "DURATION", accessor: options.duration },
      ...extras,
    ],
    rows: options.rows,
  });
}
