import type { ChildProcess } from "node:child_process";
import {
  constants as fsConstants,
  createWriteStream,
  existsSync,
} from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative as relativePath } from "node:path";

import type { AgentManifest } from "../../commands/run/shim/agent-manifest.js";
import type { DenialBackoffConfig } from "../../configs/sandbox/types.js";
import type { WatchdogMetadata } from "../../runs/records/types.js";
import { getCliAssetPath, resolveCliAssetRoot } from "../../utils/cli-root.js";
import { resolvePath } from "../../utils/path.js";
import { spawnStreamingProcess } from "../../utils/process.js";
import { AgentRuntimeProcessError } from "./errors.js";
import {
  generateSandboxSettings,
  resolveSrtBinary,
  type SandboxFailFastInfo,
  writeSandboxSettings,
} from "./sandbox.js";
import type { SandboxPolicyOverrides } from "./types.js";
import {
  createWatchdog,
  WATCHDOG_DEFAULTS,
  type WatchdogController,
  type WatchdogTrigger,
} from "./watchdog.js";

const DEFAULT_SRT_ARGUMENTS = ["--debug"] as const;
const SRT_BINARY_ENV = "VORATIQ_SRT_BINARY" as const;

let cachedSrtBinaryPath: string | undefined;

export interface AgentProcessOptions {
  runtimeManifestPath: string;
  agentRoot: string;
  stdoutPath: string;
  stderrPath: string;
  sandboxSettingsPath: string;
  denialBackoff?: DenialBackoffConfig;
  resolveRunInvocation?: RunInvocationResolver;
  /** Provider ID for watchdog fatal pattern matching. */
  providerId?: string;
  /** Callback fired immediately when watchdog triggers, before process exits. */
  onWatchdogTrigger?: (
    trigger: WatchdogTrigger,
    reason: string,
    failFast?: SandboxFailFastInfo,
  ) => void;
}

export interface AgentProcessResult {
  exitCode: number;
  errorMessage?: string;
  signal?: NodeJS.Signals | null;
  /** Watchdog metadata showing enforced limits and trigger reason. */
  watchdog?: WatchdogMetadata;
  /** Sandbox fail-fast metadata when repeated denials trigger an abort. */
  failFast?: SandboxFailFastInfo;
}

export interface RunInvocationContext {
  agentRoot: string;
  configArg: string;
  settingsArg: string;
  shimEntryPath: string;
}

export interface RunInvocation {
  command: string;
  args: string[];
}

export type RunInvocationResolver = (
  context: RunInvocationContext,
) => Promise<RunInvocation> | RunInvocation;

export interface SandboxSettingsInput {
  sandboxHomePath: string;
  workspacePath: string;
  providerId: string;
  root: string;
  repoRootPath?: string;
  sandboxSettingsPath: string;
  runtimePath: string;
  artifactsPath: string;
  policyOverrides?: SandboxPolicyOverrides;
  extraWriteProtectedPaths?: readonly string[];
  extraReadProtectedPaths?: readonly string[];
}

export async function configureSandboxSettings(
  input: SandboxSettingsInput,
): Promise<{ sandboxSettings: ReturnType<typeof generateSandboxSettings> }> {
  const sandboxSettings = generateSandboxSettings({
    ...input,
    repoRootPath: input.repoRootPath ?? input.root,
  });
  await writeSandboxSettings(input.sandboxSettingsPath, sandboxSettings);
  return { sandboxSettings };
}

export async function getRunCommand(): Promise<string> {
  const { X_OK } = fsConstants;
  const binaryPath = resolveSrtBinaryPath();
  try {
    await access(binaryPath, X_OK);
  } catch {
    throw new Error(
      `Sandbox Runtime binary not found or not executable at ${binaryPath}. Please reinstall dependencies with 'npm install'.`,
    );
  }
  return binaryPath;
}

function getRunArgs(options: {
  settingsArg: string;
  configArg: string;
  shimEntryPath: string;
}): string[] {
  const { settingsArg, configArg, shimEntryPath } = options;
  return [
    ...DEFAULT_SRT_ARGUMENTS,
    "--settings",
    settingsArg,
    "--",
    process.execPath,
    shimEntryPath,
    "--config",
    configArg,
  ];
}

async function defaultResolveRunInvocation(
  context: RunInvocationContext,
): Promise<RunInvocation> {
  const command = await getRunCommand();
  const args = getRunArgs({
    settingsArg: context.settingsArg,
    configArg: context.configArg,
    shimEntryPath: context.shimEntryPath,
  });
  return { command, args };
}

