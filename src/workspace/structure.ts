import { agentIdSchema } from "../configs/agents/types.js";
import {
  assertRepoRelativePath,
  resolvePathWithinRoot,
} from "../utils/path.js";
import type { ChatArtifactFormat } from "./chat/types.js";

export const VORATIQ_DIR = ".voratiq";
export const VORATIQ_SPEC_DIR = "spec";
export const VORATIQ_SPEC_FILE = "spec/index.json";
export const VORATIQ_SPEC_SESSIONS_DIR = "spec/sessions";
export const VORATIQ_RUN_DIR = "run";
export const VORATIQ_RUN_FILE = "run/index.json";
export const VORATIQ_RUN_SESSIONS_DIR = "run/sessions";
export const VORATIQ_REDUCTION_DIR = "reduce";
export const VORATIQ_REDUCTION_FILE = "reduce/index.json";
export const VORATIQ_REDUCTION_SESSIONS_DIR = "reduce/sessions";
export const VORATIQ_VERIFICATION_DIR = "verify";
export const VORATIQ_VERIFICATION_FILE = "verify/index.json";
export const VORATIQ_VERIFICATION_SESSIONS_DIR = "verify/sessions";
export const VORATIQ_VERIFICATION_TEMPLATES_DIR = "verify/templates";
export const VORATIQ_MESSAGE_DIR = "message";
export const VORATIQ_MESSAGE_FILE = "message/index.json";
export const VORATIQ_MESSAGE_SESSIONS_DIR = "message/sessions";
export const VORATIQ_INTERACTIVE_DIR = "interactive";
export const VORATIQ_INTERACTIVE_FILE = "interactive/index.json";
export const VORATIQ_INTERACTIVE_SESSIONS_DIR = "interactive/sessions";
export const VORATIQ_INDEX_FILENAME = "index.json";
export const VORATIQ_HISTORY_LOCK_FILENAME = "history.lock";
export const VORATIQ_SESSIONS_DIRNAME = "sessions";
export const VORATIQ_AGENTS_FILE = "agents.yaml";
export const VORATIQ_VERIFICATION_CONFIG_FILE = "verification.yaml";
export const VORATIQ_ENVIRONMENT_FILE = "environment.yaml";
export const VORATIQ_SANDBOX_FILE = "sandbox.yaml";
export const VORATIQ_ORCHESTRATION_FILE = "orchestration.yaml";

export const WORKSPACE_DIRNAME = "workspace";
export const CONTEXT_DIRNAME = "context";
export const STDOUT_FILENAME = "stdout.log";
export const STDERR_FILENAME = "stderr.log";
export const DIFF_FILENAME = "diff.patch";
export const SUMMARY_FILENAME = "summary.txt";
export const CHAT_JSON_FILENAME = "chat.json";
export const CHAT_JSONL_FILENAME = "chat.jsonl";
export const REDUCTION_FILENAME = "reduction.md";
export const REDUCTION_DATA_FILENAME = "reduction.json";
export const MESSAGE_RESPONSE_FILENAME = "response.md";
export const RUNTIME_DIRNAME = "runtime";
export const ARTIFACTS_DIRNAME = "artifacts";
export const MANIFEST_FILENAME = "manifest.json";
export const REDUCTION_ARTIFACT_INFO_FILENAME = "artifact-information.json";
export const SANDBOX_DIRNAME = "sandbox";
export const SANDBOX_SETTINGS_FILENAME = "sandbox.json";
export const PROGRAMMATIC_RESULT_FILENAME = "result.json";

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
  label: "runId" | "agentId" | "segment" | "domain" | "sessionId",
  value: string,
): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  if (value.length === 0) {
    throw new Error(`${label} must be non-empty`);
  }
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new Error(`${label} \`${value}\` must not contain path separators`);
  }
  return value;
}

function assertDomainSegment(domain: string): string {
  return assertPathSegment("domain", domain);
}

