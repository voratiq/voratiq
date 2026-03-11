import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { detectAgentProcessFailureDetail } from "../../../agents/runtime/failures.js";
import { runSandboxedAgent } from "../../../agents/runtime/harness.js";
import { RunNotFoundCliError } from "../../../cli/errors.js";
import type {
  CompetitionCommandAdapter,
  CompetitionPreparationResult,
} from "../../../competition/command-adapter.js";
import {
  type ResolvedExtraContextFile,
  stageExtraContextFiles,
} from "../../../competition/shared/extra-context.js";
import { pruneWorkspace } from "../../../competition/shared/prune.js";
import { composeStageSandboxPolicy } from "../../../competition/shared/sandbox-policy.js";
import type { AgentDefinition } from "../../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../../configs/environment/types.js";
import { validateReductionOutputContract } from "../../../domains/reductions/competition/output-validation.js";
import { buildReducePrompt } from "../../../domains/reductions/competition/prompt.js";
import { parseReductionArtifact } from "../../../domains/reductions/competition/reduction.js";
import type {
  ReductionRecord,
  ReductionTarget,
} from "../../../domains/reductions/model/types.js";
import {
  readReductionRecords,
  rewriteReductionRecord,
} from "../../../domains/reductions/persistence/adapter.js";
import { readReviewRecords } from "../../../domains/reviews/persistence/adapter.js";
import { buildRunRecordView } from "../../../domains/runs/model/enhanced.js";
import { RunRecordNotFoundError } from "../../../domains/runs/model/errors.js";
import type { ExtractedTokenUsage } from "../../../domains/runs/model/types.js";
import { fetchRunsSafely } from "../../../domains/runs/persistence/adapter.js";
import { readSpecRecords } from "../../../domains/specs/persistence/adapter.js";
import { buildPersistedExtraContextFields } from "../../../extra-context/contract.js";
import type { ReduceProgressRenderer } from "../../../render/transcripts/reduce.js";
import { emitStageProgressEvent } from "../../../render/transcripts/stage-progress.js";
import { toErrorMessage } from "../../../utils/errors.js";
import {
  normalizePathForDisplay,
  relativeToRoot,
  resolvePath,
} from "../../../utils/path.js";
import { extractProviderNativeTokenUsageForSession } from "../../../workspace/chat/native-usage.js";
import type { TokenUsageResult } from "../../../workspace/chat/token-usage-result.js";
import {
  type AgentWorkspacePaths,
  scaffoldAgentSessionWorkspace,
} from "../../../workspace/layout.js";
import { promoteWorkspaceFile } from "../../../workspace/promotion.js";
import {
  REDUCTION_ARTIFACT_INFO_FILENAME,
  REDUCTION_DATA_FILENAME,
  REDUCTION_FILENAME,
  REVIEW_RECOMMENDATION_FILENAME,
  VORATIQ_REDUCTIONS_DIR,
} from "../../../workspace/structure.js";

function buildUnavailableTokenUsageResult(options: {
  provider: string;
  modelId: string;
  message?: string;
}): TokenUsageResult {
  const { provider, modelId, message } = options;
  return {
    status: "unavailable",
    reason: "chat_not_captured",
    provider,
    modelId,
    message:
      message ??
      "Chat usage capture was not enabled or did not produce an artifact.",
  };
}

export type ReduceCompetitionCandidate = AgentDefinition;

export interface ReductionCompetitionExecution {
  readonly agentId: string;
  readonly outputPath: string;
  readonly dataPath: string;
  readonly status: "succeeded" | "failed";
  readonly tokenUsage?: ExtractedTokenUsage;
  readonly tokenUsageResult: TokenUsageResult;
  readonly error?: string;
}

interface PreparedReduceCompetitionCandidate {
  readonly candidate: ReduceCompetitionCandidate;
  readonly workspacePaths: AgentWorkspacePaths;
  readonly outputPath: string;
  readonly dataPath: string;
  readonly prompt: string;
}

interface ReductionTargetContext {
  readonly target: ReductionTarget;
  readonly displayPath: string;
  readonly manifest: Record<string, unknown>;
  readonly stagedFiles: readonly StagedTargetFile[];
}

interface StagedTargetFile {
  readonly sourceAbsolutePath: string;
  readonly stagedRelativePath: string;
}

