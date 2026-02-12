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
export const VORATIQ_RUNS_SESSIONS_DIR = "runs/sessions";
export const VORATIQ_REVIEWS_DIR = "reviews";
export const VORATIQ_REVIEWS_FILE = "reviews/index.json";
export const VORATIQ_REVIEWS_SESSIONS_DIR = "reviews/sessions";
export const VORATIQ_SPECS_DIR = "specs";
export const VORATIQ_SPECS_FILE = "specs/index.json";
export const VORATIQ_SPECS_SESSIONS_DIR = "specs/sessions";
export const VORATIQ_INDEX_FILENAME = "index.json";
export const VORATIQ_HISTORY_LOCK_FILENAME = "history.lock";
export const VORATIQ_SESSIONS_DIRNAME = "sessions";
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
export const REVIEW_FILENAME = "review.md";
export const REVIEW_RECOMMENDATION_FILENAME = "recommendation.json";
export const RUNTIME_DIRNAME = "runtime";
export const ARTIFACTS_DIRNAME = "artifacts";
export const MANIFEST_FILENAME = "manifest.json";
export const REVIEW_ARTIFACT_INFO_FILENAME = "artifact-information.json";
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

function assertPathSegment(
  label: "runId" | "agentId" | "segment" | "evalSlug" | "domain" | "sessionId",
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

function assertDomainSegment(domain: string): string {
  return assertPathSegment("domain", domain);
}

function assertSessionId(sessionId: string): string {
  return assertPathSegment("sessionId", sessionId);
}

function assertEvalSlug(evalSlug: string): string {
  return evalSlugSchema.parse(assertPathSegment("evalSlug", evalSlug));
}

function formatDomainScopedPath(domain: string, ...segments: string[]): string {
  const safeDomain = assertDomainSegment(domain);
  const scoped = formatWorkspacePath(safeDomain, ...segments);
  return assertRepoRelativePath(scoped);
}

function formatSessionScopedPath(
  domain: string,
  sessionId: string,
  ...segments: string[]
): string {
  const safeSessionId = assertSessionId(sessionId);
  return formatDomainScopedPath(
    domain,
    VORATIQ_SESSIONS_DIRNAME,
    safeSessionId,
    ...segments,
  );
}

function formatAgentSessionScopedPath(
  domain: string,
  sessionId: string,
  agentId: string,
  ...segments: string[]
): string {
  const safeAgentId = agentIdSchema.parse(agentId);
  return formatSessionScopedPath(domain, sessionId, safeAgentId, ...segments);
}

function formatRunScopedPath(runId: string, ...segments: string[]): string {
  const safeRunId = assertPathSegment("runId", runId);
  const scoped = formatDomainScopedPath(
    VORATIQ_RUNS_DIR,
    VORATIQ_SESSIONS_DIRNAME,
    safeRunId,
    ...segments,
  );
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

export function getDomainDirectoryPath(domain: string): string {
  return formatDomainScopedPath(domain);
}

export function getDomainIndexPath(domain: string): string {
  return formatDomainScopedPath(domain, VORATIQ_INDEX_FILENAME);
}

export function getDomainHistoryLockPath(domain: string): string {
  return formatDomainScopedPath(domain, VORATIQ_HISTORY_LOCK_FILENAME);
}

export function getSpecsDirectoryPath(): string {
  return getDomainDirectoryPath(VORATIQ_SPECS_DIR);
}

export function getSpecsIndexPath(): string {
  return getDomainIndexPath(VORATIQ_SPECS_DIR);
}

export function getSpecsHistoryLockPath(): string {
  return getDomainHistoryLockPath(VORATIQ_SPECS_DIR);
}

export function getSpecsSessionsDirectoryPath(): string {
  return getDomainSessionsDirectoryPath(VORATIQ_SPECS_DIR);
}

export function getDomainSessionsDirectoryPath(domain: string): string {
  return formatDomainScopedPath(domain, VORATIQ_SESSIONS_DIRNAME);
}

export function getSessionDirectoryPath(
  domain: string,
  sessionId: string,
): string {
  return formatSessionScopedPath(domain, sessionId);
}

export function getSpecSessionDirectoryPath(sessionId: string): string {
  return getSessionDirectoryPath(VORATIQ_SPECS_DIR, sessionId);
}

export function getAgentSessionDirectoryPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(domain, sessionId, agentId);
}

export function getSpecAgentSessionDirectoryPath(
  sessionId: string,
  agentId: string,
): string {
  return getAgentSessionDirectoryPath(VORATIQ_SPECS_DIR, sessionId, agentId);
}

export function getAgentSessionManifestPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    RUNTIME_DIRNAME,
    MANIFEST_FILENAME,
  );
}

export function getAgentSessionRuntimeDirectoryPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    RUNTIME_DIRNAME,
  );
}

export function getAgentSessionWorkspaceDirectoryPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    WORKSPACE_DIRNAME,
  );
}

export function getAgentSessionArtifactsDirectoryPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    ARTIFACTS_DIRNAME,
  );
}

