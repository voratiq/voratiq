import type { SandboxRuntimeConfig } from "@voratiq/sandbox-runtime";

import type { AgentDefinition } from "../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../configs/environment/types.js";
import type { DenialBackoffConfig } from "../../configs/sandbox/types.js";
import type { WatchdogMetadata } from "../../records/types.js";
import type { SandboxFailFastInfo } from "./sandbox.js";
import type { WatchdogTrigger } from "./watchdog.js";

export interface SandboxPolicyOverrides {
  readonly allowWrite?: readonly string[];
  readonly denyWrite?: readonly string[];
  readonly denyRead?: readonly string[];
}

export interface AgentRuntimePaths {
  /** Base directory for the agent session (contains `runtime/` + `artifacts/`). */
  readonly agentRoot: string;

  /** Agent working directory (e.g., a worktree). */
  readonly workspacePath: string;

  /** Writable sandbox home directory for auth staging and HOME isolation. */
  readonly sandboxHomePath: string;

  /** Where to write runtime manifest (`runtime/manifest.json`). */
  readonly runtimeManifestPath: string;

  /** Where to write sandbox settings (`runtime/sandbox.json`). */
  readonly sandboxSettingsPath: string;

  /** Path to the runtime directory (`.../runtime`). Used for temp prompt. */
  readonly runtimePath: string;

  /** Path to the artifacts directory (`.../artifacts`). Used for read/write protection and stdout/stderr. */
  readonly artifactsPath: string;

  /** Process stdout capture. */
  readonly stdoutPath: string;

  /** Process stderr capture. */
  readonly stderrPath: string;
}

export type SandboxSettings = SandboxRuntimeConfig;

export interface AgentRuntimeHarnessInput {
  readonly root: string;
  /** Optional caller-provided identifier for global teardown support. */
  readonly sessionId?: string;
  readonly agent: AgentDefinition;
  readonly prompt: string;
  readonly environment: EnvironmentConfig;
  readonly paths: AgentRuntimePaths;

  /**
   * Override for sandbox provider used to load sandbox configuration. Defaults to `agent.provider`.
   */
  readonly sandboxProviderId?: string;

  /**
   * Filesystem policy overrides applied on top of the provider defaults.
   * Reads are allowed by default; writes are restricted via allow/deny lists.
   */
  readonly sandboxPolicyOverrides?: SandboxPolicyOverrides;

  /**
   * Extra paths that must be write-protected from the sandboxed process (e.g., run-specific eval dirs).
   */
  readonly extraWriteProtectedPaths?: readonly string[];

  /**
   * Extra paths that must be read-protected from the sandboxed process (optional).
   */
  readonly extraReadProtectedPaths?: readonly string[];

  /** Denial backoff config used by watchdog; falls back to provider config or defaults. */
  readonly denialBackoff?: DenialBackoffConfig;

  /** Disable chat capture entirely. */
  readonly captureChat?: boolean;

  /** Optional hook for immediate watchdog UI updates. */
  readonly onWatchdogTrigger?: (
    trigger: WatchdogTrigger,
    reason: string,
    failFast?: SandboxFailFastInfo,
  ) => void;
}

export interface AgentRuntimeChatResult {
  readonly captured: boolean;
  readonly format?: "json" | "jsonl";
  readonly artifactPath?: string;
  readonly sourceCount?: number;
  readonly error?: unknown;
}

export interface AgentRuntimeHarnessResult {
  readonly exitCode: number;
  readonly errorMessage?: string;
  readonly signal?: NodeJS.Signals | null;
  readonly watchdog?: WatchdogMetadata;
  readonly failFast?: SandboxFailFastInfo;
  readonly sandboxSettings: SandboxSettings;
  readonly chat?: AgentRuntimeChatResult;
  /** The environment used by the sandboxed agent (includes PATH adjustments and staged auth vars). */
  readonly manifestEnv: Record<string, string>;
}
