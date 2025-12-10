import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { resolve as resolvePathNative } from "node:path";

import type { StageOptions, VerifyOptions } from "../types.js";
import { isMissing, resolveChildPath } from "../utils.js";
import {
  CLAUDE_CONFIG_DIRNAME,
  CLAUDE_CREDENTIAL_FILENAME,
  CLAUDE_LOGIN_HINT,
  CLAUDE_OAUTH_RELOGIN_HINT,
} from "./constants.js";
import { ClaudeAuthProviderError } from "./error.js";

interface ClaudeJsonConfig {
  primaryApiKey?: unknown;
}

interface ClaudeCredentialPayload {
  claudeAiOauth?: ClaudeOauthPayload | null;
}

interface ClaudeOauthPayload {
  accessToken?: unknown;
  refreshToken?: unknown;
  expiresAt?: unknown;
}

export async function locateClaudeCredentials(
  options: VerifyOptions | StageOptions,
): Promise<string | undefined> {
  for (const candidate of resolveClaudeConfigCandidates(options)) {
    const credentialsPath = resolveChildPath(
      candidate,
      CLAUDE_CREDENTIAL_FILENAME,
    );
    try {
      await access(credentialsPath);
      return credentialsPath;
    } catch (error) {
      if (!isMissing(error)) {
        throw new ClaudeAuthProviderError(CLAUDE_LOGIN_HINT, { cause: error });
      }
    }
  }
  return undefined;
}

export async function locateClaudeApiKey(
  options: VerifyOptions | StageOptions,
): Promise<string | undefined> {
  const {
    runtime: { homeDir },
  } = options;

  if (!homeDir) {
    return undefined;
  }

  const configPath = resolveChildPath(homeDir, ".claude.json");
  try {
    const content = await readFile(configPath, "utf8");
    return parseApiKeyFromClaudeConfig(content);
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw new ClaudeAuthProviderError(CLAUDE_LOGIN_HINT, { cause: error });
  }
}

export function parseApiKeyFromClaudeConfig(
  content: string,
): string | undefined {
  let parsed: ClaudeJsonConfig;
  try {
    parsed = JSON.parse(content) as ClaudeJsonConfig;
  } catch (error) {
    throw new ClaudeAuthProviderError(CLAUDE_LOGIN_HINT, { cause: error });
  }

  const key = parsed.primaryApiKey;
  if (typeof key === "string" && key.trim().length > 0) {
    return key.trim();
  }
  return undefined;
}

export function validateClaudeCredentialSecret(secret: string): void {
  const trimmed = secret?.trim();
  if (!trimmed) {
    throw new ClaudeAuthProviderError(buildMissingOauthMessage("empty secret"));
  }

  let parsed: ClaudeCredentialPayload;
  try {
    parsed = JSON.parse(trimmed) as ClaudeCredentialPayload;
  } catch (error) {
    throw new ClaudeAuthProviderError(CLAUDE_LOGIN_HINT, { cause: error });
  }

  const oauth = parsed.claudeAiOauth;
  if (!oauth || typeof oauth !== "object") {
    throw new ClaudeAuthProviderError(
      buildMissingOauthMessage("oauth payload missing"),
    );
  }

  const { accessToken, refreshToken, expiresAt } = oauth;
  if (!isNonEmptyString(accessToken)) {
    throw new ClaudeAuthProviderError(
      buildMissingOauthMessage("access token missing"),
    );
  }
  if (!isNonEmptyString(refreshToken)) {
    throw new ClaudeAuthProviderError(
      buildMissingOauthMessage("refresh token missing"),
    );
  }
  if (!isFiniteTimestamp(expiresAt)) {
    throw new ClaudeAuthProviderError(
      buildMissingOauthMessage("expiry missing"),
    );
  }
}

function resolveClaudeConfigCandidates(
  options: VerifyOptions | StageOptions,
): string[] {
  const {
    runtime: { env, homeDir },
  } = options;

  const candidates: string[] = [];

  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  if (configured) {
    candidates.push(resolvePathNative(configured));
  }

  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg) {
    candidates.push(resolvePathNative(xdg, "claude"));
  }

  if (homeDir) {
    candidates.push(resolveChildPath(homeDir, ".config", "claude"));
    candidates.push(resolveChildPath(homeDir, CLAUDE_CONFIG_DIRNAME));
  }

  return candidates;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteTimestamp(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed);
  }
  return false;
}

function buildMissingOauthMessage(detail: string): string {
  return `${CLAUDE_OAUTH_RELOGIN_HINT} (${detail}).`;
}