export function getAgentSessionStdoutPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    ARTIFACTS_DIRNAME,
    STDOUT_FILENAME,
  );
}

export function getAgentSessionStderrPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    ARTIFACTS_DIRNAME,
    STDERR_FILENAME,
  );
}

export function getAgentSessionDiffPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    ARTIFACTS_DIRNAME,
    DIFF_FILENAME,
  );
}

export function getAgentSessionSummaryPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    ARTIFACTS_DIRNAME,
    SUMMARY_FILENAME,
  );
}

export function getAgentSessionReviewPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    ARTIFACTS_DIRNAME,
    REVIEW_FILENAME,
  );
}

export function getAgentSessionChatArtifactPath(
  domain: string,
  sessionId: string,
  agentId: string,
  format: ChatArtifactFormat,
): string {
  const filename = format === "json" ? CHAT_JSON_FILENAME : CHAT_JSONL_FILENAME;
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    ARTIFACTS_DIRNAME,
    filename,
  );
}

export function getAgentSessionEvalsDirectoryPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    EVALS_DIRNAME,
  );
}

export function getAgentSessionEvalLogPath(
  domain: string,
  sessionId: string,
  agentId: string,
  evalSlug: string,
): string {
  const safeSlug = assertEvalSlug(evalSlug);
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    EVALS_DIRNAME,
    `${safeSlug}.log`,
  );
}

export function getAgentSessionSandboxDirectoryPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    SANDBOX_DIRNAME,
  );
}

export function getAgentSessionSandboxHomePath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return getAgentSessionSandboxDirectoryPath(domain, sessionId, agentId);
}

export function getAgentSessionSandboxSettingsPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    RUNTIME_DIRNAME,
    SANDBOX_SETTINGS_FILENAME,
  );
}

export function getRunDirectoryPath(runId: string): string {
  return formatRunScopedPath(runId);
}

export function getAgentDirectoryPath(runId: string, agentId: string): string {
  return formatAgentScopedPath(runId, agentId);
}

export function getAgentManifestPath(runId: string, agentId: string): string {
  return getAgentSessionManifestPath(VORATIQ_RUNS_DIR, runId, agentId);
}

export function getAgentRuntimeDirectoryPath(
  runId: string,
  agentId: string,
): string {
  return getAgentSessionRuntimeDirectoryPath(VORATIQ_RUNS_DIR, runId, agentId);
}

export function getAgentWorkspaceDirectoryPath(
  runId: string,
  agentId: string,
): string {
  return getAgentSessionWorkspaceDirectoryPath(
    VORATIQ_RUNS_DIR,
    runId,
    agentId,
  );
}

export function getAgentArtifactsDirectoryPath(
  runId: string,
  agentId: string,
): string {
  return getAgentSessionArtifactsDirectoryPath(
    VORATIQ_RUNS_DIR,
    runId,
    agentId,
  );
}

export function getAgentStdoutPath(runId: string, agentId: string): string {
  return getAgentSessionStdoutPath(VORATIQ_RUNS_DIR, runId, agentId);
}

export function getAgentStderrPath(runId: string, agentId: string): string {
  return getAgentSessionStderrPath(VORATIQ_RUNS_DIR, runId, agentId);
}

export function getAgentDiffPath(runId: string, agentId: string): string {
  return getAgentSessionDiffPath(VORATIQ_RUNS_DIR, runId, agentId);
}

export function getAgentSummaryPath(runId: string, agentId: string): string {
  return getAgentSessionSummaryPath(VORATIQ_RUNS_DIR, runId, agentId);
}

export function getAgentReviewPath(runId: string, agentId: string): string {
  return getAgentSessionReviewPath(VORATIQ_RUNS_DIR, runId, agentId);
}

export function getAgentChatArtifactPath(
  runId: string,
  agentId: string,
  format: ChatArtifactFormat,
): string {
  return getAgentSessionChatArtifactPath(
    VORATIQ_RUNS_DIR,
    runId,
    agentId,
    format,
  );
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
  return getAgentSessionEvalsDirectoryPath(VORATIQ_RUNS_DIR, runId, agentId);
}

export function getAgentEvalLogPath(
  runId: string,
  agentId: string,
  evalSlug: string,
): string {
  return getAgentSessionEvalLogPath(VORATIQ_RUNS_DIR, runId, agentId, evalSlug);
}

export function getAgentSandboxDirectoryPath(
  runId: string,
  agentId: string,
): string {
  return getAgentSessionSandboxDirectoryPath(VORATIQ_RUNS_DIR, runId, agentId);
}

export function getAgentSandboxHomePath(
  runId: string,
  agentId: string,
): string {
  return getAgentSessionSandboxHomePath(VORATIQ_RUNS_DIR, runId, agentId);
}

export function getAgentSandboxSettingsPath(
  runId: string,
  agentId: string,
): string {
  return getAgentSessionSandboxSettingsPath(VORATIQ_RUNS_DIR, runId, agentId);
}
