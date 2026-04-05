import type { ChildProcess, StdioOptions } from "node:child_process";

import type { LaunchArtifactCaptureContext } from "../agents/launch/chat.js";
import type { AgentDefinition } from "../configs/agents/types.js";
import type {
  InteractiveLaunchFailureCode,
  InteractiveSessionRecord,
  ToolAttachmentStatus,
} from "../domain/interactive/model/types.js";

export type {
  InteractiveLaunchFailureCode,
  InteractiveSessionChatRecord,
  InteractiveSessionErrorRecord,
  InteractiveSessionIndexEntry,
  InteractiveSessionIndexRecord,
  InteractiveSessionRecord,
  InteractiveSessionStatus,
  ToolAttachmentStatus,
} from "../domain/interactive/model/types.js";
import type { VoratiqCliTarget } from "../utils/voratiq-cli-target.js";

export type InteractiveLaunchFailureKind = "auth" | "manifest" | "process";
export type NativeSessionLaunchMode = "default" | "first-party";

export interface NativeToolDeclaration {
  name: string;
  command: string;
  args?: readonly string[];
  env?: Record<string, string>;
}

export interface InteractiveLaunchFailure {
  kind: InteractiveLaunchFailureKind;
  code: InteractiveLaunchFailureCode;
  message: string;
  cause?: unknown;
}

export interface NativeLaunchInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}

export interface PreparedInteractiveSession {
  sessionId: string;
  createdAt: string;
  root: string;
  agent: AgentDefinition;
  providerId: string;
  sessionRoot: string;
  runtimePath: string;
  artifactsPath: string;
  recordPath: string;
  indexPath: string;
  toolAttachmentStatus: ToolAttachmentStatus;
  invocation: NativeLaunchInvocation;
  promptPath?: string;
  artifactCaptureSupported: boolean;
  artifactCaptureContext?: LaunchArtifactCaptureContext;
}

export interface PrepareNativeSessionOptions {
  root: string;
  agentId: string;
  sessionId?: string;
  prompt?: string;
  launchMode?: NativeSessionLaunchMode;
  toolDeclarations?: readonly NativeToolDeclaration[];
  voratiqCliTarget?: VoratiqCliTarget;
  cwd?: string;
  promptForMcpInstall?: PromptForMcpInstall;
  mcpCommandRunner?: ProviderMcpCommandRunner;
}

export interface PromptForMcpInstallInput {
  providerId: string;
  message: string;
  defaultValue: boolean;
  prefaceLines?: string[];
}

export type PromptForMcpInstall = (
  options: PromptForMcpInstallInput,
) => Promise<boolean>;

export interface ProviderMcpCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface ProviderMcpCommandInput {
  command: string;
  args: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export type ProviderMcpCommandRunner = (
  input: ProviderMcpCommandInput,
) => Promise<ProviderMcpCommandResult>;

export interface SpawnPreparedSessionOptions {
  stdio?: StdioOptions;
}

export interface PrepareNativeSessionSuccess {
  ok: true;
  prepared: PreparedInteractiveSession;
}

export interface PrepareNativeSessionFailure {
  ok: false;
  sessionId: string;
  failure: InteractiveLaunchFailure;
}

export type PrepareNativeSessionResult =
  | PrepareNativeSessionSuccess
  | PrepareNativeSessionFailure;

export interface SpawnPreparedSessionSuccess {
  ok: true;
  prepared: PreparedInteractiveSession;
  process: ChildProcess;
  pid: number;
  completion: Promise<InteractiveSessionRecord>;
}

export interface SpawnPreparedSessionFailure {
  ok: false;
  sessionId: string;
  failure: InteractiveLaunchFailure;
}

export type SpawnPreparedSessionResult =
  | SpawnPreparedSessionSuccess
  | SpawnPreparedSessionFailure;

export type PrepareAndSpawnNativeSessionResult =
  | SpawnPreparedSessionSuccess
  | PrepareNativeSessionFailure
  | SpawnPreparedSessionFailure;
