import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { detectAgentProcessFailureDetail } from "../../agents/runtime/failures.js";
import { runSandboxedAgent } from "../../agents/runtime/harness.js";
import type {
  CompetitionCommandAdapter,
  CompetitionPreparationResult,
} from "../../competition/command-adapter.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../configs/environment/types.js";
import { generateBlindedCandidateAlias } from "../../reviews/candidates.js";
import {
  appendReviewRecord,
  finalizeReviewRecord,
  flushReviewRecordBuffer,
  rewriteReviewRecord,
} from "../../reviews/records/persistence.js";
import type { ReviewRecord } from "../../reviews/records/types.js";
import type { RunRecordEnhanced } from "../../runs/records/enhanced.js";
import { toErrorMessage } from "../../utils/errors.js";
import { createDetachedWorktree, removeWorktree } from "../../utils/git.js";
import {
  isRepoRelativePath,
  normalizePathForDisplay,
  relativeToRoot,
  resolvePath,
} from "../../utils/path.js";
import {
  type AgentWorkspacePaths,
  scaffoldAgentSessionWorkspace,
} from "../../workspace/layout.js";
import { promoteWorkspaceFile } from "../../workspace/promotion.js";
import {
  resolveWorkspacePath,
  REVIEW_ARTIFACT_INFO_FILENAME,
  REVIEW_FILENAME,
  REVIEW_RECOMMENDATION_FILENAME,
  VORATIQ_AGENTS_FILE,
  VORATIQ_ENVIRONMENT_FILE,
  VORATIQ_EVALS_FILE,
  VORATIQ_HISTORY_LOCK_FILENAME,
  VORATIQ_ORCHESTRATION_FILE,
  VORATIQ_REVIEWS_DIR,
  VORATIQ_REVIEWS_FILE,
  VORATIQ_REVIEWS_SESSIONS_DIR,
  VORATIQ_RUNS_DIR,
  VORATIQ_SANDBOX_FILE,
  VORATIQ_SPECS_DIR,
} from "../../workspace/structure.js";
import { pruneWorkspace } from "../shared/prune.js";
import { resolveBlindedRecommendation } from "./blinded.js";
import { ReviewGenerationFailedError } from "./errors.js";
import { buildBlindedReviewManifest } from "./manifest.js";
import { buildReviewPrompt } from "./prompt.js";
import { parseReviewRecommendation } from "./recommendation.js";

export type ReviewCompetitionCandidate = AgentDefinition;

export interface BlindedReviewPreparation {
  readonly enabled: true;
  readonly aliasMap: Record<string, string>;
  readonly stagedSpecPath: string;
  readonly baseSnapshotPath: string;
  readonly stagedCandidates: ReadonlyArray<{
    readonly candidateId: string;
    readonly agentId: string;
    readonly diffPath: string;
    readonly diffRecorded: boolean;
  }>;
  readonly extraWriteProtectedPaths: readonly string[];
  readonly extraReadProtectedPaths: readonly string[];
  readonly worktreesToRemove: readonly string[];
}

export interface PreparedReviewCompetitionCandidate {
  readonly candidate: ReviewCompetitionCandidate;
  readonly workspacePaths: AgentWorkspacePaths;
  readonly prompt: string;
  readonly missingArtifacts: readonly string[];
  readonly blinded?: BlindedReviewPreparation;
}

export interface ReviewCompetitionExecution {
  readonly agentId: string;
  readonly outputPath: string;
  readonly status: "succeeded" | "failed";
  readonly missingArtifacts: readonly string[];
  readonly error?: string;
}

export interface CreateReviewCompetitionAdapterInput {
  readonly root: string;
  readonly reviewId: string;
  readonly createdAt: string;
  readonly reviewsFilePath: string;
  readonly run: RunRecordEnhanced;
  readonly environment: EnvironmentConfig;
  readonly runWorkspaceAbsolute: string;
}

export function createReviewCompetitionAdapter(
  input: CreateReviewCompetitionAdapterInput,
): CompetitionCommandAdapter<
  ReviewCompetitionCandidate,
  PreparedReviewCompetitionCandidate,
  ReviewCompetitionExecution
