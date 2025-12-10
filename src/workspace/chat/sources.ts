import { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { isMissing } from "../../utils/fs.js";
import { SANDBOX_DIRNAME } from "../structure.js";

type SupportedProvider = "claude" | "codex" | "gemini";

export type TranscriptLocator = (
  agentRoot: string,
) => Promise<readonly string[]>;

const locatorMap: Record<SupportedProvider, TranscriptLocator> = {
  claude: findClaudeTranscripts,
  codex: findCodexTranscripts,
  gemini: findGeminiTranscripts,
};

export async function findProviderTranscripts(
  providerId: string,
  agentRoot: string,
): Promise<readonly string[]> {
  const locator = locatorMap[providerId as SupportedProvider];
  if (!locator) {
    return [];
  }
  return locator(agentRoot);
}

export async function findClaudeTranscripts(
  agentRoot: string,
): Promise<readonly string[]> {
  const projectsRoot = resolveSandboxPath(agentRoot, ".claude", "projects");
  return collectFiles(projectsRoot, {
    extensions: [".jsonl"],
    maxDepth: 2,
  });
}

export async function findCodexTranscripts(
  agentRoot: string,
): Promise<readonly string[]> {
  const sessionsRoot = resolveSandboxPath(agentRoot, ".codex", "sessions");
  return collectFiles(sessionsRoot, { extensions: [".jsonl"], maxDepth: 6 });
}

export async function findGeminiTranscripts(
  agentRoot: string,
): Promise<readonly string[]> {
  const tmpRoot = resolveSandboxPath(agentRoot, ".gemini", "tmp");
  const entries = await safeReadDir(tmpRoot);
  const transcripts: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const chatsDir = resolvePath(tmpRoot, entry.name, "chats");
    const chatFiles = await collectFiles(chatsDir, {
      extensions: [".json", ".jsonl"],
      maxDepth: 1,
    });
    transcripts.push(...chatFiles);
  }
  return transcripts.sort();
}

function resolveSandboxPath(agentRoot: string, ...segments: string[]): string {
  return resolvePath(agentRoot, SANDBOX_DIRNAME, ...segments);
}

interface CollectOptions {
  extensions: readonly string[];
  maxDepth?: number;
}

async function collectFiles(
  root: string,
  { extensions, maxDepth = Number.POSITIVE_INFINITY }: CollectOptions,
): Promise<string[]> {
  const results: string[] = [];
  await traverse(root, 0);
  results.sort();
  return results;

  async function traverse(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }
    const entries = await safeReadDir(current);
    for (const entry of entries) {
      const entryPath = resolvePath(current, entry.name);
      if (entry.isDirectory()) {
        await traverse(entryPath, depth + 1);
        continue;
      }
      if (extensions.some((extension) => entry.name.endsWith(extension))) {
        results.push(entryPath);
      }
    }
  }
}

async function safeReadDir(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }
}