export interface CreateReduceCompetitionAdapterInput {
  readonly root: string;
  readonly reductionId: string;
  readonly createdAt: string;
  readonly reductionsFilePath: string;
  readonly specsFilePath: string;
  readonly runsFilePath: string;
  readonly reviewsFilePath: string;
  readonly target: ReductionTarget;
  readonly environment: EnvironmentConfig;
  readonly extraContextFiles?: readonly ResolvedExtraContextFile[];
  readonly renderer?: ReduceProgressRenderer;
}

export function createReduceCompetitionAdapter(
  input: CreateReduceCompetitionAdapterInput,
): CompetitionCommandAdapter<
  ReduceCompetitionCandidate,
  PreparedReduceCompetitionCandidate,
  ReductionCompetitionExecution
> {
  const {
    root,
    reductionId,
    createdAt,
    reductionsFilePath,
    specsFilePath,
    runsFilePath,
    reviewsFilePath,
    target,
    environment,
    extraContextFiles = [],
    renderer,
  } = input;

  let failure: unknown;
  const pathsToPrune = new Set<string>();
  const tokenUsageResultByReducerAgentId = new Map<string, TokenUsageResult>();

  return {
    queueCandidate: (candidate) => {
      emitStageProgressEvent(renderer, {
        type: "stage.candidate",
        stage: "reduce",
        candidate: {
          reducerAgentId: candidate.id,
          status: "queued",
        },
      });
    },
    prepareCandidates: async (
      candidates,
    ): Promise<
      CompetitionPreparationResult<
        PreparedReduceCompetitionCandidate,
        ReductionCompetitionExecution
      >
    > => {
      const targetContext = await prepareReductionTargetContext({
        root,
        specsFilePath,
        runsFilePath,
        reviewsFilePath,
        reductionsFilePath,
        target,
      });

      const record: ReductionRecord = {
        sessionId: reductionId,
        target,
        createdAt,
        status: "running",
        reducers: candidates.map((candidate) => ({
          agentId: candidate.id,
          status: "running",
          outputPath: buildReductionOutputPath({
            root,
            reductionId,
            reducerAgentId: candidate.id,
          }),
          dataPath: buildReductionDataPath({
            root,
            reductionId,
            reducerAgentId: candidate.id,
          }),
        })),
        ...buildPersistedExtraContextFields(extraContextFiles),
      };

      await rewriteOrAppendReductionRecord({
        root,
        reductionsFilePath,
        record,
      });

      const prepared: PreparedReduceCompetitionCandidate[] = [];
      for (const candidate of candidates) {
        const workspacePaths = await scaffoldAgentSessionWorkspace({
          root,
          domain: VORATIQ_REDUCTIONS_DIR,
          sessionId: reductionId,
          agentId: candidate.id,
        });
        pathsToPrune.add(workspacePaths.workspacePath);
        pathsToPrune.add(workspacePaths.contextPath);

        await stageReductionTargetContext({
          workspacePath: workspacePaths.workspacePath,
          targetContext,
        });
        await stageExtraContextFiles({
          contextPath: workspacePaths.contextPath,
          files: extraContextFiles,
        });

        const prompt = buildReducePrompt({
          targetOperator: target.type,
          targetId: target.id,
          artifactInfoPath: REDUCTION_ARTIFACT_INFO_FILENAME,
          repoRootPath: workspacePaths.workspacePath,
          workspacePath: workspacePaths.workspacePath,
          extraContextFiles,
        });

        prepared.push({
          candidate,
          workspacePaths,
          outputPath: buildReductionOutputPath({
            root,
            reductionId,
            reducerAgentId: candidate.id,
          }),
          dataPath: buildReductionDataPath({
            root,
            reductionId,
            reducerAgentId: candidate.id,
          }),
          prompt,
        });
      }

      return { ready: prepared, failures: [] };
    },
    onCandidateRunning: async (prepared) => {
      const startedAt = new Date().toISOString();
      await rewriteReductionRecord({
        root,
        reductionsFilePath,
        sessionId: reductionId,
        mutate: (record) =>
          mutateReducerRecord(record, {
            reducerAgentId: prepared.candidate.id,
            status: "running",
            startedAt: startedAt,
            error: null,
          }),
      });
      emitStageProgressEvent(renderer, {
        type: "stage.candidate",
        stage: "reduce",
        candidate: {
          reducerAgentId: prepared.candidate.id,
          status: "running",
          startedAt,
        },
      });
    },
    executeCandidate: async (
      prepared,
    ): Promise<ReductionCompetitionExecution> => {
      const { candidate, workspacePaths, prompt, outputPath, dataPath } =
        prepared;
      const sandboxPolicy = composeStageSandboxPolicy({
        stageWriteProtectedPaths: [],
        stageReadProtectedPaths: [],
      });
      const result = await runSandboxedAgent({
        root,
        sessionId: reductionId,
        sandboxStageId: "reduce",
        agent: candidate,
        prompt,
        environment,
        teardownAuthOnExit: true,
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
        extraWriteProtectedPaths: sandboxPolicy.extraWriteProtectedPaths,
        extraReadProtectedPaths: sandboxPolicy.extraReadProtectedPaths,
      });
      const tokenUsageResult = await extractProviderNativeTokenUsageForSession({
        root,
        domain: VORATIQ_REDUCTIONS_DIR,
        sessionId: reductionId,
        agentId: candidate.id,
        provider: candidate.provider,
        modelId: candidate.model,
        chatCaptured: result.chat?.captured === true,
        format: result.chat?.format,
        artifactPath: result.chat?.artifactPath,
      });
      tokenUsageResultByReducerAgentId.set(candidate.id, tokenUsageResult);
      const tokenUsage =
        tokenUsageResult.status === "available"
          ? tokenUsageResult.tokenUsage
          : undefined;

      if (result.exitCode !== 0 || result.errorMessage) {
        const detectedDetail =
          result.watchdog?.trigger && result.errorMessage
            ? result.errorMessage
            : await detectAgentProcessFailureDetail({
                provider: candidate.provider,
                stdoutPath: workspacePaths.stdoutPath,
                stderrPath: workspacePaths.stderrPath,
              });
        const detail =
          detectedDetail ??
          result.errorMessage ??
          `Agent exited with code ${result.exitCode ?? "unknown"}`;
        throw new Error(detail);
      }

      await assertReductionOutputExists(root, workspacePaths);

      await promoteWorkspaceFile({
        workspacePath: workspacePaths.workspacePath,
        artifactsPath: workspacePaths.artifactsPath,
        stagedRelativePath: REDUCTION_FILENAME,
        artifactRelativePath: REDUCTION_FILENAME,
        deleteStaged: true,
      });
      await promoteWorkspaceFile({
        workspacePath: workspacePaths.workspacePath,
        artifactsPath: workspacePaths.artifactsPath,
        stagedRelativePath: REDUCTION_DATA_FILENAME,
        artifactRelativePath: REDUCTION_DATA_FILENAME,
        deleteStaged: true,
      });

      return {
        agentId: candidate.id,
        outputPath,
        dataPath,
        status: "succeeded",
        tokenUsage,
        tokenUsageResult,
      };
    },
    onCandidateCompleted: async (prepared, result) => {
      const completedAt = new Date().toISOString();
      await rewriteReductionRecord({
        root,
        reductionsFilePath,
        sessionId: reductionId,
        mutate: (record) =>
          mutateReducerRecord(record, {
            reducerAgentId: prepared.candidate.id,
            status: "succeeded",
            completedAt,
            error: null,
            tokenUsage: result.tokenUsage,
          }),
      });
      emitStageProgressEvent(renderer, {
        type: "stage.candidate",
        stage: "reduce",
        candidate: {
          reducerAgentId: prepared.candidate.id,
          status: "succeeded",
          completedAt,
          tokenUsage: result.tokenUsage,
          tokenUsageResult: result.tokenUsageResult,
        },
      });
    },
    captureExecutionFailure: async ({ prepared, error }) => {
      failure = failure ?? error;
      const detail = toErrorMessage(error);
      const completedAt = new Date().toISOString();
      const tokenUsageResult =
        tokenUsageResultByReducerAgentId.get(prepared.candidate.id) ??
        buildUnavailableTokenUsageResult({
          provider: prepared.candidate.provider,
          modelId: prepared.candidate.model,
        });
      const tokenUsage =
        tokenUsageResult.status === "available"
          ? tokenUsageResult.tokenUsage
          : undefined;
      try {
        await rewriteReductionRecord({
          root,
          reductionsFilePath,
          sessionId: reductionId,
          mutate: (record) =>
            mutateReducerRecord(record, {
              reducerAgentId: prepared.candidate.id,
              status: "failed",
              completedAt,
              error: detail,
              tokenUsage,
            }),
        });
      } catch {
        // Preserve the execution error.
      }
      emitStageProgressEvent(renderer, {
        type: "stage.candidate",
        stage: "reduce",
        candidate: {
          reducerAgentId: prepared.candidate.id,
          status: "failed",
          completedAt,
          tokenUsage,
          tokenUsageResult,
        },
      });
      return {
        agentId: prepared.candidate.id,
        outputPath: prepared.outputPath,
        dataPath: prepared.dataPath,
        status: "failed",
        tokenUsage,
        tokenUsageResult,
        error: detail,
      };
    },
    finalizeCompetition: async () => {
      const failed = failure !== undefined;
      await rewriteReductionRecord({
        root,
        reductionsFilePath,
        sessionId: reductionId,
        mutate: (record) => {
          const completedAt = record.completedAt ?? new Date().toISOString();
          const status = failed ? "failed" : "succeeded";
          return {
            ...record,
            status,
            completedAt,
            error: failed ? toErrorMessage(failure) : null,
            reducers: record.reducers.map((reducer) => {
              if (reducer.status !== "running") {
                return reducer;
              }
              return {
                ...reducer,
                status,
                completedAt,
                error: failed ? toErrorMessage(failure) : null,
              };
            }),
          };
        },
        forceFlush: true,
      }).catch(() => {});

      const finalizedRecord = await readReductionRecords({
        root,
        reductionsFilePath,
        limit: 1,
        predicate: (record) => record.sessionId === reductionId,
      })
        .then((records) => records[0])
        .catch(() => undefined);

      if (finalizedRecord) {
        for (const reducer of finalizedRecord.reducers) {
          emitStageProgressEvent(renderer, {
            type: "stage.candidate",
            stage: "reduce",
            candidate: {
              reducerAgentId: reducer.agentId,
              status: reducer.status,
              startedAt: reducer.startedAt,
              completedAt: reducer.completedAt,
              tokenUsage: reducer.tokenUsage,
              tokenUsageResult:
                tokenUsageResultByReducerAgentId.get(reducer.agentId) ??
                (reducer.tokenUsage
                  ? {
                      status: "available",
                      provider: "unknown",
                      modelId: "unknown",
                      tokenUsage: reducer.tokenUsage,
                    }
                  : buildUnavailableTokenUsageResult({
                      provider: "unknown",
                      modelId: "unknown",
                    })),
            },
          });
        }
        emitStageProgressEvent(renderer, {
          type: "stage.status",
          stage: "reduce",
          status: finalizedRecord.status,
        });
      } else {
        emitStageProgressEvent(renderer, {
          type: "stage.status",
          stage: "reduce",
          status: failed ? "failed" : "succeeded",
        });
      }

      for (const pathToPrune of pathsToPrune) {
        await pruneWorkspace(pathToPrune);
      }
    },
    sortResults: (left, right) => {
      if (left.status !== right.status) {
        return left.status === "succeeded" ? -1 : 1;
      }
      return left.agentId.localeCompare(right.agentId);
    },
  };
}

