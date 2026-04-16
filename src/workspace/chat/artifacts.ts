import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { finished } from "node:stream/promises";

import { pathExists } from "../../utils/fs.js";
import {
  ARTIFACTS_DIRNAME,
  CHAT_JSON_FILENAME,
  CHAT_JSONL_FILENAME,
} from "../constants.js";
import { findProviderTranscripts } from "./sources.js";
import type { ChatArtifactFormat } from "./types.js";

export type ChatArtifactStatus =
  | "captured"
  | "already-exists"
  | "not-found"
  | "error";

export interface ChatArtifactCaptureResult {
  status: ChatArtifactStatus;
  artifactPath?: string;
  format?: ChatArtifactFormat;
  sourceCount?: number;
  error?: unknown;
}

export interface PreserveChatArtifactsOptions {
  providerId: string;
  agentRoot: string;
  searchEnv?: NodeJS.ProcessEnv;
  baseline?: ProviderTranscriptBaseline;
  selectionHint?: ProviderTranscriptSelectionHint;
}

export interface ProviderTranscriptSnapshotEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

export type ProviderTranscriptBaseline =
  readonly ProviderTranscriptSnapshotEntry[];

export interface CodexSessionMetaSelectionHint {
  strategy: "codex-session-meta";
  cwd: string;
  minStartedAt?: string;
}

export type ProviderTranscriptSelectionHint = CodexSessionMetaSelectionHint;

export async function snapshotProviderTranscripts(
  options: Omit<PreserveChatArtifactsOptions, "baseline">,
): Promise<ProviderTranscriptBaseline> {
  const transcriptPaths = await findProviderTranscripts(options.providerId, {
    agentRoot: options.agentRoot,
    env: options.searchEnv,
  });
  return await collectTranscriptSnapshot(transcriptPaths);
}

export async function preserveProviderChatTranscripts(
  options: PreserveChatArtifactsOptions,
): Promise<ChatArtifactCaptureResult> {
  const { providerId, agentRoot } = options;
  if (!providerId) {
    return { status: "not-found" };
  }

  let transcriptPaths: readonly string[];
  try {
    transcriptPaths = await findProviderTranscripts(providerId, {
      agentRoot,
      env: options.searchEnv,
    });
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  let candidatePaths: readonly string[];
  try {
    candidatePaths = await filterTranscriptPathsAgainstBaseline(
      transcriptPaths,
      options.baseline,
    );
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  const existing: { path: string; format: ChatArtifactFormat } | undefined =
    await locateExistingChatArtifact(agentRoot);

  let selection: TranscriptSelection | undefined;
  try {
    selection = await selectTranscriptFiles({
      providerId,
      transcriptPaths: candidatePaths,
      selectionHint: options.selectionHint,
    });
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  if (!selection) {
    if (existing !== undefined) {
      return {
        status: "already-exists",
        artifactPath: existing.path,
        format: existing.format,
      };
    }
    return { status: "not-found" };
  }
  const { format: selectionFormat, files } = selection;

  const artifactPath = resolve(
    agentRoot,
    ARTIFACTS_DIRNAME,
    selectionFormat === "json" ? CHAT_JSON_FILENAME : CHAT_JSONL_FILENAME,
  );

  try {
    await mkdir(dirname(artifactPath), { recursive: true });
    if (selectionFormat === "json") {
      await bundleJsonTranscripts({
        files,
        artifactPath,
        agentRoot,
        providerId,
      });
    } else {
      await concatenateJsonlTranscripts(files, artifactPath);
    }
    return {
      status: existing ? "already-exists" : "captured",
      artifactPath,
      format: selectionFormat,
      sourceCount: files.length,
    };
  } catch (error) {
    await rm(artifactPath, { force: true }).catch(() => {});
    return {
      status: "error",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

async function locateExistingChatArtifact(
  agentRoot: string,
): Promise<{ path: string; format: ChatArtifactFormat } | undefined> {
  const candidates: Array<{ path: string; format: ChatArtifactFormat }> = [
    {
      path: resolve(agentRoot, ARTIFACTS_DIRNAME, CHAT_JSONL_FILENAME),
      format: "jsonl",
    },
    {
      path: resolve(agentRoot, ARTIFACTS_DIRNAME, CHAT_JSON_FILENAME),
      format: "json",
    },
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate.path)) {
      return candidate;
    }
  }
  return undefined;
}

interface TranscriptSelection {
  format: ChatArtifactFormat;
  files: readonly string[];
}

async function selectTranscriptFiles(options: {
  providerId: string;
  transcriptPaths: readonly string[];
  selectionHint?: ProviderTranscriptSelectionHint;
}): Promise<TranscriptSelection | undefined> {
  const { providerId, transcriptPaths, selectionHint } = options;
  const jsonlFiles = transcriptPaths.filter((path) =>
    path.toLowerCase().endsWith(".jsonl"),
  );
  if (jsonlFiles.length > 0) {
    const selectedJsonlFiles = await filterJsonlTranscriptFilesByHint({
      providerId,
      files: jsonlFiles,
      selectionHint,
    });
    if (selectedJsonlFiles.length > 0) {
      return { format: "jsonl", files: selectedJsonlFiles };
    }
    if (selectionHint) {
      return undefined;
    }
  }

  const jsonFiles = transcriptPaths
    .filter((path) => path.toLowerCase().endsWith(".json"))
    .sort();
  if (jsonFiles.length > 0) {
    return { format: "json", files: jsonFiles };
  }

  return undefined;
}

async function filterJsonlTranscriptFilesByHint(options: {
  providerId: string;
  files: readonly string[];
  selectionHint?: ProviderTranscriptSelectionHint;
}): Promise<readonly string[]> {
  const sortedFiles = [...options.files].sort();
  const hint = options.selectionHint;
  if (!hint) {
    return sortedFiles;
  }

  if (
    options.providerId !== "codex" ||
    hint.strategy !== "codex-session-meta"
  ) {
    return sortedFiles;
  }

  const matchingFiles: string[] = [];
  for (const file of sortedFiles) {
    const metadata = await readCodexSessionMetadata(file);
    if (!metadata) {
      continue;
    }
    if (metadata.cwd !== hint.cwd) {
      continue;
    }
    if (
      hint.minStartedAt &&
      metadata.startedAt &&
      metadata.startedAt < hint.minStartedAt
    ) {
      continue;
    }
    matchingFiles.push(file);
  }

  if (matchingFiles.length === 1) {
    return matchingFiles;
  }
  if (matchingFiles.length > 1) {
    throw new Error(
      `Ambiguous Codex transcript provenance for cwd \`${hint.cwd}\`: ${matchingFiles.join(", ")}`,
    );
  }
  return [];
}

interface CodexSessionMetadata {
  cwd?: string;
  startedAt?: string;
}

async function readCodexSessionMetadata(
  path: string,
): Promise<CodexSessionMetadata | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }

  const lines = raw.split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }

    const record = parsed as {
      type?: unknown;
      payload?: {
        cwd?: unknown;
        timestamp?: unknown;
        payload?: {
          cwd?: unknown;
          timestamp?: unknown;
        };
      };
    };
    if (record.type !== "session_meta") {
      continue;
    }

    const payload = record.payload?.payload ?? record.payload;
    return {
      cwd: typeof payload?.cwd === "string" ? payload.cwd : undefined,
      startedAt:
        typeof payload?.timestamp === "string" ? payload.timestamp : undefined,
    };
  }

  return undefined;
}