> {
  const {
    root,
    reviewId,
    createdAt,
    reviewsFilePath,
    run,
    environment,
    runWorkspaceAbsolute,
  } = input;

  let failure: unknown;
  const workspacesToPrune = new Set<string>();
  const worktreesToRemove = new Set<string>();

  return {
    prepareCandidates: async (
      candidates,
    ): Promise<
      CompetitionPreparationResult<
        PreparedReviewCompetitionCandidate,
        ReviewCompetitionExecution
      >
    > => {
      try {
        const prepared: PreparedReviewCompetitionCandidate[] = [];

        for (const candidate of candidates) {
          const workspacePaths = await scaffoldAgentSessionWorkspace({
            root,
            domain: VORATIQ_REVIEWS_DIR,
            sessionId: reviewId,
            agentId: candidate.id,
          });
          workspacesToPrune.add(workspacePaths.workspacePath);

          const outputPath = normalizePathForDisplay(
            relativeToRoot(root, workspacePaths.reviewPath),
          );

          const blinded = await prepareBlindedReviewInputs({
            root,
            reviewId,
            reviewerAgentId: candidate.id,
            workspacePaths,
            run,
          });
          for (const path of blinded.worktreesToRemove) {
            worktreesToRemove.add(path);
          }

          const record: ReviewRecord = {
            sessionId: reviewId,
            runId: run.runId,
            createdAt,
            status: "running",
            agentId: candidate.id,
            outputPath,
            blinded: {
              enabled: true,
              aliasMap: blinded.aliasMap,
            },
          };
          await appendReviewRecord({
            root,
            reviewsFilePath,
            record,
          });

          const buildManifestResult = await buildBlindedReviewManifest({
            root,
            run,
            specPath: blinded.stagedSpecPath,
            baseSnapshotPath: blinded.baseSnapshotPath,
            candidates: blinded.stagedCandidates.map((entry) => ({
              candidateId: entry.candidateId,
              agentId: entry.agentId,
              stagedDiffPath: entry.diffPath,
              diffRecorded: entry.diffRecorded,
            })),
          });
          const manifest = buildManifestResult.manifest;
          const missingArtifacts = buildManifestResult.missingArtifacts;

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

          const promptBuild = buildReviewPrompt({
            runId: run.runId,
            runStatus: run.status,
            specPath: blinded.stagedSpecPath,
            baseRevisionSha: run.baseRevisionSha,
            createdAt: run.createdAt,
            completedAt: manifest.run.completedAt,
            artifactInfoPath: REVIEW_ARTIFACT_INFO_FILENAME,
            outputPath: REVIEW_FILENAME,
            baseSnapshotPath: blinded.baseSnapshotPath,
            candidates: blinded.stagedCandidates.map((entry) => ({
              candidateId: entry.candidateId,
              diffPath: entry.diffPath,
            })),
            repoRootPath: workspacePaths.workspacePath,
            workspacePath: workspacePaths.workspacePath,
          });

          assertNoCandidateIdentityLeak({
            prompt: promptBuild.leakageCheckPrompt,
            manifest,
            forbidden: buildForbiddenCandidateIdentityTokens({
              run,
              allowed: [candidate.id, candidate.model],
            }),
          });

          prepared.push({
            candidate,
            workspacePaths,
            prompt: promptBuild.prompt,
            missingArtifacts: [...missingArtifacts],
            blinded,
          });
        }

        return {
          ready: prepared,
          failures: [],
        };
      } catch (error) {
        failure = failure ?? error;
        throw error;
      }
    },
    executeCandidate: async (prepared): Promise<ReviewCompetitionExecution> => {
      const { candidate, workspacePaths, prompt, blinded } = prepared;
      const agent = candidate;
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
        extraWriteProtectedPaths: [
          runWorkspaceAbsolute,
          ...(blinded?.extraWriteProtectedPaths ?? []),
        ],
        extraReadProtectedPaths: blinded?.extraReadProtectedPaths ?? [],
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

      if (blinded) {
        await postProcessBlindedReviewOutputs({
          root,
          reviewsFilePath,
          reviewId,
          workspacePaths,
          aliasMap: blinded.aliasMap,
        });
      }

      await promoteWorkspaceFile({
        workspacePath: workspacePaths.workspacePath,
        artifactsPath: workspacePaths.artifactsPath,
        stagedRelativePath: REVIEW_FILENAME,
        artifactRelativePath: REVIEW_FILENAME,
        deleteStaged: true,
      });
      await promoteWorkspaceFile({
        workspacePath: workspacePaths.workspacePath,
        artifactsPath: workspacePaths.artifactsPath,
        stagedRelativePath: REVIEW_RECOMMENDATION_FILENAME,
        artifactRelativePath: REVIEW_RECOMMENDATION_FILENAME,
        deleteStaged: true,
      });

      return {
        agentId: agent.id,
        outputPath: normalizePathForDisplay(
          relativeToRoot(root, workspacePaths.reviewPath),
        ),
        status: "succeeded",
        missingArtifacts: [...prepared.missingArtifacts],
      };
    },
    captureExecutionFailure: ({ error }) => {
      failure = failure ?? error;
      return undefined;
    },
    finalizeCompetition: async () => {
      const failed = failure !== undefined;

      if (failed) {
        await finalizeReviewRecord({
          root,
          reviewsFilePath,
          sessionId: reviewId,
          status: "failed",
          error: toReviewFailureDetail(failure),
        }).catch(() => {});
        await flushReviewRecordBuffer({
          reviewsFilePath,
          sessionId: reviewId,
        }).catch(() => {});
      } else {
        await finalizeReviewRecord({
          root,
          reviewsFilePath,
          sessionId: reviewId,
          status: "succeeded",
        });
        await flushReviewRecordBuffer({
          reviewsFilePath,
          sessionId: reviewId,
        });
      }

      for (const worktreePath of worktreesToRemove) {
        await removeWorktree({ root, worktreePath }).catch(() => {});
      }

      for (const workspacePath of workspacesToPrune) {
        await pruneWorkspace(workspacePath);
      }
    },
    sortResults: compareReviewExecutionsByAgentId,
  };
}