async function rewriteOrAppendReductionRecord(options: {
  root: string;
  reductionsFilePath: string;
  record: ReductionRecord;
}): Promise<void> {
  const { root, reductionsFilePath, record } = options;
  const existing = await readReductionRecords({
    root,
    reductionsFilePath,
    limit: 1,
    predicate: (entry) => entry.sessionId === record.sessionId,
  });
  if (existing.length > 0) {
    await rewriteReductionRecord({
      root,
      reductionsFilePath,
      sessionId: record.sessionId,
      mutate: () => record,
    });
    return;
  }

  const { appendReductionRecord } = await import("../persistence/adapter.js");
  await appendReductionRecord({ root, reductionsFilePath, record });
}

async function prepareReductionTargetContext(options: {
  root: string;
  specsFilePath: string;
  runsFilePath: string;
  reviewsFilePath: string;
  reductionsFilePath: string;
  target: ReductionTarget;
}): Promise<ReductionTargetContext> {
  const { target } = options;
  switch (target.type) {
    case "spec":
      return await prepareSpecTargetContext(options);
    case "run":
      return await prepareRunTargetContext(options);
    case "review":
      return await prepareReviewTargetContext(options);
    case "reduction":
      return await prepareReductionTargetContextInternal(options);
  }
}

async function prepareSpecTargetContext(options: {
  root: string;
  specsFilePath: string;
  target: ReductionTarget;
}): Promise<ReductionTargetContext> {
  const { root, specsFilePath, target } = options;
  const [record] = await readSpecRecords({
    root,
    specsFilePath,
    limit: 1,
    predicate: (entry) => entry.sessionId === target.id,
  });
  if (!record) {
    throw new Error(`Spec session \`${target.id}\` not found.`);
  }

  return {
    target,
    displayPath: normalizePathForDisplay(record.outputPath),
    stagedFiles: [
      {
        sourceAbsolutePath: resolvePath(root, record.outputPath),
        stagedRelativePath: "inputs/spec.md",
      },
    ],
    manifest: {
      target: {
        operator: "spec",
        id: record.sessionId,
        path: normalizePathForDisplay(record.outputPath),
        ...(record.tokenUsage ? { tokenUsage: record.tokenUsage } : {}),
      },
      artifacts: [
        {
          artifactId: "spec-output",
          kind: "spec",
          path: "inputs/spec.md",
        },
      ],
    },
  };
}

