import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { detectAgentProcessFailureDetail } from "../../agents/runtime/failures.js";
import { runSandboxedAgent } from "../../agents/runtime/harness.js";
import { AgentNotFoundError } from "../../configs/agents/errors.js";
import {
  loadAgentById,
  loadAgentCatalog,
} from "../../configs/agents/loader.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import { loadEnvironmentConfig } from "../../configs/environment/loader.js";
import {
  appendReviewRecord,
  finalizeReviewRecord,
  flushReviewRecordBuffer,
} from "../../reviews/records/persistence.js";
import type { ReviewRecord } from "../../reviews/records/types.js";
import type { RunRecordEnhanced } from "../../runs/records/enhanced.js";
import { buildRunRecordView } from "../../runs/records/enhanced.js";
import { RunRecordNotFoundError } from "../../runs/records/errors.js";
import { fetchRunsSafely } from "../../runs/records/persistence.js";
import { toErrorMessage } from "../../utils/errors.js";
import { normalizePathForDisplay, relativeToRoot } from "../../utils/path.js";
import {
  type AgentWorkspacePaths,
  resolveRunWorkspacePaths,
  scaffoldAgentSessionWorkspace,
} from "../../workspace/layout.js";
import { promoteWorkspaceFile } from "../../workspace/promotion.js";
import {
  REVIEW_ARTIFACT_INFO_FILENAME,
  REVIEW_FILENAME,
  VORATIQ_REVIEWS_DIR,
} from "../../workspace/structure.js";
import { RunNotFoundCliError } from "../errors.js";
import { pruneWorkspace } from "../shared/prune.js";
import {
  ReviewAgentNotFoundError,
  ReviewGenerationFailedError,
  ReviewNoAgentsConfiguredError,
} from "./errors.js";
import { generateReviewSessionId } from "./id.js";
import { buildReviewManifest } from "./manifest.js";
import { buildReviewPrompt } from "./prompt.js";

export interface ReviewCommandInput {
  root: string;
  runsFilePath: string;
  reviewsFilePath: string;
  runId: string;
  agentId?: string;
}

export interface ReviewCommandResult {
  reviewId: string;
  runRecord: RunRecordEnhanced;
  agentId: string;
  outputPath: string;
  missingArtifacts: string[];
}

