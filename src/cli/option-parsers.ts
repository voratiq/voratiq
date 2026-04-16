import { parsePositiveInteger } from "../utils/validators.js";

export function collectRepeatedStringOption(
  value: string,
  previous: string[],
): string[] {
  return [...previous, value];
}

export function parseMaxParallelOption(value: string): number {
  return parsePositiveInteger(
    value,
    "Expected positive integer after --max-parallel",
    "--max-parallel must be greater than 0",
  );
}
