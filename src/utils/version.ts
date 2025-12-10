import { readFileSync } from "node:fs";

import { getCliAssetPath } from "./cli-root.js";

let cachedVersion: string | undefined;

export function getVoratiqVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }

  try {
    const packageJsonPath = getCliAssetPath("package.json");
    const packageJsonRaw = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonRaw) as {
      version?: unknown;
    };

    if (typeof packageJson.version === "string") {
      const normalizedVersion = packageJson.version.trim();
      if (normalizedVersion) {
        cachedVersion = normalizedVersion;
        return cachedVersion;
      }
    }
  } catch {
    // Swallow parsing/IO errors; fallback below keeps CLI usable.
  }

  cachedVersion = "unknown";
  return cachedVersion;
}
