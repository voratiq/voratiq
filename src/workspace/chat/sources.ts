import { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";

import { isMissing } from "../../utils/fs.js";
import { SANDBOX_DIRNAME } from "../structure.js";

type SupportedProvider = "claude" | "codex" | "gemini";

export interface ProviderTranscriptSearchOptions {
  agentRoot: string;
  env?: NodeJS.ProcessEnv;
}

export type TranscriptLocator = (
  options: ProviderTranscriptSearchOptions,
) => Promise<readonly string[]>;

const locatorMap: Record<SupportedProvider, TranscriptLocator> = {
  claude: findClaudeTranscripts,
  codex: findCodexTranscripts,
  gemini: findGeminiTranscripts,
};

export async function findProviderTranscripts(
  providerId: string,
  options: ProviderTranscriptSearchOptions,
): Promise<readonly string[]> {
  const locator = locatorMap[providerId as SupportedProvider];
  if (!locator) {
    return [];
  }
  return locator(options);
}

export async function findClaudeTranscripts(
  options: ProviderTranscriptSearchOptions,
): Promise<readonly string[]> {
  return await collectFilesFromRoots(resolveClaudeTranscriptRoots(options), {
    extensions: [".jsonl"],
    maxDepth: 2,
  });
}

export async function findCodexTranscripts(
  options: ProviderTranscriptSearchOptions,
): Promise<readonly string[]> {
  return await collectFilesFromRoots(resolveCodexTranscriptRoots(options), {
    extensions: [".jsonl"],
    maxDepth: 6,
  });
}

export async function findGeminiTranscripts(
  options: ProviderTranscriptSearchOptions,
): Promise<readonly string[]> {
  const transcripts = new Set<string>();
  for (const tmpRoot of resolveGeminiTranscriptRoots(options)) {
    const entries = await safeReadDir(tmpRoot);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const chatsDir = resolvePath(tmpRoot, entry.name, "chats");
      const chatFiles = await collectFiles(chatsDir, {
        extensions: [".json", ".jsonl"],
        maxDepth: 1,
      });
      for (const file of chatFiles) {
        transcripts.add(file);
      }
    }
  }
  return [...transcripts].sort();
}

function resolveSandboxPath(agentRoot: string, ...segments: string[]): string {
  return resolvePath(agentRoot, SANDBOX_DIRNAME, ...segments);
}

function resolveCodexTranscriptRoots(
  options: ProviderTranscriptSearchOptions,
): readonly string[] {
  return resolveTranscriptRoots(options, {
    sandboxSegments: [".codex", "sessions"],
    envVar: "CODEX_HOME",
    defaultSubdir: ".codex",
    suffix: ["sessions"],
  });
}

function resolveClaudeTranscriptRoots(
  options: ProviderTranscriptSearchOptions,
): readonly string[] {
  return resolveTranscriptRoots(options, {
    sandboxSegments: [".claude", "projects"],
    envVar: "CLAUDE_CONFIG_DIR",
    defaultSubdir: ".claude",
    suffix: ["projects"],
  });
}

function resolveGeminiTranscriptRoots(
  options: ProviderTranscriptSearchOptions,
): readonly string[] {
  return resolveTranscriptRoots(options, {
    sandboxSegments: [".gemini", "tmp"],
    defaultSubdir: ".gemini",
    suffix: ["tmp"],
  });
}

function resolveTranscriptRoots(
  options: ProviderTranscriptSearchOptions,
  config: {
    sandboxSegments: readonly string[];
    envVar?: string;
    defaultSubdir: string;
    suffix: readonly string[];
  },
): readonly string[] {
  const roots = new Set<string>();
  roots.add(resolveSandboxPath(options.agentRoot, ...config.sandboxSegments));

  if (options.env) {
    const ambientRoot = resolveAmbientProviderRoot(options.env, {
      envVar: config.envVar,
      defaultSubdir: config.defaultSubdir,
    });
    if (ambientRoot) {
      roots.add(resolvePath(ambientRoot, ...config.suffix));
    }
  }

  return [...roots];
}

function resolveAmbientProviderRoot(
  env: NodeJS.ProcessEnv,
  config: {
    envVar?: string;
    defaultSubdir: string;
  },
): string | undefined {
  const configured = config.envVar ? env[config.envVar]?.trim() : undefined;
  const home = env.HOME?.trim();

  if (configured) {
    return isAbsolute(configured)
      ? configured
      : home
        ? resolvePath(home, configured)
        : resolvePath(process.cwd(), configured);
  }

  if (!home) {
    return undefined;
  }
  return resolvePath(home, config.defaultSubdir);
}

async function collectFilesFromRoots(
  roots: readonly string[],
  options: CollectOptions,
): Promise<string[]> {
  const results = new Set<string>();
  for (const root of roots) {
    const files = await collectFiles(root, options);
    for (const file of files) {
      results.add(file);
    }
  }
  return [...results].sort();
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