async function prepareRunTargetContext(options: {
  root: string;
  runsFilePath: string;
  target: ReductionTarget;
}): Promise<ReductionTargetContext> {
  const { root, runsFilePath, target } = options;
  const { records } = await fetchRunsSafely({
    root,
    runsFilePath,
    runId: target.id,
    filters: { includeDeleted: true },
  }).catch((error) => {
    if (error instanceof RunRecordNotFoundError) {
      throw new RunNotFoundCliError(target.id);
    }
    throw error;
  });
  const record = records[0];
  if (!record) {
    throw new RunNotFoundCliError(target.id);
  }

  const run = await buildRunRecordView(record, { workspaceRoot: root });
  const stagedFiles: StagedTargetFile[] = [
    {
      sourceAbsolutePath: resolvePath(root, run.spec.path),
      stagedRelativePath: "inputs/spec.md",
    },
  ];
  const artifacts: Array<Record<string, unknown>> = [
    {
      artifactId: "run-spec",
      kind: "spec",
      path: "inputs/spec.md",
    },
  ];

  for (const agent of run.agents) {
    const entry: Record<string, unknown> = {
      artifactId: `run-agent:${agent.agentId}`,
      kind: "run-agent",
      agentId: agent.agentId,
      status: agent.status,
      model: agent.model,
      evals: agent.evals.map((evaluation) => ({
        slug: evaluation.slug,
        status: evaluation.status,
        logPath: evaluation.logPath,
      })),
      ...(agent.tokenUsage ? { tokenUsage: agent.tokenUsage } : {}),
    };

    if (agent.assets.diffPath) {
      stagedFiles.push({
        sourceAbsolutePath: resolvePath(root, agent.assets.diffPath),
        stagedRelativePath: `inputs/agents/${agent.agentId}/diff.patch`,
      });
      entry.diffPath = `inputs/agents/${agent.agentId}/diff.patch`;
      entry.diffArtifactId = `run-agent:${agent.agentId}:diff`;
    }

    if (agent.assets.summaryPath) {
      stagedFiles.push({
        sourceAbsolutePath: resolvePath(root, agent.assets.summaryPath),
        stagedRelativePath: `inputs/agents/${agent.agentId}/summary.txt`,
      });
      entry.summaryPath = `inputs/agents/${agent.agentId}/summary.txt`;
      entry.summaryArtifactId = `run-agent:${agent.agentId}:summary`;
    }

    artifacts.push(entry);
  }

  return {
    target,
    displayPath: normalizePathForDisplay(`.voratiq/runs/sessions/${run.runId}`),
    stagedFiles,
    manifest: {
      target: {
        operator: "run",
        id: run.runId,
        path: `.voratiq/runs/sessions/${run.runId}`,
        specPath: "inputs/spec.md",
        status: run.status,
      },
      artifacts,
    },
  };
}

