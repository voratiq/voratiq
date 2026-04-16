import {
  ARTIFACTS_DIRNAME,
  CONTEXT_DIRNAME,
  VORATIQ_HISTORY_LOCK_FILENAME,
  VORATIQ_INDEX_FILENAME,
  VORATIQ_INTERACTIVE_DIR,
  VORATIQ_MESSAGE_DIR,
  VORATIQ_REDUCTION_DIR,
  VORATIQ_SESSIONS_DIRNAME,
  VORATIQ_SPEC_DIR,
  VORATIQ_VERIFICATION_DIR,
  WORKSPACE_DIRNAME,
} from "./constants.js";
import {
  formatAgentScopedPath,
  formatAgentSessionScopedPath,
  formatDomainScopedPath,
  formatRunScopedPath,
  formatSessionScopedPath,
} from "./path-formatters.js";

function getDomainIndexPath(domain: string): string {
  return formatDomainScopedPath(domain, VORATIQ_INDEX_FILENAME);
}

export function getInteractiveIndexPath(): string {
  return getDomainIndexPath(VORATIQ_INTERACTIVE_DIR);
}

export function getInteractiveHistoryLockPath(): string {
  return formatDomainScopedPath(
    VORATIQ_INTERACTIVE_DIR,
    VORATIQ_HISTORY_LOCK_FILENAME,
  );
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

function getDomainSessionsDirectoryPath(domain: string): string {
  return formatDomainScopedPath(domain, VORATIQ_SESSIONS_DIRNAME);
}

function getSessionDirectoryPath(domain: string, sessionId: string): string {
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

export function getAgentSessionDirectoryPath(
  domain: string,
  sessionId: string,
  agentId: string,
): string {
  return formatAgentSessionScopedPath(domain, sessionId, agentId);
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

export function getRunDirectoryPath(runId: string): string {
  return formatRunScopedPath(runId);
}

export function getAgentDirectoryPath(runId: string, agentId: string): string {
  return formatAgentScopedPath(runId, agentId);
}