function compareReviewExecutionsByAgentId(
  left: ReviewCompetitionExecution,
  right: ReviewCompetitionExecution,
): number {
  return left.agentId.localeCompare(right.agentId);
}

function toReviewFailureDetail(error: unknown): string {
  if (
    error instanceof ReviewGenerationFailedError &&
    error.detailLines.length > 0
  ) {
    return error.detailLines.join("\n");
  }

  if (error === undefined) {
    return "Review generation failed.";
  }

  return toErrorMessage(error);
}

async function assertReviewOutputExists(
  root: string,
  workspacePaths: AgentWorkspacePaths,
  reviewId: string,
): Promise<void> {
  const reviewStagedPath = join(workspacePaths.workspacePath, REVIEW_FILENAME);
  try {
    const reviewContent = await readFile(reviewStagedPath, "utf8");
    if (reviewContent.trim().length === 0) {
      const stderrDisplay = normalizePathForDisplay(
        relativeToRoot(root, workspacePaths.stderrPath),
      );
      throw new ReviewGenerationFailedError(
        [`Missing output: ${REVIEW_FILENAME}`],
        [`Review session: ${reviewId}`, `See stderr: ${stderrDisplay}`],
      );
    }
  } catch (error) {
    if (error instanceof ReviewGenerationFailedError) {
      throw error;
    }
    const detail = toErrorMessage(error);
    const stderrDisplay = normalizePathForDisplay(
      relativeToRoot(root, workspacePaths.stderrPath),
    );
    throw new ReviewGenerationFailedError(
      [`Missing output: ${REVIEW_FILENAME}`],
      [`Review session: ${reviewId}`, detail, `See stderr: ${stderrDisplay}`],
    );
  }

  const recommendationStagedPath = join(
    workspacePaths.workspacePath,
    REVIEW_RECOMMENDATION_FILENAME,
  );

  let recommendationContent: string;
  try {
    recommendationContent = await readFile(recommendationStagedPath, "utf8");
  } catch (error) {
    const detail = toErrorMessage(error);
    const stderrDisplay = normalizePathForDisplay(
      relativeToRoot(root, workspacePaths.stderrPath),
    );
    throw new ReviewGenerationFailedError(
      [`Missing output: ${REVIEW_RECOMMENDATION_FILENAME}`],
      [`Review session: ${reviewId}`, detail, `See stderr: ${stderrDisplay}`],
    );
  }

  if (recommendationContent.trim().length === 0) {
    const stderrDisplay = normalizePathForDisplay(
      relativeToRoot(root, workspacePaths.stderrPath),
    );
    throw new ReviewGenerationFailedError(
      [`Invalid output: ${REVIEW_RECOMMENDATION_FILENAME}`],
      [
        `Review session: ${reviewId}`,
        "Recommendation artifact is empty.",
        `See stderr: ${stderrDisplay}`,
      ],
    );
  }

  try {
    parseReviewRecommendation(recommendationContent);
  } catch (error) {
    const detail = toErrorMessage(error);
    const stderrDisplay = normalizePathForDisplay(
      relativeToRoot(root, workspacePaths.stderrPath),
    );
    throw new ReviewGenerationFailedError(
      [`Invalid output: ${REVIEW_RECOMMENDATION_FILENAME}`],
      [`Review session: ${reviewId}`, detail, `See stderr: ${stderrDisplay}`],
    );
  }
}

