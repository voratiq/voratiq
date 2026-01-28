import { readFile } from "node:fs/promises";

import {
  CLAUDE_OAUTH_RELOGIN_HINT,
  CLAUDE_PROVIDER_ID,
} from "../../auth/providers/claude/constants.js";

const GEMINI_PROVIDER_ID = "gemini" as const;
const CODEX_PROVIDER_ID = "codex" as const;

const CLAUDE_FAILURE_PATTERNS = [
  /Please run \/login/i,
  /OAuth token has expired/i,
];

const JSON_MESSAGE_PATTERN = /"message"\s*:\s*"((?:\\.|[^"\\])*)"/;

export interface AgentFailureDetectionInput {
  provider: string;
  stdoutPath: string;
  stderrPath: string;
}

export async function detectAgentProcessFailureDetail(
  input: AgentFailureDetectionInput,
): Promise<string | undefined> {
  if (
    input.provider !== CLAUDE_PROVIDER_ID &&
    input.provider !== GEMINI_PROVIDER_ID &&
    input.provider !== CODEX_PROVIDER_ID
  ) {
    return undefined;
  }

  const combinedLogs = await readCombinedLogs(
    input.stdoutPath,
    input.stderrPath,
  );

  if (!combinedLogs) {
    return undefined;
  }

  if (input.provider === CLAUDE_PROVIDER_ID) {
    if (CLAUDE_FAILURE_PATTERNS.some((pattern) => pattern.test(combinedLogs))) {
      return CLAUDE_OAUTH_RELOGIN_HINT;
    }

    return undefined;
  }

  if (input.provider === GEMINI_PROVIDER_ID) {
    return (
      extractFirstJsonMessage(combinedLogs) ??
      extractGeminiFallbackLine(combinedLogs)
    );
  }

  if (input.provider === CODEX_PROVIDER_ID) {
    return (
      extractFirstJsonMessage(combinedLogs) ??
      findFirstMatchingLine(combinedLogs, [
        /invalid_request_error/,
        /unsupported_value/,
        /thread .* panicked/i,
      ])
    );
  }

  return undefined;
}

function extractFirstJsonMessage(text: string): string | undefined {
  const match = JSON_MESSAGE_PATTERN.exec(text);
  if (!match) {
    return undefined;
  }

  const raw = match[1]?.trim();
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(`"${raw}"`) as string;
    return isMeaningfulMessage(parsed) ? parsed : undefined;
  } catch {
    return isMeaningfulMessage(raw) ? raw : undefined;
  }
}

function isMeaningfulMessage(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) {
    return false;
  }
  if (normalized === "[object Object]") {
    return false;
  }
  return true;
}

function findFirstMatchingLine(
  text: string,
  matchers: RegExp[],
): string | undefined {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const matcher of matchers) {
      const match = matcher.exec(trimmed);
      if (match) {
        return trimmed.slice(match.index).trim();
      }
    }
  }
  return undefined;
}

function extractGeminiFallbackLine(text: string): string | undefined {
  return findFirstMatchingLine(text, [
    /TerminalQuotaError:/,
    /PERMISSION_DENIED/,
    /RESOURCE_EXHAUSTED/,
    /No capacity available/i,
    /You have exhausted your capacity/i,
    /exhausted your capacity/i,
  ]);
}

async function readCombinedLogs(
  stdoutPath: string,
  stderrPath: string,
): Promise<string> {
  const [stdout, stderr] = await Promise.all([
    safeRead(stdoutPath),
    safeRead(stderrPath),
  ]);
  return `${stdout}\n${stderr}`;
}

async function safeRead(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}
