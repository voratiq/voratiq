import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { executeCompetitionWithAdapter } from "../../competition/command-adapter.js";
import { AgentNotFoundError } from "../../configs/agents/errors.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import { loadEnvironmentConfig } from "../../configs/environment/loader.js";
import {
  appendSpecRecord,
  finalizeSpecRecord,
  flushSpecRecordBuffer,
  rewriteSpecRecord,
} from "../../specs/records/persistence.js";
import type { SpecRecord } from "../../specs/records/types.js";
import { toErrorMessage } from "../../utils/errors.js";
import { pathExists } from "../../utils/fs.js";
import {
  assertPathWithinRoot,
  normalizePathForDisplay,
  relativeToRoot,
  resolvePath,
} from "../../utils/path.js";
import { slugify } from "../../utils/slug.js";
import { getSpecsDirectoryPath } from "../../workspace/structure.js";
import { resolveStageCompetitors } from "../shared/resolve-stage-competitors.js";
import { generateSessionId } from "../shared/session-id.js";
import {
  createSpecCompetitionAdapter,
  type SpecCompetitionExecution,
} from "./competition-adapter.js";
import {
  SpecAgentNotFoundError,
  SpecGenerationFailedError,
  SpecOutputExistsError,
  SpecOutputPathError,
} from "./errors.js";

export interface ExecuteSpecCommandInput {
  root: string;
  specsFilePath: string;
  description: string;
  agentId?: string;
  title?: string;
  outputPath?: string;
  onStatus?: (message: string) => void;
}

export interface ExecuteSpecCommandResult {
  sessionId: string;
  slug: string;
  outputPath: string;
  record: SpecRecord;
  exitCode?: number;
}

export async function executeSpecCommand(
  input: ExecuteSpecCommandInput,
): Promise<ExecuteSpecCommandResult> {
  const {
    root,
    specsFilePath,
    description,
    agentId,
    title: providedTitle,
    outputPath: customOutputPath,
    onStatus,
  } = input;

  let agent: AgentDefinition;
  try {
    const resolution = resolveStageCompetitors({
      root,
      stageId: "spec",
      cliAgentIds: agentId ? [agentId] : undefined,
      enforceSingleCompetitor: true,
    });
    const resolvedAgent = resolution.competitors[0];
    if (!resolvedAgent) {
      throw new Error("Expected a single resolved spec agent.");
    }
    agent = resolvedAgent;
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      throw new SpecAgentNotFoundError(error.agentId);
    }
    throw error;
  }
  const environment = loadEnvironmentConfig({ root });

  const specTitle =
    providedTitle && providedTitle.trim().length > 0
      ? providedTitle.trim()
      : undefined;
  let title = deriveTitle(providedTitle, description);
  let slug = slugify(title, "spec");

  const specsRoot = resolvePath(root, getSpecsDirectoryPath());
  const defaultOutputAbsolute = resolvePath(
    root,
    getSpecsDirectoryPath(),
    `${slug}.md`,
  );

  let outputAbsolute = resolveOutputPath({
    root,
    specsRoot,
    customOutputPath,
    defaultPath: defaultOutputAbsolute,
  });

  if (customOutputPath && (await pathExists(outputAbsolute))) {
    const display = normalizePathForDisplay(
      relativeToRoot(root, outputAbsolute),
    );
    throw new SpecOutputExistsError(display);
  }

  await mkdir(dirname(outputAbsolute), { recursive: true });

  const sessionId = generateSessionId();
  const createdAt = new Date().toISOString();

  const record: SpecRecord = {
    sessionId,
    createdAt,
    status: "drafting",
    agentId: agent.id,
    title,
    slug,
    outputPath: normalizePathForDisplay(relativeToRoot(root, outputAbsolute)),
  };

  await appendSpecRecord({
    root,
    specsFilePath,
    record,
  });

  let latestRecord = record;
  onStatus?.("Generating specification...");
  let generationResult: SpecCompetitionExecution;

  try {
    const generationResults = await executeCompetitionWithAdapter({
      candidates: [agent],
      maxParallel: 1,
      adapter: createSpecCompetitionAdapter({
        root,
        sessionId,
        description,
        specTitle,
        environment,
      }),
    });

    const selectedResult = generationResults[0];
    if (!selectedResult) {
      const detail = `Specification session ${sessionId} did not produce any result.`;
      latestRecord = await finalizeSpecRecord({
        root,
        specsFilePath,
        sessionId,
        status: "failed",
        error: detail,
      });
      await flushSpecRecordBuffer({ specsFilePath, sessionId });
      throw new SpecGenerationFailedError([detail]);
    }

    generationResult = selectedResult;
  } catch (error) {
    if (error instanceof SpecGenerationFailedError) {
      throw error;
    }

    const detail = toErrorMessage(error);
    latestRecord = await finalizeSpecRecord({
      root,
      specsFilePath,
      sessionId,
      status: "failed",
      error: detail,
    });
    await flushSpecRecordBuffer({ specsFilePath, sessionId });
    throw new SpecGenerationFailedError([detail]);
  }

  if (generationResult.status === "failed") {
    latestRecord = await finalizeSpecRecord({
      root,
      specsFilePath,
      sessionId,
      status: "failed",
      error: generationResult.error ?? null,
    });
    await flushSpecRecordBuffer({ specsFilePath, sessionId });
    throw new SpecGenerationFailedError(
      generationResult.error ? [generationResult.error] : [],
    );
  }

  let generatedSpecContent: string;
  try {
    generatedSpecContent = await readFile(
      resolvePath(root, generationResult.specPath),
      "utf8",
    );
  } catch (error) {
    const detail = toErrorMessage(error);
    latestRecord = await finalizeSpecRecord({
      root,
      specsFilePath,
      sessionId,
      status: "failed",
      error: detail,
    });
    await flushSpecRecordBuffer({ specsFilePath, sessionId });
    throw new SpecGenerationFailedError([detail]);
  }

  const parsedTitle = deriveTitleFromDraft(generatedSpecContent, description);
  if (parsedTitle !== title) {
    title = parsedTitle;
  }

  latestRecord = await rewriteSpecRecord({
    root,
    specsFilePath,
    sessionId,
    mutate: (existing) => ({
      ...existing,
      title,
    }),
  });

  await rewriteSpecRecord({
    root,
    specsFilePath,
    sessionId,
    mutate: (existing) => ({
      ...existing,
      status: "saving",
    }),
  });

  const handleSaveError = async (error: unknown) => {
    const detail = toErrorMessage(error);
    latestRecord = await finalizeSpecRecord({
      root,
      specsFilePath,
      sessionId,
      status: "failed",
      error: detail,
    });
    await flushSpecRecordBuffer({ specsFilePath, sessionId });
    throw new SpecGenerationFailedError([detail]);
  };

  try {
    if (!customOutputPath) {
      const desiredSlug = slugify(title, "spec");
      const desiredOutputAbsolute = resolveOutputPath({
        root,
        specsRoot,
        customOutputPath,
        defaultPath: resolvePath(
          root,
          getSpecsDirectoryPath(),
          `${desiredSlug}.md`,
        ),
      });
      if (desiredOutputAbsolute !== outputAbsolute) {
        outputAbsolute = await findUniqueOutputPath(desiredOutputAbsolute);
      } else if (await pathExists(outputAbsolute)) {
        outputAbsolute = await findUniqueOutputPath(outputAbsolute);
      }
      slug = desiredSlug;
    } else {
      slug = slugify(title, "spec");
    }

    if (
      latestRecord.slug !== slug ||
      latestRecord.outputPath !==
        normalizePathForDisplay(relativeToRoot(root, outputAbsolute))
    ) {
      latestRecord = await rewriteSpecRecord({
        root,
        specsFilePath,
        sessionId,
        mutate: (existing) => ({
          ...existing,
          slug,
          outputPath: normalizePathForDisplay(
            relativeToRoot(root, outputAbsolute),
          ),
        }),
      });
    }

    await mkdir(dirname(outputAbsolute), { recursive: true });
    await writeFile(outputAbsolute, generatedSpecContent, "utf8");
    latestRecord = await finalizeSpecRecord({
      root,
      specsFilePath,
      sessionId,
      status: "saved",
    });
  } catch (error) {
    await handleSaveError(error);
  }

  await flushSpecRecordBuffer({ specsFilePath, sessionId });

  return {
    sessionId,
    slug,
    outputPath: latestRecord.outputPath,
    record: latestRecord,
  };
}

