import type { ChatArtifactFormat } from "./chat/types.js";
import {
  ARTIFACTS_DIRNAME,
  CHAT_JSON_FILENAME,
  CHAT_JSONL_FILENAME,
  DIFF_FILENAME,
  MANIFEST_FILENAME,
  PROGRAMMATIC_RESULT_FILENAME,
  RUNTIME_DIRNAME,
  SANDBOX_DIRNAME,
  SANDBOX_SETTINGS_FILENAME,
  STDERR_FILENAME,
  STDOUT_FILENAME,
  SUMMARY_FILENAME,
  VORATIQ_RUN_DIR,
  VORATIQ_VERIFICATION_DIR,
} from "./constants.js";
import {
  assertPathSegment,
  formatAgentSessionScopedPath,
  formatSessionScopedPath,
} from "./path-formatters.js";
import {
  getAgentSessionArtifactsDirectoryPath,
  getAgentSessionContextDirectoryPath,
  getAgentSessionWorkspaceDirectoryPath,
} from "./session-paths.js";

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
  const safeTemplate = assertPathSegment("segment", template);
  return formatAgentSessionScopedPath(
    VORATIQ_VERIFICATION_DIR,
    sessionId,
    verifierId,
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
  const safeTemplate = assertPathSegment("segment", template);
  return formatAgentSessionScopedPath(
    VORATIQ_VERIFICATION_DIR,
    sessionId,
    verifierId,
    safeTemplate,
  );
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
