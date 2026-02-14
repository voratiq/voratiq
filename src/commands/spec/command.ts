import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { detectAgentProcessFailureDetail } from "../../agents/runtime/failures.js";
import { runSandboxedAgent } from "../../agents/runtime/harness.js";
import { AgentNotFoundError } from "../../configs/agents/errors.js";
import { loadAgentById } from "../../configs/agents/loader.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import { loadEnvironmentConfig } from "../../configs/environment/loader.js";
import type { EnvironmentConfig } from "../../configs/environment/types.js";
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
import {
  type AgentWorkspacePaths,
  scaffoldAgentSessionWorkspace,
} from "../../workspace/layout.js";
import { promoteWorkspaceFile } from "../../workspace/promotion.js";
import {
  getSpecsDirectoryPath,
  VORATIQ_SPECS_DIR,
} from "../../workspace/structure.js";
import { pruneWorkspace } from "../shared/prune.js";
import { generateSessionId } from "../shared/session-id.js";
import {
  SpecAgentNotFoundError,
  SpecGenerationFailedError,
  SpecOutputExistsError,
  SpecOutputPathError,
} from "./errors.js";
import { buildSpecPrompt } from "./prompt.js";

export interface ExecuteSpecCommandInput {
  root: string;
  specsFilePath: string;
  description: string;
  agentId: string;
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

const SPEC_ARTIFACT_FILENAME = "spec.md";

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
    agent = loadAgentById(agentId, { root });
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

  const workspacePaths = await buildSpecWorkspace({
    root,
    sessionId,
    agentId: agent.id,
  });

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

  const generationResult = await runSpecGeneration({
    root,
    agent,
    environment,
    description,
    specTitle,
    workspacePaths,
    sessionId,
  });

  if (generationResult.status === "failed") {
    latestRecord = await finalizeSpecRecord({
      root,
      specsFilePath,
      sessionId,
      status: "failed",
      error: generationResult.error ?? null,
    });
    await flushSpecRecordBuffer({ specsFilePath, sessionId });
    await pruneWorkspace(workspacePaths.workspacePath);
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
    await pruneWorkspace(workspacePaths.workspacePath);
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
    await pruneWorkspace(workspacePaths.workspacePath);
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
  await pruneWorkspace(workspacePaths.workspacePath);

  return {
    sessionId,
    slug,
    outputPath: latestRecord.outputPath,
    record: latestRecord,
  };
}

async function runSpecGeneration(options: {
  root: string;
  agent: AgentDefinition;
  environment: EnvironmentConfig;
  description: string;
  specTitle?: string;
  workspacePaths: AgentWorkspacePaths;
  sessionId: string;
}): Promise<{
  specPath: string;
  status: "generated" | "failed";
  error?: string;
}> {
  const {
    root,
    agent,
    environment,
    description,
    specTitle,
    workspacePaths,
    sessionId,
  } = options;

  const specRelativePath = SPEC_ARTIFACT_FILENAME;

  const prompt = buildSpecPrompt({
    description,
    title: specTitle,
    outputPath: specRelativePath,
    repoRootPath: root,
    workspacePath: workspacePaths.workspacePath,
  });

  try {
    const result = await runSandboxedAgent({
      root,
      sessionId,
      agent,
      prompt,
      environment,
      paths: {
        agentRoot: workspacePaths.agentRoot,
        workspacePath: workspacePaths.workspacePath,
        sandboxHomePath: workspacePaths.sandboxHomePath,
        runtimeManifestPath: workspacePaths.runtimeManifestPath,
        sandboxSettingsPath: workspacePaths.sandboxSettingsPath,
        runtimePath: workspacePaths.runtimePath,
        artifactsPath: workspacePaths.artifactsPath,
        stdoutPath: workspacePaths.stdoutPath,
        stderrPath: workspacePaths.stderrPath,
      },
      captureChat: true,
      extraWriteProtectedPaths: [],
      extraReadProtectedPaths: [],
    });

    if (result.exitCode !== 0 || result.errorMessage) {
      const detectedDetail =
        result.watchdog?.trigger && result.errorMessage
          ? result.errorMessage
          : await detectAgentProcessFailureDetail({
              provider: agent.provider,
              stdoutPath: workspacePaths.stdoutPath,
              stderrPath: workspacePaths.stderrPath,
            });
      const detail =
        detectedDetail ??
        result.errorMessage ??
        `Agent exited with code ${result.exitCode ?? "unknown"}`;
      return {
        specPath: normalizePathForDisplay(
          relativeToRoot(
            root,
            resolvePath(workspacePaths.workspacePath, specRelativePath),
          ),
        ),
        status: "failed",
        error: detail,
      };
    }

    const promoteResult = await promoteWorkspaceFile({
      workspacePath: workspacePaths.workspacePath,
      artifactsPath: workspacePaths.artifactsPath,
      stagedRelativePath: specRelativePath,
      artifactRelativePath: SPEC_ARTIFACT_FILENAME,
      deleteStaged: true,
    });

    return {
      specPath: normalizePathForDisplay(
        relativeToRoot(root, promoteResult.artifactPath),
      ),
      status: "generated",
    };
  } catch (error) {
    const detail = toErrorMessage(error);
    return {
      specPath: normalizePathForDisplay(
        relativeToRoot(
          root,
          resolvePath(workspacePaths.workspacePath, specRelativePath),
        ),
      ),
      status: "failed",
      error: detail,
    };
  }
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

async function buildSpecWorkspace(options: {
  root: string;
  sessionId: string;
  agentId: string;
}) {
  const { root, sessionId, agentId } = options;
  return await scaffoldAgentSessionWorkspace({
    root,
    domain: VORATIQ_SPECS_DIR,
    sessionId,
    agentId,
  });
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
