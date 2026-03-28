import type { TerminalColor } from "../../utils/colors.js";
import { colorize } from "../../utils/colors.js";
import { formatAlertMessage } from "../../utils/output.js";
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

export function buildTranscriptDetailBodyRows(
  rows: readonly TranscriptDetailRow[],
  options: {
    maxWidth?: number;
  } = {},
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
    const continuationPrefix = " ".repeat(prefix.length);
    const wrapWidth =
      typeof options.maxWidth === "number"
        ? Math.max(8, options.maxWidth - prefix.length)
        : undefined;

    const wrappedValueLines =
      wrapWidth === undefined
        ? [value]
        : wrapValueForDetailRow(value, wrapWidth);

    bodyLines.push(`${prefix}${wrappedValueLines[0] ?? ""}`.trimEnd());
    for (const line of wrappedValueLines.slice(1)) {
      bodyLines.push(`${continuationPrefix}${line}`.trimEnd());
    }
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

  const maxWidth =
    style.isTty && typeof style.columns === "number" && style.columns > 0
      ? style.columns
      : undefined;
  const detailBody = buildTranscriptDetailBodyRows(options.detailRows ?? [], {
    maxWidth,
  });
  if (detailBody.length > 0) {
    lines.push("", ...detailBody);
  }

  return lines;
}

function wrapValueForDetailRow(value: string, maxWidth: number): string[] {
  if (value.length <= maxWidth) {
    return [value];
  }

  const lines: string[] = [];
  let remaining = value;

  while (remaining.length > maxWidth) {
    const candidate = remaining.slice(0, maxWidth);
    const breakIndex = findPreferredBreakIndex(candidate);
    const splitIndex = breakIndex > 0 ? breakIndex : maxWidth;

    lines.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.length > 0) {
    lines.push(remaining);
  }

  return lines.length > 0 ? lines : [""];
}

function findPreferredBreakIndex(candidate: string): number {
  const minimumUsefulBreak = Math.floor(candidate.length * 0.6);

  for (let index = candidate.length - 1; index >= 0; index -= 1) {
    const char = candidate[index];
    if (char === " " || char === "/" || char === "\\") {
      if (index + 1 >= minimumUsefulBreak) {
        return index + 1;
      }
      break;
    }
  }

  return -1;
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