export async function runAgentProcess(
  options: AgentProcessOptions,
): Promise<AgentProcessResult> {
  const {
    runtimeManifestPath,
    agentRoot,
    stdoutPath,
    stderrPath,
    sandboxSettingsPath,
    denialBackoff,
    resolveRunInvocation,
    providerId = "",
    onWatchdogTrigger,
  } = options;

  const stdoutStream = createWriteStream(stdoutPath, { flags: "w" });
  const stderrStream = createWriteStream(stderrPath, { flags: "w" });

  const shimEntryPath = resolveShimEntryPath();
  if (!existsSync(shimEntryPath)) {
    throw new AgentRuntimeProcessError(
      `Shim entry point missing at ${shimEntryPath}`,
    );
  }

  const manifestArgPath = await stageManifestForSandbox({
    runtimeManifestPath,
  });
  const relativeConfig = relativePath(agentRoot, manifestArgPath);
  const configArg = relativeConfig === "" ? manifestArgPath : relativeConfig;

  const relativeSettings = relativePath(agentRoot, sandboxSettingsPath);
  const settingsArg =
    relativeSettings === "" ? sandboxSettingsPath : relativeSettings;

  const invocationResolver =
    resolveRunInvocation ?? defaultResolveRunInvocation;
  const { command, args } = await invocationResolver({
    agentRoot,
    configArg,
    settingsArg,
    shimEntryPath,
  });

  let watchdogController: WatchdogController | undefined;
  let abortSignalHandler: (() => void) | undefined;
  const forceAbortController = new AbortController();

  let exitCode: number;
  let signal: NodeJS.Signals | null;
  let aborted = false;

  try {
    const result = await spawnStreamingProcess({
      command,
      args,
      cwd: agentRoot,
      stdout: { writable: stdoutStream },
      stderr: { writable: stderrStream },
      detached: true,
      onSpawn: (child: ChildProcess) => {
        watchdogController = createWatchdog(child, stderrStream, {
          providerId,
          onWatchdogTrigger,
          denialBackoff,
        });
        abortSignalHandler = () => forceAbortController.abort();
        watchdogController.abortSignal.addEventListener(
          "abort",
          abortSignalHandler,
          { once: true },
        );
      },
      onData: (chunk: Buffer) => {
        watchdogController?.handleOutput(chunk);
      },
      abortSignal: forceAbortController.signal,
    });
    exitCode = result.exitCode;
    signal = result.signal;
    aborted = result.aborted ?? false;
  } finally {
    if (abortSignalHandler && watchdogController) {
      watchdogController.abortSignal.removeEventListener(
        "abort",
        abortSignalHandler,
      );
    }
    watchdogController?.cleanup();
    if (!stdoutStream.closed) {
      stdoutStream.end();
    }
    if (!stderrStream.closed) {
      stderrStream.end();
    }
  }

  const watchdogState = watchdogController?.getState();
  const watchdogTrigger = watchdogState?.triggered ?? undefined;
  const failFast = watchdogState?.sandboxFailFast;

  let errorMessage: string | undefined;
  if (watchdogTrigger && watchdogState?.triggeredReason) {
    errorMessage = aborted
      ? `${watchdogState.triggeredReason} (force-aborted after unresponsive to signals)`
      : watchdogState.triggeredReason;
  } else if (signal) {
    errorMessage = `Agent terminated by signal ${signal}`;
  } else if (exitCode !== 0) {
    errorMessage = `Agent exited with code ${exitCode}`;
  }

  const watchdog: WatchdogMetadata = {
    silenceTimeoutMs: WATCHDOG_DEFAULTS.silenceTimeoutMs,
    wallClockCapMs: WATCHDOG_DEFAULTS.wallClockCapMs,
    ...(watchdogTrigger ? { trigger: watchdogTrigger } : {}),
  };

  return { exitCode, errorMessage, signal, watchdog, failFast };
}

export async function stageManifestForSandbox(options: {
  runtimeManifestPath: string;
}): Promise<string> {
  const { runtimeManifestPath } = options;

  let rawManifest: string;
  try {
    rawManifest = await readFile(runtimeManifestPath, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AgentRuntimeProcessError(
      `Failed to read manifest at "${runtimeManifestPath}": ${detail}`,
    );
  }

  let manifest: AgentManifest;
  try {
    manifest = JSON.parse(rawManifest) as AgentManifest;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AgentRuntimeProcessError(
      `Manifest JSON at "${runtimeManifestPath}" is invalid: ${detail}`,
    );
  }

  const manifestDir = dirname(runtimeManifestPath);
  const promptAbsolute = isAbsolute(manifest.promptPath)
    ? manifest.promptPath
    : resolvePath(manifestDir, manifest.promptPath);
  const workspaceAbsolute = isAbsolute(manifest.workspace)
    ? manifest.workspace
    : resolvePath(manifestDir, manifest.workspace);

  const manifestNeedsUpdate =
    manifest.promptPath !== promptAbsolute ||
    manifest.workspace !== workspaceAbsolute;
  if (manifestNeedsUpdate) {
    const updatedManifest = {
      ...manifest,
      promptPath: promptAbsolute,
      workspace: workspaceAbsolute,
    } satisfies AgentManifest;
    await writeFile(
      runtimeManifestPath,
      `${JSON.stringify(updatedManifest, null, 2)}\n`,
      "utf8",
    );
  }

  return runtimeManifestPath;
}

function resolveSrtBinaryPath(): string {
  const overridePath = process.env[SRT_BINARY_ENV];
  if (overridePath && overridePath.length > 0) {
    return overridePath;
  }
  if (!cachedSrtBinaryPath) {
    const cliRoot = resolveCliAssetRoot();
    cachedSrtBinaryPath = resolveSrtBinary(cliRoot);
  }
  return cachedSrtBinaryPath;
}

function resolveShimEntryPath(): string {
  return getCliAssetPath(
    "dist",
    "commands",
    "run",
    "shim",
    "run-agent-shim.mjs",
  );
}
