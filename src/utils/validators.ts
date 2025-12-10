import { ValidationError } from "./errors.js";

export function parsePositiveInteger(
  value: unknown,
  invalidMessage: string,
  nonPositiveMessage?: string,
): number {
  if (typeof value !== "string") {
    throw new ValidationError(invalidMessage);
  }

  const trimmed = value.trim();
  if (!/^\d+$/u.test(trimmed)) {
    throw new ValidationError(invalidMessage);
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(nonPositiveMessage ?? invalidMessage);
  }

  return parsed;
}