async function prepareReviewTargetContext(options: {
  root: string;
  reviewsFilePath: string;
  target: ReductionTarget;
}): Promise<ReductionTargetContext> {
  const { root, reviewsFilePath, target } = options;
  const [record] = await readReviewRecords({
    root,
    reviewsFilePath,
    limit: 1,
    predicate: (entry) => entry.sessionId === target.id,
  });
  if (!record) {
    throw new Error(`Review session \`${target.id}\` not found.`);
  }

  const stagedFiles: StagedTargetFile[] = [];
  const artifacts: Array<Record<string, unknown>> = [];

  for (const reviewer of record.reviewers) {
    const reviewRelative = `inputs/reviewers/${reviewer.agentId}/review.md`;
    stagedFiles.push({
      sourceAbsolutePath: resolvePath(root, reviewer.outputPath),
      stagedRelativePath: reviewRelative,
    });

    const recommendationPath = resolveStoredReviewRecommendationPath(
      root,
      reviewer.outputPath,
    );
    const recommendationRelative = `inputs/reviewers/${reviewer.agentId}/recommendation.json`;
    stagedFiles.push({
      sourceAbsolutePath: recommendationPath,
      stagedRelativePath: recommendationRelative,
    });

    artifacts.push({
      artifactId: `reviewer:${reviewer.agentId}`,
      kind: "reviewer",
      agentId: reviewer.agentId,
      status: reviewer.status,
      reviewPath: reviewRelative,
      recommendationPath: recommendationRelative,
      ...(reviewer.tokenUsage ? { tokenUsage: reviewer.tokenUsage } : {}),
    });
  }

  return {
    target,
    displayPath: `.voratiq/reviews/sessions/${record.sessionId}`,
    stagedFiles,
    manifest: {
      target: {
        operator: "review",
        id: record.sessionId,
        path: `.voratiq/reviews/sessions/${record.sessionId}`,
        runId: record.runId,
        blinded: record.blinded,
      },
      artifacts,
    },
  };
}