export async function executeReviewCommand(
  input: ReviewCommandInput,
): Promise<ReviewCommandResult> {
  const { root, runsFilePath, reviewsFilePath, runId, agentId } = input;

  const { records } = await fetchRunsSafely({
    root,
    runsFilePath,
    runId,
    filters: { includeDeleted: true },
  }).catch((error) => {
    if (error instanceof RunRecordNotFoundError) {
      throw new RunNotFoundCliError(runId);
    }
    throw error;
  });

  const runRecord = records[0];
  if (!runRecord) {
    throw new RunNotFoundCliError(runId);
  }

  const enhanced = await buildRunRecordView(runRecord, {
    workspaceRoot: root,
  });

  const agent = resolveReviewAgent({ agentId, root });
  const environment = loadEnvironmentConfig({ root });
  const reviewId = generateReviewSessionId();
  const createdAt = new Date().toISOString();

  const workspacePaths = await buildReviewWorkspace({
    root,
    reviewId,
    agentId: agent.id,
  });

  const outputPath = normalizePathForDisplay(
    relativeToRoot(root, workspacePaths.reviewPath),
  );
  const record: ReviewRecord = {
    sessionId: reviewId,
    runId,
    createdAt,
    status: "running",
    agentId: agent.id,
    outputPath,
  };

  await appendReviewRecord({
    root,
    reviewsFilePath,
    record,
  });

  const runWorkspaceAbsolute = resolveRunWorkspacePaths(root, runId).absolute;

  let missingArtifacts: string[] = [];

  try {
    const buildManifestResult = await buildReviewManifest({
      root,
      run: enhanced,
    });
    const manifest = buildManifestResult.manifest;
    missingArtifacts = buildManifestResult.missingArtifacts;

    const artifactInfoWorkspacePath = join(
      workspacePaths.workspacePath,
      REVIEW_ARTIFACT_INFO_FILENAME,
    );
    await writeFile(
      artifactInfoWorkspacePath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      {
        encoding: "utf8",
      },
    );

    const prompt = buildReviewPrompt({
      runId: enhanced.runId,
      runStatus: enhanced.status,
      specPath: enhanced.spec.path,
      baseRevisionSha: enhanced.baseRevisionSha,
      createdAt: enhanced.createdAt,
      completedAt: manifest.run.completedAt,
      artifactInfoPath: REVIEW_ARTIFACT_INFO_FILENAME,
      reviewOutputPath: REVIEW_FILENAME,
      repoRootPath: root,
      reviewWorkspaceRoot: workspacePaths.workspacePath,
    });

    const result = await runSandboxedAgent({
      root,
      sessionId: reviewId,
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
      extraWriteProtectedPaths: [runWorkspaceAbsolute],
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
      throw new ReviewGenerationFailedError(
        [detail],
        [
          `See stderr: ${normalizePathForDisplay(
            relativeToRoot(root, workspacePaths.stderrPath),
          )}`,
        ],
      );
    }

    await assertReviewOutputExists(root, workspacePaths, reviewId);

    await promoteWorkspaceFile({
      workspacePath: workspacePaths.workspacePath,
      artifactsPath: workspacePaths.artifactsPath,
      stagedRelativePath: REVIEW_FILENAME,
      artifactRelativePath: REVIEW_FILENAME,
      deleteStaged: true,
    });

    await finalizeReviewRecord({
      root,
      reviewsFilePath,
      sessionId: reviewId,
      status: "succeeded",
    });
  } catch (error) {
    const detail =
      error instanceof ReviewGenerationFailedError &&
      error.detailLines.length > 0
        ? error.detailLines.join("\n")
        : toErrorMessage(error);
    await finalizeReviewRecord({
      root,
      reviewsFilePath,
      sessionId: reviewId,
      status: "failed",
      error: detail,
    }).catch(() => {});

    await flushReviewRecordBuffer({
      reviewsFilePath,
      sessionId: reviewId,
    }).catch(() => {});
    await pruneWorkspace(workspacePaths.workspacePath);

    if (error instanceof ReviewGenerationFailedError) {
      throw error;
    }
    throw new ReviewGenerationFailedError(
      [detail],
      [
        `See stderr: ${normalizePathForDisplay(
          relativeToRoot(root, workspacePaths.stderrPath),
        )}`,
      ],
    );
  }

  await flushReviewRecordBuffer({
    reviewsFilePath,
    sessionId: reviewId,
  });
  await pruneWorkspace(workspacePaths.workspacePath);

  return {
    reviewId,
    runRecord: enhanced,
    agentId: agent.id,
    outputPath,
    missingArtifacts,
  };
}

function resolveReviewAgent(options: {
  agentId?: string;
  root: string;
}): AgentDefinition {
  const { agentId, root } = options;
  if (agentId) {
    try {
      return loadAgentById(agentId, { root });
    } catch (error) {
      if (error instanceof AgentNotFoundError) {
        throw new ReviewAgentNotFoundError(error.agentId);
      }
      throw error;
    }
  }

  const catalog = loadAgentCatalog({ root });
  const first = catalog[0];
  if (!first) {
    throw new ReviewNoAgentsConfiguredError();
  }
  return first;
}

async function buildReviewWorkspace(options: {
  root: string;
  reviewId: string;
  agentId: string;
}): Promise<AgentWorkspacePaths> {
  const { root, reviewId, agentId } = options;
  return await scaffoldAgentSessionWorkspace({
    root,
    domain: VORATIQ_REVIEWS_DIR,
    sessionId: reviewId,
    agentId,
  });
}

async function assertReviewOutputExists(
  root: string,
  workspacePaths: AgentWorkspacePaths,
  reviewId: string,
): Promise<void> {
  const stagedPath = join(workspacePaths.workspacePath, REVIEW_FILENAME);
  try {
    const contents = await readFile(stagedPath, "utf8");
    if (contents.trim().length > 0) {
      return;
    }
  } catch (error) {
    const detail = toErrorMessage(error);
    const stderrDisplay = normalizePathForDisplay(
      relativeToRoot(root, workspacePaths.stderrPath),
    );
    throw new ReviewGenerationFailedError(
      [`Missing output: ${REVIEW_FILENAME}`],
      [`Review session: ${reviewId}`, detail, `See stderr: ${stderrDisplay}`],
    );
  }

  const stderrDisplay = normalizePathForDisplay(
    relativeToRoot(root, workspacePaths.stderrPath),
  );
  throw new ReviewGenerationFailedError(
    [`Missing output: ${REVIEW_FILENAME}`],
    [`Review session: ${reviewId}`, `See stderr: ${stderrDisplay}`],
  );
}