function deriveTitle(
  provided: string | undefined,
  description: string,
): string {
  if (provided && provided.trim().length > 0) {
    return provided.trim();
  }

  const firstLine = description.trim().split("\n")[0] ?? "";
  const truncated = firstLine.slice(0, 80).trim();
  return truncated.length > 0 ? truncated : "Untitled Spec";
}

function deriveTitleFromDraft(draft: string, description: string): string {
  const fromDraft = extractTitleFromDraft(draft);
  if (fromDraft) {
    return fromDraft;
  }
  return deriveTitle(undefined, description);
}

function extractTitleFromDraft(draft: string): string | undefined {
  const lines = draft.split(/\r?\n/);
  let inCodeBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      continue;
    }
    const match = /^\s*#\s+(.+?)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const sanitized = sanitizeSpecTitle(match[1] ?? "");
    if (sanitized.length > 0) {
      return sanitized;
    }
  }
  return undefined;
}

function sanitizeSpecTitle(value: string): string {
  const withoutHashSuffix = value.replace(/\s+#+\s*$/g, "");
  const withoutLinks = withoutHashSuffix.replace(
    /\[([^\]]+)\]\([^)]+\)/g,
    "$1",
  );
  const normalized = withoutLinks
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length === 0) {
    return "";
  }
  return normalized.slice(0, 80).trim();
}

function resolveOutputPath(options: {
  root: string;
  specsRoot: string;
  customOutputPath?: string;
  defaultPath: string;
}): string {
  const { root, specsRoot, customOutputPath, defaultPath } = options;

  if (!customOutputPath) {
    return defaultPath;
  }

  const absolute = customOutputPath.startsWith("/")
    ? customOutputPath
    : resolvePath(root, customOutputPath);

  try {
    return assertPathWithinRoot(specsRoot, absolute, {
      message: `Output path must be inside ${relativeToRoot(root, specsRoot)}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SpecOutputPathError(message);
  }
}

async function findUniqueOutputPath(desiredPath: string): Promise<string> {
  if (!(await pathExists(desiredPath))) {
    return desiredPath;
  }

  const dir = dirname(desiredPath);
  const ext = ".md";
  const base = desiredPath.slice(dir.length + 1, -ext.length);

  let suffix = 2;
  while (true) {
    const candidate = resolvePath(dir, `${base}-${suffix}${ext}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
    suffix += 1;
  }
}
