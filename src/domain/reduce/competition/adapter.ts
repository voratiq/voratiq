import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { detectAgentProcessFailureDetail } from "../../../agents/runtime/failures.js";
import { runSandboxedAgent } from "../../../agents/runtime/harness.js";
import { teardownSessionAuth } from "../../../agents/runtime/registry.js";
import { RunNotFoundCliError } from "../../../cli/errors.js";
import type {
  CompetitionCommandAdapter,
  CompetitionPreparationResult,
} from "../../../competition/command-adapter.js";
import {
  type ResolvedExtraContextFile,
  stageExtraContextFiles,
} from "../../../competition/shared/extra-context.js";
import { composeStageSandboxPolicy } from "../../../competition/shared/sandbox-policy.js";
import {
  createTeardownController,
  runTeardown,
} from "../../../competition/shared/teardown.js";
import type { AgentDefinition } from "../../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../../configs/environment/types.js";
import { readMessageRecords } from "../../../domain/message/persistence/adapter.js";
import { validateReductionOutputContract } from "../../../domain/reduce/competition/output-validation.js";
import { buildReducePrompt } from "../../../domain/reduce/competition/prompt.js";
import { parseReductionArtifact } from "../../../domain/reduce/competition/reduction.js";
import type {
  ReductionRecord,
  ReductionTarget,
} from "../../../domain/reduce/model/types.js";
import {
  readReductionRecords,
  rewriteReductionRecord,
} from "../../../domain/reduce/persistence/adapter.js";
import { buildRunRecordView } from "../../../domain/run/model/enhanced.js";
import { RunRecordNotFoundError } from "../../../domain/run/model/errors.js";
import type { ExtractedTokenUsage } from "../../../domain/run/model/types.js";
import { fetchRunsSafely } from "../../../domain/run/persistence/adapter.js";
import {
  buildLifecycleStartFields,
  buildOperationLifecycleCompleteFields,
  buildRecordLifecycleCompleteFields,
} from "../../../domain/shared/lifecycle.js";
import {
  buildUnavailableTokenUsageResult,
  reconstructTokenUsageResult,
  resolveTokenUsage,
} from "../../../domain/shared/token-usage.js";
import { readSpecRecords } from "../../../domain/spec/persistence/adapter.js";
import { readVerificationRecords } from "../../../domain/verify/persistence/adapter.js";
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
  MESSAGE_RESPONSE_FILENAME,
  REDUCTION_ARTIFACT_INFO_FILENAME,
  REDUCTION_DATA_FILENAME,
  REDUCTION_FILENAME,
  VORATIQ_REDUCTION_DIR,
} from "../../../workspace/structure.js";

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
  readonly messagesFilePath: string;
  readonly verificationsFilePath: string;
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
    messagesFilePath,
    verificationsFilePath,
    target,
    environment,
    extraContextFiles = [],
    renderer,
  } = input;

  let failure: unknown;
  const teardown = createTeardownController(`reduce \`${reductionId}\``);
  teardown.addAction({
    key: `reduce-auth:${reductionId}`,
    label: "session auth",
    cleanup: async () => {
      await teardownSessionAuth(reductionId);
    },
  });
  const tokenUsageResultByReducerAgentId = new Map<string, TokenUsageResult>();
  const tokenUsageIdentityByReducerAgentId = new Map<
    string,
    { provider: string; modelId: string }
  >();

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
        messagesFilePath,
        verificationsFilePath,
        reductionsFilePath,
        target,
      });

      const record: ReductionRecord = {
        sessionId: reductionId,
        target,
        createdAt,
        status: "queued",
        reducers: candidates.map((candidate) => ({
          agentId: candidate.id,
          status: "queued",
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
        tokenUsageIdentityByReducerAgentId.set(candidate.id, {
          provider: candidate.provider,
          modelId: candidate.model,
        });
        const workspacePaths = await scaffoldAgentSessionWorkspace({
          root,
          domain: VORATIQ_REDUCTION_DIR,
          sessionId: reductionId,
          agentId: candidate.id,
        });
        registerScratchWorkspaceTeardown(
          teardown,
          workspacePaths,
          candidate.id,
        );

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
        mutate: (record) => ({
          ...mutateReducerRecord(record, {
            reducerAgentId: prepared.candidate.id,
            status: "running",
            startedAt,
            error: null,
          }),
          status: record.status === "queued" ? "running" : record.status,
          ...buildLifecycleStartFields({
            existingStartedAt: record.startedAt,
            timestamp: startedAt,
          }),
        }),
      });
      emitStageProgressEvent(renderer, {
        type: "stage.status",
        stage: "reduce",
        status: "running",
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
        teardownAuthOnExit: false,
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
        domain: VORATIQ_REDUCTION_DIR,
        sessionId: reductionId,
        agentId: candidate.id,
        provider: candidate.provider,
        modelId: candidate.model,
        chatCaptured: result.chat?.captured === true,
        format: result.chat?.format,
        artifactPath: result.chat?.artifactPath,
      });
      tokenUsageResultByReducerAgentId.set(candidate.id, tokenUsageResult);
      const tokenUsage = resolveTokenUsage(tokenUsageResult);

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
      const tokenUsage = resolveTokenUsage(tokenUsageResult);
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
      const completedAt = new Date().toISOString();
      await rewriteReductionRecord({
        root,
        reductionsFilePath,
        sessionId: reductionId,
        mutate: (record) => {
          const recordComplete = buildRecordLifecycleCompleteFields({
            existing: record,
            startedAt: record.startedAt ?? completedAt,
            completedAt,
          });
          const status = failed ? "failed" : "succeeded";
          return {
            ...record,
            status,
            ...recordComplete,
            error: failed ? toErrorMessage(failure) : null,
            reducers: record.reducers.map((reducer) => {
              if (reducer.status !== "running" && reducer.status !== "queued") {
                return reducer;
              }
              return {
                ...reducer,
                status,
                ...buildOperationLifecycleCompleteFields({
                  existing: reducer,
                  startedAt: reducer.startedAt ?? recordComplete.completedAt,
                  completedAt: recordComplete.completedAt,
                }),
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
          const tokenUsageIdentity = tokenUsageIdentityByReducerAgentId.get(
            reducer.agentId,
          );
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
                reconstructTokenUsageResult({
                  tokenUsage: reducer.tokenUsage,
                  provider: tokenUsageIdentity?.provider,
                  modelId: tokenUsageIdentity?.modelId,
                }),
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

      await runTeardown(teardown);
    },
    sortResults: (left, right) => {
      if (left.status !== right.status) {
        return left.status === "succeeded" ? -1 : 1;
      }
      return left.agentId.localeCompare(right.agentId);
    },
  };
}

function registerScratchWorkspaceTeardown(
  teardown: ReturnType<typeof createTeardownController>,
  workspacePaths: AgentWorkspacePaths,
  agentId: string,
): void {
  teardown.addPath(workspacePaths.workspacePath, `${agentId} workspace`);
  teardown.addPath(workspacePaths.contextPath, `${agentId} context`);
  teardown.addPath(workspacePaths.runtimePath, `${agentId} runtime`);
  teardown.addPath(workspacePaths.sandboxPath, `${agentId} sandbox`);
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
  messagesFilePath: string;
  verificationsFilePath: string;
  reductionsFilePath: string;
  target: ReductionTarget;
}): Promise<ReductionTargetContext> {
  const { target } = options;
  switch (target.type) {
    case "spec":
      return await prepareSpecTargetContext(options);
    case "run":
      return await prepareRunTargetContext(options);
    case "verify":
      return await prepareVerificationTargetContext(options);
    case "reduce":
      return await prepareReductionTargetContextInternal(options);
    case "message":
      return await prepareMessageTargetContext(options);
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

  const generatedAgents = record.agents.filter(
    (agent): agent is typeof agent & { outputPath: string; dataPath: string } =>
      agent.status === "succeeded" &&
      typeof agent.outputPath === "string" &&
      typeof agent.dataPath === "string",
  );
  if (generatedAgents.length === 0) {
    throw new Error(
      `Spec session \`${target.id}\` has no generated artifacts.`,
    );
  }
  const stagedFiles: StagedTargetFile[] = [];
  const artifacts: Array<Record<string, unknown>> = [];
  for (const agent of generatedAgents) {
    const markdownRelative = `inputs/spec/${agent.agentId}/spec.md`;
    const dataRelative = `inputs/spec/${agent.agentId}/spec.json`;
    stagedFiles.push({
      sourceAbsolutePath: resolvePath(root, agent.outputPath),
      stagedRelativePath: markdownRelative,
    });
    stagedFiles.push({
      sourceAbsolutePath: resolvePath(root, agent.dataPath),
      stagedRelativePath: dataRelative,
    });
    artifacts.push({
      artifactId: `spec:${agent.agentId}`,
      kind: "spec",
      agentId: agent.agentId,
      markdownPath: markdownRelative,
      dataPath: dataRelative,
      ...(agent.tokenUsage ? { tokenUsage: agent.tokenUsage } : {}),
    });
  }

  return {
    target,
    displayPath: `.voratiq/spec/sessions/${record.sessionId}`,
    stagedFiles,
    manifest: {
      target: {
        operator: "spec",
        id: record.sessionId,
        path: `.voratiq/spec/sessions/${record.sessionId}`,
      },
      artifacts,
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
    displayPath: normalizePathForDisplay(`.voratiq/run/sessions/${run.runId}`),
    stagedFiles,
    manifest: {
      target: {
        operator: "run",
        id: run.runId,
        path: `.voratiq/run/sessions/${run.runId}`,
        specPath: "inputs/spec.md",
        status: run.status,
      },
      artifacts,
    },
  };
}

async function prepareVerificationTargetContext(options: {
  root: string;
  verificationsFilePath: string;
  target: ReductionTarget;
}): Promise<ReductionTargetContext> {
  const { root, verificationsFilePath, target } = options;
  const [record] = await readVerificationRecords({
    root,
    verificationsFilePath,
    limit: 1,
    predicate: (entry) => entry.sessionId === target.id,
  });
  if (!record) {
    throw new Error(`Verification session \`${target.id}\` not found.`);
  }

  const stagedFiles: StagedTargetFile[] = [];
  const artifacts: Array<Record<string, unknown>> = [];

  for (const method of record.methods) {
    if (!method.artifactPath) {
      continue;
    }
    const methodActor = method.verifierId ?? method.slug ?? "unknown";
    const templateSegment = method.template ?? "programmatic";
    const stagedRelativePath = `inputs/methods/${method.method}/${method.scope.kind}/${methodActor}/${templateSegment}/result.json`;
    stagedFiles.push({
      sourceAbsolutePath: resolvePath(root, method.artifactPath),
      stagedRelativePath,
    });
    artifacts.push({
      artifactId: `verification-method:${method.method}:${method.scope.kind}:${method.verifierId ?? method.slug ?? "unknown"}`,
      kind: "verification-method",
      method: method.method,
      scope: method.scope,
      status: method.status,
      ...(method.verifierId ? { verifierId: method.verifierId } : {}),
      ...(method.template ? { template: method.template } : {}),
      artifactPath: stagedRelativePath,
      ...(method.tokenUsage ? { tokenUsage: method.tokenUsage } : {}),
      ...(method.error ? { error: method.error } : {}),
    });
  }

  return {
    target,
    displayPath: `.voratiq/verify/sessions/${record.sessionId}`,
    stagedFiles,
    manifest: {
      target: {
        operator: "verify",
        id: record.sessionId,
        path: `.voratiq/verify/sessions/${record.sessionId}`,
        target: record.target,
        blinded: record.blinded,
        status: record.status,
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
    displayPath: `.voratiq/reduce/sessions/${record.sessionId}`,
    stagedFiles,
    manifest: {
      target: {
        operator: "reduce",
        id: record.sessionId,
        path: `.voratiq/reduce/sessions/${record.sessionId}`,
        sourceTarget: record.target,
      },
      artifacts,
    },
  };
}

async function prepareMessageTargetContext(options: {
  root: string;
  messagesFilePath: string;
  target: ReductionTarget;
}): Promise<ReductionTargetContext> {
  const { root, messagesFilePath, target } = options;
  const [record] = await readMessageRecords({
    root,
    messagesFilePath,
    limit: 1,
    predicate: (entry) => entry.sessionId === target.id,
  });
  if (!record) {
    throw new Error(`Message session \`${target.id}\` not found.`);
  }

  const succeededRecipients = record.recipients.filter(
    (recipient): recipient is typeof recipient & { outputPath: string } =>
      recipient.status === "succeeded" &&
      typeof recipient.outputPath === "string",
  );
  if (succeededRecipients.length === 0) {
    throw new Error(
      `Message session \`${target.id}\` has no generated artifacts.`,
    );
  }

  const stagedFiles: StagedTargetFile[] = [];
  const artifacts: Array<Record<string, unknown>> = [];

  for (const recipient of succeededRecipients) {
    const outputRelative = `inputs/recipients/${recipient.agentId}/${MESSAGE_RESPONSE_FILENAME}`;
    stagedFiles.push({
      sourceAbsolutePath: resolvePath(root, recipient.outputPath),
      stagedRelativePath: outputRelative,
    });
    artifacts.push({
      artifactId: `message:${recipient.agentId}`,
      kind: "message-output",
      agentId: recipient.agentId,
      status: recipient.status,
      outputPath: outputRelative,
      ...(recipient.tokenUsage ? { tokenUsage: recipient.tokenUsage } : {}),
    });
  }

  return {
    target,
    displayPath: `.voratiq/message/sessions/${record.sessionId}`,
    stagedFiles,
    manifest: {
      target: {
        operator: "message",
        id: record.sessionId,
        path: `.voratiq/message/sessions/${record.sessionId}`,
        status: record.status,
        prompt: record.prompt,
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
        `.voratiq/reduce/sessions/${reductionId}/${reducerAgentId}/artifacts/${REDUCTION_FILENAME}`,
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
        `.voratiq/reduce/sessions/${reductionId}/${reducerAgentId}/artifacts/${REDUCTION_DATA_FILENAME}`,
      ),
    ),
  );
}

function mutateReducerRecord(
  record: ReductionRecord,
  options: {
    reducerAgentId: string;
    status: "queued" | "running" | "succeeded" | "failed" | "aborted";
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
    const lifecycleFields = completedAt
      ? buildOperationLifecycleCompleteFields({
          existing: reducer,
          startedAt: reducer.startedAt ?? completedAt,
          completedAt,
        })
      : startedAt
        ? buildLifecycleStartFields({
            existingStartedAt: reducer.startedAt,
            timestamp: startedAt,
          })
        : {};
    return {
      ...reducer,
      status,
      ...lifecycleFields,
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

function resolveStoredReductionDataPath(
  root: string,
  outputPath: string,
): string {
  return resolvePath(root, dirname(outputPath), REDUCTION_DATA_FILENAME);
}
