import { agentIdSchema } from "../configs/agents/types.js";
import type { EvalStatus } from "../configs/evals/types.js";
import { evalSlugSchema } from "../configs/evals/types.js";
import {
  assertRepoRelativePath,
  resolvePathWithinRoot,
} from "../utils/path.js";
import type { ChatArtifactFormat } from "./chat/types.js";

export const VORATIQ_DIR = ".voratiq";
export const VORATIQ_RUNS_DIR = "runs";
export const VORATIQ_RUNS_FILE = "runs/index.json";
export const VORATIQ_AGENTS_FILE = "agents.yaml";
export const VORATIQ_EVALS_FILE = "evals.yaml";
export const VORATIQ_ENVIRONMENT_FILE = "environment.yaml";
export const VORATIQ_SANDBOX_FILE = "sandbox.yaml";

export const WORKSPACE_DIRNAME = "workspace";
export const EVALS_DIRNAME = "evals";
export const STDOUT_FILENAME = "stdout.log";
export const STDERR_FILENAME = "stderr.log";
export const DIFF_FILENAME = "diff.patch";
export const SUMMARY_FILENAME = "summary.txt";
export const CHAT_JSON_FILENAME = "chat.json";
export const CHAT_JSONL_FILENAME = "chat.jsonl";
export const PROMPT_FILENAME = "prompt.txt";
export const RUNTIME_DIRNAME = "runtime";
export const ARTIFACTS_DIRNAME = "artifacts";
export const MANIFEST_FILENAME = "manifest.json";
export const SANDBOX_DIRNAME = "sandbox";
export const SANDBOX_SETTINGS_FILENAME = "sandbox.json";

export function resolveWorkspacePath(
  root: string,
  ...segments: string[]
): string {
  return resolvePathWithinRoot(root, [VORATIQ_DIR, ...segments]);
}

export function formatWorkspacePath(...segments: string[]): string {
  return [VORATIQ_DIR, ...segments].join("/");
}

const RUNS_SEGMENT = VORATIQ_RUNS_DIR;

function assertPathSegment(
  label: "runId" | "agentId" | "segment" | "evalSlug",
  value: string,
): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  if (value.length === 0) {
    throw new Error(`${label} must be non-empty`);
  }
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new Error(`${label} "${value}" must not contain path separators`);
  }
  return value;
}

function formatRunScopedPath(runId: string, ...segments: string[]): string {
  const safeRunId = assertPathSegment("runId", runId);
  const scoped = formatWorkspacePath(RUNS_SEGMENT, safeRunId, ...segments);
  return assertRepoRelativePath(scoped);
}

function formatAgentScopedPath(
  runId: string,
  agentId: string,
  ...segments: string[]
): string {
  const safeAgentId = agentIdSchema.parse(agentId);
  return formatRunScopedPath(runId, safeAgentId, ...segments);
}

function assertEvalSlug(evalSlug: string): string {
  return evalSlugSchema.parse(assertPathSegment("evalSlug", evalSlug));
}

export function getRunDirectoryPath(runId: string): string {
  return formatRunScopedPath(runId);
}

export function getRunPromptPath(runId: string): string {
  return formatRunScopedPath(runId, PROMPT_FILENAME);
}

export function getAgentDirectoryPath(runId: string, agentId: string): string {
  return formatAgentScopedPath(runId, agentId);
}

export function getAgentManifestPath(runId: string, agentId: string): string {
  return formatAgentScopedPath(
    runId,
    agentId,
    RUNTIME_DIRNAME,
    MANIFEST_FILENAME,
  );
}

export function getAgentRuntimeDirectoryPath(
  runId: string,
  agentId: string,
): string {
  return formatAgentScopedPath(runId, agentId, RUNTIME_DIRNAME);
}

export function getAgentWorkspaceDirectoryPath(
  runId: string,
  agentId: string,
): string {
  return formatAgentScopedPath(runId, agentId, WORKSPACE_DIRNAME);
}

export function getAgentStdoutPath(runId: string, agentId: string): string {
  return formatAgentScopedPath(
    runId,
    agentId,
    ARTIFACTS_DIRNAME,
    STDOUT_FILENAME,
  );
}

export function getAgentStderrPath(runId: string, agentId: string): string {
  return formatAgentScopedPath(
    runId,
    agentId,
    ARTIFACTS_DIRNAME,
    STDERR_FILENAME,
  );
}

