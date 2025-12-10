const ANSI_RESET = "\u001B[0m";
const ANSI_BOLD = "\u001B[1m";

type AnsiCode = string;

export interface BadgeStyle {
  foreground?: AnsiCode;
  background?: AnsiCode;
  bold?: boolean;
  padding?: number;
}

const ESC = "\u001B[";

const BRAND_COLOR = "164;203;153";

export const BADGE_STYLES = {
  run: {
    foreground: `${ESC}38;2;0;0;0m`,
    background: `${ESC}48;2;${BRAND_COLOR}m`,
    bold: true,
  },
  agent: {
    bold: true,
  },
} as const satisfies Record<string, BadgeStyle>;

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

export function formatRunBadge(text: string): string {
  return applyBadgeStyle(text, BADGE_STYLES.run);
}

export function formatAgentBadge(text: string): string {
  return applyBadgeStyle(text, BADGE_STYLES.agent);
}
