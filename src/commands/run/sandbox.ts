import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import type { SandboxRuntimeConfig } from "@voratiq/sandbox-runtime";

import { loadSandboxProviderConfig } from "../../configs/sandbox/loader.js";
import type { SandboxFilesystemConfig } from "../../configs/sandbox/types.js";
import { resolvePath } from "../../utils/path.js";

export type SandboxSettings = SandboxRuntimeConfig;

export interface SandboxSettingsOptions {
  sandboxHomePath: string;
  workspacePath: string;
  provider: string;
  root: string;
  sandboxSettingsPath: string;
  runtimePath: string;
  artifactsPath: string;
  evalsPath: string;
}

export function generateSandboxSettings(
  options: SandboxSettingsOptions,
): SandboxSettings {
  const {
    sandboxHomePath,
    workspacePath,
    provider,
    root,
    sandboxSettingsPath,
    runtimePath,
    artifactsPath,
    evalsPath,
  } = options;

  const providerConfig = loadSandboxProviderConfig({
    root,
    providerId: provider,
  });
  const { network: networkSettings, filesystem } = providerConfig;

  const resolvedFilesystem = resolveFilesystemPaths(filesystem, workspacePath);

  const runtimeWriteProtectedPaths = [runtimePath, artifactsPath, evalsPath];
  const runtimeReadProtectedPaths = [artifactsPath, evalsPath];
  const allowWrite = buildAllowWriteSet(
    resolvedFilesystem,
    sandboxHomePath,
    workspacePath,
    [sandboxSettingsPath, ...runtimeWriteProtectedPaths],
  );
  const denyRead = dedupePaths([
    ...resolvedFilesystem.denyRead,
    ...runtimeReadProtectedPaths,
  ]);
  const denyWrite = dedupePaths([
    ...resolvedFilesystem.denyWrite,
    ...runtimeWriteProtectedPaths,
  ]);

  return {
    network: {
      allowedDomains: [...networkSettings.allowedDomains],
      deniedDomains: [...networkSettings.deniedDomains],
      ...(networkSettings.allowLocalBinding ? { allowLocalBinding: true } : {}),
      ...(networkSettings.allowUnixSockets &&
      networkSettings.allowUnixSockets.length > 0
        ? { allowUnixSockets: [...networkSettings.allowUnixSockets] }
        : {}),
      ...(networkSettings.allowAllUnixSockets
        ? { allowAllUnixSockets: true }
        : {}),
    },
    filesystem: {
      denyRead,
      allowWrite: Array.from(allowWrite),
      denyWrite,
    },
  };
}

function getDefaultSandboxWritePaths(): string[] {
  return [];
}

function buildAllowWriteSet(
  filesystem: SandboxFilesystemConfig,
  sandboxHomePath: string,
  workspacePath: string,
  blockedPaths: readonly string[],
): Set<string> {
  const allowWrite = new Set<string>([
    // Auth providers copy credentials/configs into the sandbox directory;
    // we only need to allow writes within the sandbox plus the runtime defaults.
    ...getDefaultSandboxWritePaths(),
    ...filesystem.allowWrite,
  ]);
  allowWrite.add(sandboxHomePath);
  allowWrite.add(workspacePath);
  for (const blockedPath of blockedPaths) {
    allowWrite.delete(blockedPath);
  }
  return allowWrite;
}

function dedupePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    result.push(path);
  }
  return result;
}

function resolveFilesystemPaths(
  filesystem: SandboxFilesystemConfig,
  workspacePath: string,
): SandboxFilesystemConfig {
  return {
    allowWrite: resolvePaths(filesystem.allowWrite, workspacePath),
    denyRead: resolvePaths(filesystem.denyRead, workspacePath),
    denyWrite: resolvePaths(filesystem.denyWrite, workspacePath),
  };
}

function resolvePaths(
  entries: readonly string[],
  workspacePath: string,
): string[] {
  return entries.map((entry) =>
    isAbsolute(entry) ? entry : resolvePath(workspacePath, entry),
  );
}

export async function writeSandboxSettings(
  sandboxSettingsPath: string,
  settings: SandboxSettings,
): Promise<void> {
  await mkdir(dirname(sandboxSettingsPath), { recursive: true });
  const settingsJson = `${JSON.stringify(settings, null, 2)}\n`;
  await writeFile(sandboxSettingsPath, settingsJson, { encoding: "utf8" });
}

export function resolveSrtBinary(cliRoot: string): string {
  return resolvePath(cliRoot, "node_modules", ".bin", "srt");
}

export function checkPlatformSupport(): void {
  const platform = process.platform;
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(
      `Sandbox Runtime is not supported on platform "${platform}". Only macOS and Linux are supported.`,
    );
  }
}