export function getAgentDiffPath(runId: string, agentId: string): string {
  return formatAgentScopedPath(
    runId,
    agentId,
    ARTIFACTS_DIRNAME,
    DIFF_FILENAME,
  );
}

export function getAgentSummaryPath(runId: string, agentId: string): string {
  return formatAgentScopedPath(
    runId,
    agentId,
    ARTIFACTS_DIRNAME,
    SUMMARY_FILENAME,
  );
}

export function getAgentChatArtifactPath(
  runId: string,
  agentId: string,
  format: ChatArtifactFormat,
): string {
  const filename = format === "json" ? CHAT_JSON_FILENAME : CHAT_JSONL_FILENAME;
  return formatAgentScopedPath(runId, agentId, ARTIFACTS_DIRNAME, filename);
}

export interface AgentArtifactsSnapshot {
  stdoutCaptured?: boolean;
  stderrCaptured?: boolean;
  diffCaptured?: boolean;
  summaryCaptured?: boolean;
  chatCaptured?: boolean;
  chatFormat?: ChatArtifactFormat;
}

export interface AgentArtifactPaths {
  stdoutPath?: string;
  stderrPath?: string;
  diffPath?: string;
  summaryPath?: string;
  chatPath?: string;
}

export interface AgentEvalSnapshotLike {
  slug: string;
  status: EvalStatus;
  command?: string;
  exitCode?: number | null;
  hasLog?: boolean;
  error?: string;
}

export interface AgentEvalViewLike extends AgentEvalSnapshotLike {
  logPath?: string;
}

export function buildAgentArtifactPaths(options: {
  runId: string;
  agentId: string;
  artifacts?: AgentArtifactsSnapshot | null;
}): AgentArtifactPaths {
  const { runId, agentId, artifacts } = options;

  const stdoutCaptured = artifacts?.stdoutCaptured ?? true;
  const stderrCaptured = artifacts?.stderrCaptured ?? true;
  const diffCaptured = artifacts?.diffCaptured ?? false;
  const summaryCaptured = artifacts?.summaryCaptured ?? false;
  const chatCaptured = artifacts?.chatCaptured ?? false;
  const chatFormat = artifacts?.chatFormat ?? "jsonl";

  return {
    stdoutPath: stdoutCaptured ? getAgentStdoutPath(runId, agentId) : undefined,
    stderrPath: stderrCaptured ? getAgentStderrPath(runId, agentId) : undefined,
    diffPath: diffCaptured ? getAgentDiffPath(runId, agentId) : undefined,
    summaryPath: summaryCaptured
      ? getAgentSummaryPath(runId, agentId)
      : undefined,
    chatPath: chatCaptured
      ? getAgentChatArtifactPath(runId, agentId, chatFormat)
      : undefined,
  };
}

export function buildAgentEvalViews(options: {
  runId: string;
  agentId: string;
  evals?: readonly AgentEvalSnapshotLike[] | null;
}): AgentEvalViewLike[] {
  const { runId, agentId, evals } = options;
  return (evals ?? []).map((evaluation) => ({
    ...evaluation,
    logPath: evaluation.hasLog
      ? getAgentEvalLogPath(runId, agentId, evaluation.slug)
      : undefined,
  }));
}

export function getAgentEvalsDirectoryPath(
  runId: string,
  agentId: string,
): string {
  return formatAgentScopedPath(runId, agentId, EVALS_DIRNAME);
}

export function getAgentEvalLogPath(
  runId: string,
  agentId: string,
  evalSlug: string,
): string {
  const safeSlug = assertEvalSlug(evalSlug);
  return formatAgentScopedPath(
    runId,
    agentId,
    EVALS_DIRNAME,
    `${safeSlug}.log`,
  );
}

export function getAgentSandboxDirectoryPath(
  runId: string,
  agentId: string,
): string {
  return formatAgentScopedPath(runId, agentId, SANDBOX_DIRNAME);
}

export function getAgentSandboxHomePath(
  runId: string,
  agentId: string,
): string {
  return getAgentSandboxDirectoryPath(runId, agentId);
}

export function getAgentSandboxSettingsPath(
  runId: string,
  agentId: string,
): string {
  return formatAgentScopedPath(
    runId,
    agentId,
    RUNTIME_DIRNAME,
    SANDBOX_SETTINGS_FILENAME,
  );
}