async function prepareBlindedReviewInputs(options: {
  root: string;
  reviewId: string;
  reviewerAgentId: string;
  workspacePaths: AgentWorkspacePaths;
  run: RunRecordEnhanced;
}): Promise<BlindedReviewPreparation> {
  const { root, reviewId, reviewerAgentId, workspacePaths, run } = options;

  const stagedInputsDir = join(workspacePaths.workspacePath, "inputs");
  await mkdir(stagedInputsDir, { recursive: true });

  const stagedSpecAbsolute = join(stagedInputsDir, "spec.md");
  const specAbsolute = resolvePath(root, run.spec.path);
  await mkdir(dirname(stagedSpecAbsolute), { recursive: true });
  await copyFile(specAbsolute, stagedSpecAbsolute);

  const baseSnapshotAbsolute = join(stagedInputsDir, "base");
  await createDetachedWorktree({
    root,
    worktreePath: baseSnapshotAbsolute,
    baseRevision: run.baseRevisionSha,
  });

  const stagedCandidatesDir = join(stagedInputsDir, "candidates");
  await mkdir(stagedCandidatesDir, { recursive: true });

  const seenAliases = new Set<string>();
  const aliasMap: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;

  const stagedCandidates: Array<{
    candidateId: string;
    agentId: string;
    diffPath: string;
    diffRecorded: boolean;
  }> = [];

  for (const agent of run.agents) {
    const alias = generateBlindedCandidateAlias({ seen: seenAliases });
    seenAliases.add(alias);
    aliasMap[alias] = agent.agentId;

    const stagedDiffAbsolute = join(stagedCandidatesDir, alias, "diff.patch");
    await mkdir(dirname(stagedDiffAbsolute), { recursive: true });

    const diffSource = agent.assets.diffPath
      ? resolvePath(root, agent.assets.diffPath)
      : undefined;
    let diffCopied = false;
    if (diffSource) {
      try {
        await copyFile(diffSource, stagedDiffAbsolute);
        diffCopied = true;
      } catch {
        diffCopied = false;
      }
    }
    if (!diffCopied) {
      await writeFile(stagedDiffAbsolute, "", "utf8");
    }

    stagedCandidates.push({
      candidateId: alias,
      agentId: agent.agentId,
      diffPath: toRepoRelativeOrThrow(root, stagedDiffAbsolute),
      diffRecorded: Boolean(diffSource) && diffCopied,
    });
  }

  const denyRead: string[] = [];
  const denyWrite: string[] = [];
  const protections = await buildReviewSandboxProtectedPaths({
    root,
    reviewId,
    reviewerAgentId,
  });
  denyRead.push(...protections.denyRead);
  denyWrite.push(...protections.denyWrite);

  denyWrite.push(baseSnapshotAbsolute);

  return {
    enabled: true,
    aliasMap,
    stagedSpecPath: toRepoRelativeOrThrow(root, stagedSpecAbsolute),
    baseSnapshotPath: toRepoRelativeOrThrow(root, baseSnapshotAbsolute),
    stagedCandidates,
    extraWriteProtectedPaths: normalizeProtectedPaths(denyWrite),
    extraReadProtectedPaths: normalizeProtectedPaths(denyRead),
    worktreesToRemove: [baseSnapshotAbsolute],
  };
}

function normalizeProtectedPaths(paths: readonly string[]): string[] {
  return Array.from(new Set(paths)).sort((left, right) =>
    left.localeCompare(right),
  );
}