function assertSessionId(sessionId: string): string {
  return assertPathSegment("sessionId", sessionId);
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
    VORATIQ_RUN_DIR,
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

export function getSpecDirectoryPath(): string {
  return getDomainDirectoryPath(VORATIQ_SPEC_DIR);
}

export function getSpecIndexPath(): string {
  return getDomainIndexPath(VORATIQ_SPEC_DIR);
}

export function getSpecHistoryLockPath(): string {
  return getDomainHistoryLockPath(VORATIQ_SPEC_DIR);
}

export function getSpecSessionsDirectoryPath(): string {
  return getDomainSessionsDirectoryPath(VORATIQ_SPEC_DIR);
}

export function getReductionDirectoryPath(): string {
  return getDomainDirectoryPath(VORATIQ_REDUCTION_DIR);
}

export function getReductionIndexPath(): string {
  return getDomainIndexPath(VORATIQ_REDUCTION_DIR);
}

export function getReductionSessionsDirectoryPath(): string {
  return getDomainSessionsDirectoryPath(VORATIQ_REDUCTION_DIR);
}

export function getVerificationDirectoryPath(): string {
  return getDomainDirectoryPath(VORATIQ_VERIFICATION_DIR);
}

export function getVerificationIndexPath(): string {
  return getDomainIndexPath(VORATIQ_VERIFICATION_DIR);
}

export function getVerificationSessionsDirectoryPath(): string {
  return getDomainSessionsDirectoryPath(VORATIQ_VERIFICATION_DIR);
}

export function getMessageDirectoryPath(): string {
  return getDomainDirectoryPath(VORATIQ_MESSAGE_DIR);
}

export function getMessageIndexPath(): string {
  return getDomainIndexPath(VORATIQ_MESSAGE_DIR);
}

export function getMessageSessionsDirectoryPath(): string {
  return getDomainSessionsDirectoryPath(VORATIQ_MESSAGE_DIR);
}

export function getInteractiveDirectoryPath(): string {
  return getDomainDirectoryPath(VORATIQ_INTERACTIVE_DIR);
}

export function getInteractiveIndexPath(): string {
  return getDomainIndexPath(VORATIQ_INTERACTIVE_DIR);
}

export function getInteractiveHistoryLockPath(): string {
  return formatDomainScopedPath(VORATIQ_INTERACTIVE_DIR, "history.lock");
}

export function getInteractiveSessionsDirectoryPath(): string {
  return getDomainSessionsDirectoryPath(VORATIQ_INTERACTIVE_DIR);
}

export function getInteractiveSessionDirectoryPath(sessionId: string): string {
  return getSessionDirectoryPath(VORATIQ_INTERACTIVE_DIR, sessionId);
}

export function getInteractiveSessionRecordPath(sessionId: string): string {
  return formatSessionScopedPath(
    VORATIQ_INTERACTIVE_DIR,
    sessionId,
    "record.json",
  );
}

export function getInteractiveSessionArtifactsDirectoryPath(
  sessionId: string,
): string {
  return formatSessionScopedPath(
    VORATIQ_INTERACTIVE_DIR,
    sessionId,
    ARTIFACTS_DIRNAME,
  );
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
  return getSessionDirectoryPath(VORATIQ_SPEC_DIR, sessionId);
}

export function getReductionSessionDirectoryPath(sessionId: string): string {
  return getSessionDirectoryPath(VORATIQ_REDUCTION_DIR, sessionId);
}

export function getMessageSessionDirectoryPath(sessionId: string): string {
  return getSessionDirectoryPath(VORATIQ_MESSAGE_DIR, sessionId);
}

export function getVerificationSessionDirectoryPath(sessionId: string): string {
  return getSessionDirectoryPath(VORATIQ_VERIFICATION_DIR, sessionId);
}

export function getVerificationSessionArtifactsDirectoryPath(
  sessionId: string,
): string {
  return formatSessionScopedPath(
    VORATIQ_VERIFICATION_DIR,
    sessionId,
    ARTIFACTS_DIRNAME,
  );
}

export function getVerificationSessionRecordPath(sessionId: string): string {
  return formatSessionScopedPath(
    VORATIQ_VERIFICATION_DIR,
    sessionId,
    "record.json",
  );
}

export function getVerificationProgrammaticResultPath(
  sessionId: string,
): string {
  return formatSessionScopedPath(
    VORATIQ_VERIFICATION_DIR,
    sessionId,
    "programmatic",
    ARTIFACTS_DIRNAME,
    PROGRAMMATIC_RESULT_FILENAME,
  );
}

export function getVerificationRubricResultPath(options: {
  sessionId: string;
  verifierId: string;
  template: string;
}): string {
  const { sessionId, verifierId, template } = options;
  const safeVerifierId = agentIdSchema.parse(verifierId);
  const safeTemplate = assertPathSegment("segment", template);
  return formatAgentSessionScopedPath(
    VORATIQ_VERIFICATION_DIR,
    sessionId,
    safeVerifierId,
    safeTemplate,
    ARTIFACTS_DIRNAME,
    "result.json",
  );
}

export function getVerificationRubricExecutionDirectoryPath(options: {
  sessionId: string;
  verifierId: string;
  template: string;
}): string {
  const { sessionId, verifierId, template } = options;
  const safeVerifierId = agentIdSchema.parse(verifierId);
  const safeTemplate = assertPathSegment("segment", template);
  return formatAgentSessionScopedPath(
    VORATIQ_VERIFICATION_DIR,
    sessionId,
    safeVerifierId,
    safeTemplate,
  );
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
  return getAgentSessionDirectoryPath(VORATIQ_SPEC_DIR, sessionId, agentId);
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

export function getAgentSessionContextDirectoryPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    CONTEXT_DIRNAME,
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

export function getAgentSessionReductionPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    ARTIFACTS_DIRNAME,
    REDUCTION_FILENAME,
  );
}

export function getAgentSessionReductionDataPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(
    domain,
    sessionId,
    agentId,
    ARTIFACTS_DIRNAME,
    REDUCTION_DATA_FILENAME,
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
  return getAgentSessionManifestPath(VORATIQ_RUN_DIR, runId, agentId);
}

export function getAgentRuntimeDirectoryPath(
  runId: string,
  agentId: string,
): string {
  return getAgentSessionRuntimeDirectoryPath(VORATIQ_RUN_DIR, runId, agentId);
}

export function getAgentWorkspaceDirectoryPath(
  runId: string,
  agentId: string,
): string {
  return getAgentSessionWorkspaceDirectoryPath(VORATIQ_RUN_DIR, runId, agentId);
}

export function getAgentContextDirectoryPath(
  runId: string,
  agentId: string,
): string {
  return getAgentSessionContextDirectoryPath(VORATIQ_RUN_DIR, runId, agentId);
}

export function getAgentArtifactsDirectoryPath(
  runId: string,
  agentId: string,
): string {
  return getAgentSessionArtifactsDirectoryPath(VORATIQ_RUN_DIR, runId, agentId);
}

export function getAgentStdoutPath(runId: string, agentId: string): string {
  return getAgentSessionStdoutPath(VORATIQ_RUN_DIR, runId, agentId);
}

export function getAgentStderrPath(runId: string, agentId: string): string {
  return getAgentSessionStderrPath(VORATIQ_RUN_DIR, runId, agentId);
}

export function getAgentDiffPath(runId: string, agentId: string): string {
  return getAgentSessionDiffPath(VORATIQ_RUN_DIR, runId, agentId);
}

export function getAgentSummaryPath(runId: string, agentId: string): string {
  return getAgentSessionSummaryPath(VORATIQ_RUN_DIR, runId, agentId);
}

export function getAgentChatArtifactPath(
  runId: string,
  agentId: string,
  format: ChatArtifactFormat,
): string {
  return getAgentSessionChatArtifactPath(
    VORATIQ_RUN_DIR,
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

export function getAgentSandboxDirectoryPath(
  runId: string,
  agentId: string,
): string {
  return getAgentSessionSandboxDirectoryPath(VORATIQ_RUN_DIR, runId, agentId);
}

export function getAgentSandboxHomePath(
  runId: string,
  agentId: string,
): string {
  return getAgentSessionSandboxHomePath(VORATIQ_RUN_DIR, runId, agentId);
}

export function getAgentSandboxSettingsPath(
  runId: string,
  agentId: string,
): string {
  return getAgentSessionSandboxSettingsPath(VORATIQ_RUN_DIR, runId, agentId);
}