async function prepareReductionTargetContextInternal(options: {
  root: string;
  reductionsFilePath: string;
  target: ReductionTarget;
}): Promise<ReductionTargetContext> {
  const { root, reductionsFilePath, target } = options;
  const [record] = await readReductionRecords({
    root,
    reductionsFilePath,
    limit: 1,
    predicate: (entry) => entry.sessionId === target.id,
  });
  if (!record) {
    throw new Error(`Reduction session \`${target.id}\` not found.`);
  }

  const stagedFiles: StagedTargetFile[] = [];
  const artifacts: Array<Record<string, unknown>> = [];

  for (const reducer of record.reducers) {
    const reductionRelative = `inputs/reducers/${reducer.agentId}/reduction.md`;
    stagedFiles.push({
      sourceAbsolutePath: resolvePath(root, reducer.outputPath),
      stagedRelativePath: reductionRelative,
    });
    const dataAbsolute = reducer.dataPath
      ? resolvePath(root, reducer.dataPath)
      : resolveStoredReductionDataPath(root, reducer.outputPath);
    const dataRelative = `inputs/reducers/${reducer.agentId}/reduction.json`;
    stagedFiles.push({
      sourceAbsolutePath: dataAbsolute,
      stagedRelativePath: dataRelative,
    });

    artifacts.push({
      artifactId: `reducer:${reducer.agentId}`,
      kind: "reducer",
      agentId: reducer.agentId,
      status: reducer.status,
      reductionPath: reductionRelative,
      reductionDataPath: dataRelative,
      ...(reducer.tokenUsage ? { tokenUsage: reducer.tokenUsage } : {}),
    });
  }

  return {
    target,
    displayPath: `.voratiq/reductions/sessions/${record.sessionId}`,
    stagedFiles,
    manifest: {
      target: {
        operator: "reduction",
        id: record.sessionId,
        path: `.voratiq/reductions/sessions/${record.sessionId}`,
        sourceTarget: record.target,
      },
      artifacts,
    },
  };
}