async function buildReviewSandboxProtectedPaths(options: {
  root: string;
  reviewId: string;
  reviewerAgentId: string;
}): Promise<{
  denyRead: string[];
  denyWrite: string[];
}> {
  const { root, reviewId, reviewerAgentId } = options;
  const denyRead: string[] = [];
  const denyWrite: string[] = [];

  const broadPaths = [
    resolveWorkspacePath(root, VORATIQ_RUNS_DIR),
    resolveWorkspacePath(root, VORATIQ_SPECS_DIR),
    resolveWorkspacePath(root, VORATIQ_AGENTS_FILE),
    resolveWorkspacePath(root, VORATIQ_EVALS_FILE),
    resolveWorkspacePath(root, VORATIQ_ENVIRONMENT_FILE),
    resolveWorkspacePath(root, VORATIQ_ORCHESTRATION_FILE),
    resolveWorkspacePath(root, VORATIQ_SANDBOX_FILE),
  ];
  denyRead.push(...broadPaths);
  denyWrite.push(...broadPaths);

  denyRead.push(resolvePath(root, ".git"));
  denyRead.push(resolveWorkspacePath(root, VORATIQ_REVIEWS_FILE));
  denyRead.push(
    resolveWorkspacePath(
      root,
      VORATIQ_REVIEWS_DIR,
      VORATIQ_HISTORY_LOCK_FILENAME,
    ),
  );
  denyRead.push(
    resolveWorkspacePath(
      root,
      VORATIQ_REVIEWS_SESSIONS_DIR,
      reviewId,
      "record.json",
    ),
  );

  const sessionDir = resolveWorkspacePath(
    root,
    VORATIQ_REVIEWS_SESSIONS_DIR,
    reviewId,
  );
  const reviewerRoot = resolveWorkspacePath(
    root,
    VORATIQ_REVIEWS_SESSIONS_DIR,
    reviewId,
    reviewerAgentId,
  );
  try {
    const entries = await readdir(sessionDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const sibling = resolvePath(sessionDir, entry.name);
      if (sibling === reviewerRoot) {
        continue;
      }
      denyRead.push(sibling);
    }
  } catch {
    // Ignore; broad protections still block run/spec/config roots.
  }

  return {
    denyRead: normalizeProtectedPaths(denyRead),
    denyWrite: normalizeProtectedPaths(denyWrite),
  };
}

function buildForbiddenCandidateIdentityTokens(options: {
  run: RunRecordEnhanced;
  allowed?: readonly string[];
}): string[] {
  const { run, allowed = [] } = options;
  const allowedTokens = new Set(
    allowed.map((token) => token.toLowerCase().trim()).filter(Boolean),
  );
  const tokens = new Set<string>();
  for (const agent of run.agents) {
    const agentId = agent.agentId.toLowerCase();
    if (!allowedTokens.has(agentId)) {
      tokens.add(agentId);
    }

    const model = agent.model.toLowerCase();
    if (!allowedTokens.has(model)) {
      tokens.add(model);
    }
  }

  return Array.from(tokens).filter((token) => token.length > 0);
}

function assertNoCandidateIdentityLeak(options: {
  prompt: string;
  manifest: unknown;
  forbidden: readonly string[];
}): void {
  const { prompt, manifest, forbidden } = options;
  const promptLower = prompt.toLowerCase();
  const manifestJson = JSON.stringify(manifest);
  const manifestLower = manifestJson.toLowerCase();

  const leaks: string[] = [];
  for (const token of forbidden) {
    if (!token) {
      continue;
    }
    if (
      containsBoundedToken(promptLower, token) ||
      containsBoundedToken(manifestLower, token)
    ) {
      leaks.push(token);
    }
  }

  if (leaks.length > 0) {
    throw new ReviewGenerationFailedError([
      "Blinded review leakage validation failed.",
      `Forbidden candidate identity tokens detected: ${leaks
        .slice(0, 5)
        .join(", ")}${leaks.length > 5 ? ", ..." : ""}`,
    ]);
  }
}

function containsBoundedToken(text: string, token: string): boolean {
  if (!token) {
    return false;
  }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![a-z0-9_-])${escaped}(?![a-z0-9_-])`, "iu");
  return pattern.test(text);
}

function toRepoRelativeOrThrow(root: string, absolutePath: string): string {
  const relative = normalizePathForDisplay(relativeToRoot(root, absolutePath));
  if (!isRepoRelativePath(relative)) {
    throw new Error(`Expected repo-relative path, got "${relative}".`);
  }
  return relative;
}

async function postProcessBlindedReviewOutputs(options: {
  root: string;
  reviewsFilePath: string;
  reviewId: string;
  workspacePaths: AgentWorkspacePaths;
  aliasMap: Record<string, string>;
}): Promise<void> {
  const { root, reviewsFilePath, reviewId, workspacePaths, aliasMap } = options;
  const stagedRecommendationPath = join(
    workspacePaths.workspacePath,
    REVIEW_RECOMMENDATION_FILENAME,
  );
  const recommendation = parseReviewRecommendation(
    await readFile(stagedRecommendationPath, "utf8"),
  );
  const resolved = resolveBlindedRecommendation({
    recommendation,
    aliasMap,
  });

  await writeFile(
    stagedRecommendationPath,
    `${JSON.stringify(resolved.recommendation, null, 2)}\n`,
    "utf8",
  );

  await rewriteReviewRecord({
    root,
    reviewsFilePath,
    sessionId: reviewId,
    mutate: (record) => ({
      ...record,
      blinded: {
        enabled: true,
        aliasMap: record.blinded?.aliasMap ?? aliasMap,
      },
    }),
    forceFlush: true,
  });
}
