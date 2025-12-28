import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { finished } from "node:stream/promises";

import { pathExists } from "../../utils/fs.js";
import {
  ARTIFACTS_DIRNAME,
  CHAT_JSON_FILENAME,
  CHAT_JSONL_FILENAME,
} from "../structure.js";
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
    transcriptPaths = await findProviderTranscripts(providerId, agentRoot);
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  const existing: { path: string; format: ChatArtifactFormat } | undefined =
    await locateExistingChatArtifact(agentRoot);

  const selection: TranscriptSelection | undefined =
    selectTranscriptFiles(transcriptPaths);
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

function selectTranscriptFiles(
  transcriptPaths: readonly string[],
): TranscriptSelection | undefined {
  const jsonlFiles = transcriptPaths.filter((path) =>
    path.toLowerCase().endsWith(".jsonl"),
  );
  if (jsonlFiles.length > 0) {
    return { format: "jsonl", files: [...jsonlFiles].sort() };
  }

  const jsonFiles = transcriptPaths
    .filter((path) => path.toLowerCase().endsWith(".json"))
    .sort();
  if (jsonFiles.length > 0) {
    return { format: "json", files: jsonFiles };
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
      source: relative(agentRoot, file),
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
