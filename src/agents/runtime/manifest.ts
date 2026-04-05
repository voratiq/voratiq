import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentManifest } from "../../agents/runtime/shim/agent-manifest.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../configs/environment/types.js";
import {
  composeLaunchEnvironment,
  normalizeRelative as normalizeRelativePath,
} from "../launch/environment.js";
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
    promptPath: normalizeRelativePath(manifestDir, promptPath),
    workspace: normalizeRelativePath(manifestDir, workspacePath),
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
  return await composeLaunchEnvironment(options);
}

export { mergePathEntries, normalizeRelative } from "../launch/environment.js";
