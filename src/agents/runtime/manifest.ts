import { mkdir, writeFile } from "node:fs/promises";
import { delimiter, dirname, relative as relativePath } from "node:path";

import type { AgentManifest } from "../../commands/run/shim/agent-manifest.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import {
  type EnvironmentConfig,
  getNodeDependencyRoots,
  getPythonEnvironmentPath,
} from "../../configs/environment/types.js";
import { pathExists } from "../../utils/fs.js";
import { resolvePath } from "../../utils/path.js";
import { AgentRuntimeManifestError } from "./errors.js";

export interface ManifestWriteOptions {
  agent: AgentDefinition;
  runtimeManifestPath: string;
  promptPath: string;
  workspacePath: string;
  env?: Record<string, string>;
  environment: EnvironmentConfig;
}

export async function writeAgentManifest(
  options: ManifestWriteOptions,
): Promise<Record<string, string>> {
  const {
    agent,
    runtimeManifestPath,
    promptPath,
    workspacePath,
    env = {},
    environment,
  } = options;
  const manifestDir = dirname(runtimeManifestPath);

  const manifestEnv = await composeManifestEnvironment({
    baseEnv: env,
    workspacePath,
    environment,
  });

  const manifest = {
    binary: agent.binary,
    argv: [...agent.argv],
    // Keep relative paths for readability; the launcher will normalize to absolutes.
    promptPath: normalizeRelative(manifestDir, promptPath),
    workspace: normalizeRelative(manifestDir, workspacePath),
    env: manifestEnv,
  } satisfies AgentManifest;

  try {
    const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
    await mkdir(dirname(runtimeManifestPath), { recursive: true });
    await writeFile(runtimeManifestPath, manifestJson, { encoding: "utf8" });
    return manifestEnv;
  } catch (error) {
    throw new AgentRuntimeManifestError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function composeManifestEnvironment(options: {
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
