import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, resolve as resolveNative } from "node:path";

import { isMissing } from "../../utils/fs.js";
import { SANDBOX_DIRNAME } from "../../workspace/structure.js";
import type {
  AuthRuntimeContext,
  StageResult,
  TeardownOptions,
} from "./types.js";

const STAGED_FILE_MODE = 0o600;

export function resolveProviderHome(
  runtime: AuthRuntimeContext,
  envVar: string,
  defaultSubdir: string,
): string | undefined {
  const configured = runtime.env[envVar]?.trim();
  if (configured) {
    if (isAbsolute(configured)) {
      return configured;
    }
    const base = runtime.homeDir ?? process.cwd();
    return resolveNative(base, configured);
  }

  if (runtime.homeDir) {
    return resolveNative(runtime.homeDir, defaultSubdir);
  }

  return undefined;
}

export function resolveChildPath(root: string, ...segments: string[]): string {
  return resolveNative(root, ...segments);
}

export interface SandboxPaths extends Record<string, string> {
  home: string;
}

export type SandboxLayout = Record<string, readonly string[]>;

export { isMissing };

export function createSandboxPaths(
  agentRoot: string,
  layout: SandboxLayout,
): SandboxPaths {
  const home = resolveChildPath(agentRoot, SANDBOX_DIRNAME);
  const paths: SandboxPaths = { home };
  for (const [name, segments] of Object.entries(layout)) {
    paths[name] = resolveChildPath(home, ...segments);
  }
  return paths;
}

export async function ensureDirectories(
  directories: readonly string[],
): Promise<void> {
  const unique = [...new Set(directories)];
  await Promise.all(
    unique.map(async (directory) => {
      await mkdir(directory, { recursive: true });
    }),
  );
}

export type ErrorFactory = (cause?: unknown) => Error;

const { F_OK } = fsConstants;

export async function assertReadableFileOrThrow(
  path: string,
  createError: ErrorFactory,
): Promise<void> {
  try {
    const stats = await stat(path);
    if (!stats.isFile()) {
      throw createError();
    }
    await access(path, F_OK);
  } catch (error) {
    if (isMissing(error)) {
      throw createError(error);
    }
    throw createError(error);
  }
}

export async function copyFileWithPermissions(
  source: string,
  destination: string,
  mode: number = STAGED_FILE_MODE,
): Promise<void> {
  await copyFile(source, destination);
  await chmod(destination, mode);
}

export async function writeFileWithPermissions(
  destination: string,
  data: string | NodeJS.ArrayBufferView,
  options: Parameters<typeof writeFile>[2] = { encoding: "utf8" },
  mode: number = STAGED_FILE_MODE,
): Promise<void> {
  await writeFile(destination, data, options);
  await chmod(destination, mode);
}

export async function copyOptionalFileWithPermissions(
  source: string,
  destination: string,
  createError?: ErrorFactory,
): Promise<void> {
  try {
    await access(source, F_OK);
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    if (createError) {
      throw createError(error);
    }
    throw error;
  }

  try {
    await copyFileWithPermissions(source, destination);
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    if (createError) {
      throw createError(error);
    }
    throw error;
  }
}

export async function copyOptionalDirectoryWithPermissions(
  source: string,
  destination: string,
  createError?: ErrorFactory,
  fileMode: number = STAGED_FILE_MODE,
  dirMode: number = 0o700,
): Promise<void> {
  try {
    const sourceStats = await stat(source);
    if (!sourceStats.isDirectory()) {
      if (createError) {
        throw createError();
      }
      return;
    }
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    if (createError) {
      throw createError(error);
    }
    throw error;
  }

  try {
    await copyDirectoryRecursive(source, destination, fileMode, dirMode);
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    if (createError) {
      throw createError(error);
    }
    throw error;
  }
}

async function copyDirectoryRecursive(
  source: string,
  destination: string,
  fileMode: number,
  dirMode: number,
): Promise<void> {
  await mkdir(destination, { recursive: true, mode: dirMode });
  await chmod(destination, dirMode).catch(() => {});

  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = resolveChildPath(source, entry.name);
    const destinationPath = resolveChildPath(destination, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(
        sourcePath,
        destinationPath,
        fileMode,
        dirMode,
      );
      continue;
    }

    if (entry.isFile()) {
      await copyFileWithPermissions(sourcePath, destinationPath, fileMode);
    }
  }
}

export function composeSandboxEnvResult(
  sandboxPath: string,
  env: Record<string, string>,
): StageResult {
  return {
    sandboxPath,
    env: {
      HOME: sandboxPath,
      ...env,
    },
  };
}

export async function teardownSandbox({
  sandboxPath,
}: TeardownOptions): Promise<void> {
  await rm(sandboxPath, { recursive: true, force: true });
}
