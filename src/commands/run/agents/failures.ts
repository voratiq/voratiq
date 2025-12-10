import { readFile } from "node:fs/promises";

import {
  CLAUDE_OAUTH_RELOGIN_HINT,
  CLAUDE_PROVIDER_ID,
} from "../../../auth/providers/claude/constants.js";

const CLAUDE_FAILURE_PATTERNS = [
  /Please run \/login/i,
  /OAuth token has expired/i,
];

export interface AgentFailureDetectionInput {
  agentId: string;
  provider: string;
  stdoutPath: string;
  stderrPath: string;
}

export async function detectAgentProcessFailureDetail(
  input: AgentFailureDetectionInput,
): Promise<string | undefined> {
  if (input.provider !== CLAUDE_PROVIDER_ID) {
    return undefined;
  }

  const combinedLogs = await readCombinedLogs(
    input.stdoutPath,
    input.stderrPath,
  );
  if (
    combinedLogs &&
    CLAUDE_FAILURE_PATTERNS.some((pattern) => pattern.test(combinedLogs))
  ) {
    return CLAUDE_OAUTH_RELOGIN_HINT;
  }

  return undefined;
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