async function bundleJsonTranscripts(options: {
  files: readonly string[];
  artifactPath: string;
  agentRoot: string;
  providerId: string;
}): Promise<void> {
  const { files, artifactPath, agentRoot, providerId } = options;
  if (files.length === 0) {
    throw new Error("No JSON transcripts available to bundle");
  }

  const transcripts = [];
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    transcripts.push({
      source: toArtifactSourcePath(agentRoot, file),
      payload: parseJsonOrString(raw),
    });
  }

  const payload = {
    provider: providerId,
    collectedAt: new Date().toISOString(),
    transcripts,
  };
  await writeFile(
    artifactPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

async function concatenateJsonlTranscripts(
  files: readonly string[],
  artifactPath: string,
): Promise<void> {
  const writer = createWriteStream(artifactPath, {
    flags: "w",
    encoding: "utf8",
  });

  try {
    for (const file of files) {
      await appendFileContents(file, writer);
    }
    writer.end();
    await finished(writer);
  } catch (error) {
    writer.destroy();
    throw error;
  }
}

async function appendFileContents(
  sourcePath: string,
  writer: ReturnType<typeof createWriteStream>,
): Promise<void> {
  const reader = createReadStream(sourcePath, { encoding: "utf8" });
  let endsWithNewline = false;
  for await (const chunk of reader as AsyncIterable<string>) {
    endsWithNewline = chunk.endsWith("\n");
    if (!writer.write(chunk)) {
      await once(writer, "drain");
    }
  }

  if (!endsWithNewline) {
    if (!writer.write("\n")) {
      await once(writer, "drain");
    }
  }
}

function parseJsonOrString(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content;
  }
}

async function collectTranscriptSnapshot(
  transcriptPaths: readonly string[],
): Promise<ProviderTranscriptBaseline> {
  const snapshots: ProviderTranscriptSnapshotEntry[] = [];
  for (const path of transcriptPaths) {
    try {
      const details = await stat(path);
      if (!details.isFile()) {
        continue;
      }
      snapshots.push({
        path,
        size: details.size,
        mtimeMs: details.mtimeMs,
      });
    } catch {
      continue;
    }
  }
  snapshots.sort((left, right) => left.path.localeCompare(right.path));
  return snapshots;
}

async function filterTranscriptPathsAgainstBaseline(
  transcriptPaths: readonly string[],
  baseline: ProviderTranscriptBaseline | undefined,
): Promise<readonly string[]> {
  if (!baseline || baseline.length === 0) {
    return transcriptPaths;
  }

  const baselineByPath = new Map(
    baseline.map((entry) => [entry.path, entry] as const),
  );
  const freshPaths: string[] = [];
  for (const path of transcriptPaths) {
    const prior = baselineByPath.get(path);
    if (!prior) {
      freshPaths.push(path);
      continue;
    }

    try {
      const current = await stat(path);
      if (
        !current.isFile() ||
        current.size !== prior.size ||
        current.mtimeMs !== prior.mtimeMs
      ) {
        freshPaths.push(path);
      }
    } catch {
      continue;
    }
  }

  return freshPaths.sort();
}

function toArtifactSourcePath(agentRoot: string, file: string): string {
  const source = relative(agentRoot, file);
  return source.startsWith("..") ? file : source;
}
