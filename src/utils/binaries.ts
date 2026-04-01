import { accessSync, constants as fsConstants } from "node:fs";
import { delimiter, join } from "node:path";

export function detectBinary(command: string): string | undefined {
  const pathEntries = (process.env.PATH ?? "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of pathEntries) {
    const candidate = join(entry, command);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}