async function stageReductionTargetContext(options: {
  workspacePath: string;
  targetContext: ReductionTargetContext;
}): Promise<void> {
  const { workspacePath, targetContext } = options;
  for (const stagedFile of targetContext.stagedFiles) {
    const destination = join(workspacePath, stagedFile.stagedRelativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(stagedFile.sourceAbsolutePath, destination);
  }

  const artifactInfoAbsolute = join(
    workspacePath,
    REDUCTION_ARTIFACT_INFO_FILENAME,
  );
  await mkdir(dirname(artifactInfoAbsolute), { recursive: true });
  await writeJsonFile(artifactInfoAbsolute, targetContext.manifest);
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8"),
  );
}

function buildReductionOutputPath(options: {
  root: string;
  reductionId: string;
  reducerAgentId: string;
}): string {
  const { root, reductionId, reducerAgentId } = options;
  return normalizePathForDisplay(
    relativeToRoot(
      root,
      resolvePath(
        root,
        `.voratiq/reductions/sessions/${reductionId}/${reducerAgentId}/artifacts/${REDUCTION_FILENAME}`,
      ),
    ),
  );
}

function buildReductionDataPath(options: {
  root: string;
  reductionId: string;
  reducerAgentId: string;
}): string {
  const { root, reductionId, reducerAgentId } = options;
  return normalizePathForDisplay(
    relativeToRoot(
      root,
      resolvePath(
        root,
        `.voratiq/reductions/sessions/${reductionId}/${reducerAgentId}/artifacts/${REDUCTION_DATA_FILENAME}`,
      ),
    ),
  );
}

function mutateReducerRecord(
  record: ReductionRecord,
  options: {
    reducerAgentId: string;
    status: "running" | "succeeded" | "failed" | "aborted";
    startedAt?: string;
    completedAt?: string;
    error: string | null;
    tokenUsage?: ExtractedTokenUsage;
    tokenUsageResult?: TokenUsageResult;
  },
): ReductionRecord {
  const { reducerAgentId, status, startedAt, completedAt, error, tokenUsage } =
    options;
  let found = false;
  const reducers = record.reducers.map((reducer) => {
    if (reducer.agentId !== reducerAgentId) {
      return reducer;
    }
    found = true;
    return {
      ...reducer,
      status,
      ...(startedAt ? { startedAt: reducer.startedAt ?? startedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
      error,
      ...(tokenUsage ? { tokenUsage } : {}),
    };
  });
  if (!found) {
    throw new Error(
      `Reduction record ${record.sessionId} is missing reducer ${reducerAgentId}.`,
    );
  }
  return {
    ...record,
    reducers,
  };
}

async function assertReductionOutputExists(
  root: string,
  workspacePaths: AgentWorkspacePaths,
): Promise<void> {
  const reductionStagedPath = join(
    workspacePaths.workspacePath,
    REDUCTION_FILENAME,
  );
  const reductionDataStagedPath = join(
    workspacePaths.workspacePath,
    REDUCTION_DATA_FILENAME,
  );

  let reductionContent: string;
  try {
    reductionContent = await readFile(reductionStagedPath, "utf8");
  } catch (error) {
    throw new Error(
      `Required reducer artifact is missing: \`${REDUCTION_FILENAME}\`. ${toErrorMessage(error)}`,
    );
  }

  let reductionDataContent: string;
  try {
    reductionDataContent = await readFile(reductionDataStagedPath, "utf8");
  } catch (error) {
    throw new Error(
      `Required reducer artifact is missing: \`${REDUCTION_DATA_FILENAME}\`. ${toErrorMessage(error)}`,
    );
  }

  validateReductionOutputContract({
    reductionMarkdown: reductionContent,
  });

  parseReductionArtifact(reductionDataContent);

  const stderrDisplay = normalizePathForDisplay(
    relativeToRoot(root, workspacePaths.stderrPath),
  );
  if (
    reductionContent.trim().length === 0 ||
    reductionDataContent.trim().length === 0
  ) {
    throw new Error(
      `Reducer output is empty. Inspect \`${stderrDisplay}\` to diagnose the reducer failure.`,
    );
  }
}

function resolveStoredReviewRecommendationPath(
  root: string,
  outputPath: string,
): string {
  return resolvePath(root, dirname(outputPath), REVIEW_RECOMMENDATION_FILENAME);
}

function resolveStoredReductionDataPath(
  root: string,
  outputPath: string,
): string {
  return resolvePath(root, dirname(outputPath), REDUCTION_DATA_FILENAME);
}
