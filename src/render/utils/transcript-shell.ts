import type { TerminalColor } from "../../utils/colors.js";
import { colorize } from "../../utils/colors.js";
import { formatAlertMessage } from "../../utils/output.js";
import { renderTable } from "./table.js";

export interface TranscriptShellStyleOptions {
  isTty?: boolean;
}

export interface TranscriptShellStyle {
  isTty: boolean;
}

export function resolveTranscriptShellStyle(
  options: TranscriptShellStyleOptions = {},
): TranscriptShellStyle {
  return {
    isTty: options.isTty ?? Boolean(process.stdout.isTTY),
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

export type TranscriptBadgeVariant = "run" | "review" | "reduce" | "agent";

const BRAND_COLOR = "164;203;153";
const REVIEW_COLOR = "255;238;140";
const REDUCE_COLOR = "226;159;115";

const BADGE_STYLES: Record<TranscriptBadgeVariant, BadgeStyle> = {
  run: {
    foreground: `${ESC}38;2;0;0;0m`,
    background: `${ESC}48;2;${BRAND_COLOR}m`,
    bold: true,
  },
  review: {
    foreground: `${ESC}38;2;0;0;0m`,
    background: `${ESC}48;2;${REVIEW_COLOR}m`,
    bold: true,
  },
  reduce: {
    foreground: `${ESC}38;2;0;0;0m`,
    background: `${ESC}48;2;${REDUCE_COLOR}m`,
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

export function buildTranscriptDetailBodyRows(
  rows: readonly TranscriptDetailRow[],
): string[] {
  if (rows.length === 0) {
    return [];
  }

  const tableLines = renderTable({
    columns: [
      {
        header: "FIELD",
        accessor: (row: TranscriptDetailRow) => row.label,
      },
      {
        header: "VALUE",
        accessor: (row: TranscriptDetailRow) => row.value ?? "—",
      },
    ],
    rows,
  });

  const [, ...bodyLines] = tableLines;
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
