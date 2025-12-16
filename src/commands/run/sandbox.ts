import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import type { SandboxRuntimeConfig } from "@voratiq/sandbox-runtime";

import { loadSandboxProviderConfig } from "../../configs/sandbox/loader.js";
import type {
  DenialBackoffConfig,
  SandboxFilesystemConfig,
} from "../../configs/sandbox/types.js";
import { resolvePath } from "../../utils/path.js";

export type SandboxSettings = SandboxRuntimeConfig;

export type DenialOperationType =
  | "network-connect"
  | "file-read"
  | "file-write";

export interface SandboxFailFastInfo {
  operation: DenialOperationType;
  target: string;
}

export const DEFAULT_DENIAL_BACKOFF: DenialBackoffConfig = {
  enabled: true,
  warningThreshold: 2,
  delayThreshold: 3,
  delayMs: 5000,
  failFastThreshold: 4,
  windowMs: 120000,
};

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

export function resolveDenialBackoffConfig(
  config: DenialBackoffConfig | undefined,
): DenialBackoffConfig {
  if (!config) {
    return { ...DEFAULT_DENIAL_BACKOFF };
  }
  return {
    enabled:
      typeof config.enabled === "boolean"
        ? config.enabled
        : DEFAULT_DENIAL_BACKOFF.enabled,
    warningThreshold:
      typeof config.warningThreshold === "number"
        ? config.warningThreshold
        : DEFAULT_DENIAL_BACKOFF.warningThreshold,
    delayThreshold:
      typeof config.delayThreshold === "number"
        ? config.delayThreshold
        : DEFAULT_DENIAL_BACKOFF.delayThreshold,
    delayMs:
      typeof config.delayMs === "number"
        ? config.delayMs
        : DEFAULT_DENIAL_BACKOFF.delayMs,
    failFastThreshold:
      typeof config.failFastThreshold === "number"
        ? config.failFastThreshold
        : DEFAULT_DENIAL_BACKOFF.failFastThreshold,
    windowMs:
      typeof config.windowMs === "number"
        ? config.windowMs
        : DEFAULT_DENIAL_BACKOFF.windowMs,
  };
}

export function parseSandboxDenialLine(
  line: string,
): SandboxFailFastInfo | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const debugNetworkDeny = trimmed.match(
    /^\[SandboxDebug\]\s+(?:Denied by config rule|No matching config rule, denying|User denied):\s+([^\s]+)$/u,
  );
  if (debugNetworkDeny?.[1]) {
    return { operation: "network-connect", target: debugNetworkDeny[1] };
  }

  const macosKernelDeny = trimmed.match(
    /\bSandbox:\s+deny(?:\(\d+\))?\s+([^\s]+)\s+(.+)$/u,
  );
  if (macosKernelDeny?.[1] && macosKernelDeny[2]) {
    const op = macosKernelDeny[1].toLowerCase();
    const target = macosKernelDeny[2].trim();
    if (op.includes("network")) {
      return { operation: "network-connect", target };
    }
    if (op.includes("file-read")) {
      return { operation: "file-read", target };
    }
    if (op.includes("file-write")) {
      return { operation: "file-write", target };
    }
  }

  return undefined;
}

export type DenialBackoffAction = "none" | "warn" | "delay" | "fail-fast";

export interface DenialBackoffDecision {
  action: DenialBackoffAction;
  count: number;
  info: SandboxFailFastInfo;
}

export class DenialBackoffTracker {
  private readonly config: DenialBackoffConfig;
  private readonly byTarget = new Map<string, number[]>();

  constructor(config: DenialBackoffConfig) {
    this.config = resolveDenialBackoffConfig(config);
  }

  public resetAll(): void {
    this.byTarget.clear();
  }

  public register(
    info: SandboxFailFastInfo,
    now = Date.now(),
  ): DenialBackoffDecision {
    const key = `${info.operation}:${info.target}`;
    const windowMs = this.config.windowMs;
    const existing = this.byTarget.get(key) ?? [];
    const last =
      existing.length > 0 ? existing[existing.length - 1] : undefined;
    const timestamps =
      last !== undefined && now - last > windowMs ? [] : [...existing];

    timestamps.push(now);
    const maxKept = Math.max(1, this.config.failFastThreshold);
    while (timestamps.length > maxKept) {
      timestamps.shift();
    }
    this.byTarget.set(key, timestamps);

    const countInWindow = countWithinMs(timestamps, now, windowMs);
    const countIn60 = countWithinMs(timestamps, now, 60_000);
    const countIn30 = countWithinMs(timestamps, now, 30_000);

    let action: DenialBackoffAction = "none";
    if (this.config.enabled && countInWindow >= this.config.failFastThreshold) {
      action = "fail-fast";
    } else if (
      this.config.enabled &&
      countIn60 === this.config.delayThreshold
    ) {
      action = "delay";
    } else if (
      this.config.enabled &&
      countIn30 === this.config.warningThreshold
    ) {
      action = "warn";
    }

    return { action, count: countInWindow, info };
  }
}

function countWithinMs(
  timestamps: readonly number[],
  now: number,
  windowMs: number,
): number {
  let count = 0;
  for (let i = timestamps.length - 1; i >= 0; i -= 1) {
    if (now - timestamps[i] <= windowMs) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
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
