import type { ListJsonTargetRef } from "../contracts/list.js";

const TARGET_SEPARATOR = ":";
const TARGET_ELISION = "...";

export const TARGET_TABLE_PREVIEW_LENGTH = 32;

export function formatTargetDisplay(target: ListJsonTargetRef): string {
  if (target.kind === "file") {
    return `file:${target.path}`;
  }

  if (target.agentId) {
    return `${target.kind}:${target.sessionId}:${target.agentId}`;
  }

  return `${target.kind}:${target.sessionId}`;
}

export function formatTargetTablePreview(
  target: ListJsonTargetRef,
  maxLength: number = TARGET_TABLE_PREVIEW_LENGTH,
): string {
  const display = formatTargetDisplay(target);
  return middleElideTargetDisplay(display, maxLength);
}

function middleElideTargetDisplay(display: string, maxLength: number): string {
  if (display.length <= maxLength) {
    return display;
  }

  if (maxLength <= TARGET_ELISION.length) {
    return display.slice(0, maxLength);
  }

  const separatorIndex = display.indexOf(TARGET_SEPARATOR);
  const prefixLength = separatorIndex >= 0 ? separatorIndex + 1 : 0;
  const prefix = display.slice(0, prefixLength);
  const suffixSource = display.slice(prefixLength);
  const availableSuffixLength =
    maxLength - prefix.length - TARGET_ELISION.length;

  if (availableSuffixLength <= 0) {
    const prefixBudget = Math.max(0, maxLength - TARGET_ELISION.length);
    return `${display.slice(0, prefixBudget)}${TARGET_ELISION}`;
  }

  const suffix = suffixSource.slice(-availableSuffixLength);
  return `${prefix}${TARGET_ELISION}${suffix}`;
}
