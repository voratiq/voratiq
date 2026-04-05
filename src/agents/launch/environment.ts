import { delimiter, relative as relativePath } from "node:path";

import {
  type EnvironmentConfig,
  getNodeDependencyRoots,
  getPythonEnvironmentPath,
} from "../../configs/environment/types.js";
import { pathExists } from "../../utils/fs.js";
import { resolvePath } from "../../utils/path.js";

export async function composeLaunchEnvironment(options: {
  baseEnv: Record<string, string>;
  workspacePath: string;
  environment: EnvironmentConfig;
}): Promise<Record<string, string>> {
  const { baseEnv, workspacePath, environment } = options;
  const result: Record<string, string> = { ...baseEnv };
  const pathPrepends: string[] = [];

  const nodeBinPath = resolvePath(workspacePath, "node_modules", ".bin");
  if (
    getNodeDependencyRoots(environment).length > 0 &&
    (await pathExists(nodeBinPath))
  ) {
    pathPrepends.push(nodeBinPath);
  }

  if (getPythonEnvironmentPath(environment)) {
    const virtualEnvPath = resolvePath(workspacePath, ".venv");
    result.VIRTUAL_ENV = virtualEnvPath;
    const virtualEnvBinPath = resolvePath(virtualEnvPath, "bin");
    if (await pathExists(virtualEnvBinPath)) {
      pathPrepends.push(virtualEnvBinPath);
    }
  }

  if (pathPrepends.length > 0) {
    const existingPath = result.PATH ?? process.env.PATH ?? "";
    result.PATH = mergePathEntries(pathPrepends, existingPath);
  }

  return result;
}

export function mergePathEntries(
  prepends: readonly string[],
  existing: string,
): string {
  const combined: string[] = [];
  for (const entry of prepends) {
    if (entry.length > 0) {
      combined.push(entry);
    }
  }

  if (existing.length > 0) {
    for (const entry of existing.split(delimiter)) {
      if (entry.length > 0) {
        combined.push(entry);
      }
    }
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const entry of combined) {
    if (seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    deduped.push(entry);
  }

  return deduped.join(delimiter);
}

export function normalizeRelative(origin: string, target: string): string {
  const relative = relativePath(origin, target);
  return relative.length > 0 ? relative : target;
}
