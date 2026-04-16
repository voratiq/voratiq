import { agentIdSchema } from "../configs/agents/types.js";
import { assertRepoRelativePath } from "../utils/path.js";
import {
  VORATIQ_DIR,
  VORATIQ_RUN_DIR,
  VORATIQ_SESSIONS_DIRNAME,
} from "./constants.js";

export function formatWorkspacePath(...segments: string[]): string {
  return [VORATIQ_DIR, ...segments].join("/");
}

export function assertPathSegment(
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

export function assertDomainSegment(domain: string): string {
  return assertPathSegment("domain", domain);
}

export function assertSessionId(sessionId: string): string {
  return assertPathSegment("sessionId", sessionId);
}

export function formatDomainScopedPath(
  domain: string,
  ...segments: string[]
): string {
  const safeDomain = assertDomainSegment(domain);
  const scoped = formatWorkspacePath(safeDomain, ...segments);
  return assertRepoRelativePath(scoped);
}

export function formatSessionScopedPath(
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

export function formatAgentSessionScopedPath(
  domain: string,
  sessionId: string,
  agentId: string,
  ...segments: string[]
): string {
  const safeAgentId = agentIdSchema.parse(agentId);
  return formatSessionScopedPath(domain, sessionId, safeAgentId, ...segments);
}

export function formatRunScopedPath(
  runId: string,
  ...segments: string[]
): string {
  const safeRunId = assertPathSegment("runId", runId);
  const scoped = formatDomainScopedPath(
    VORATIQ_RUN_DIR,
    VORATIQ_SESSIONS_DIRNAME,
    safeRunId,
    ...segments,
  );
  return assertRepoRelativePath(scoped);
}

export function formatAgentScopedPath(
  runId: string,
  agentId: string,
  ...segments: string[]
): string {
  const safeAgentId = agentIdSchema.parse(agentId);
  return formatRunScopedPath(runId, safeAgentId, ...segments);
}
