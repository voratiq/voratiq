import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { detectAgentProcessFailureDetail } from "../../../agents/runtime/failures.js";
import { runSandboxedAgent } from "../../../agents/runtime/harness.js";
import type {
  CompetitionCommandAdapter,
  CompetitionPreparationResult,
} from "../../../competition/command-adapter.js";
import {
  type ResolvedExtraContextFile,
  stageExtraContextFiles,
} from "../../../competition/shared/extra-context.js";
import { composeStageSandboxPolicy } from "../../../competition/shared/sandbox-policy.js";
import type { TeardownController } from "../../../competition/shared/teardown.js";
import type { AgentDefinition } from "../../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../../configs/environment/types.js";
import {
  buildUnavailableTokenUsageResult,
  resolveTokenUsage,
} from "../../../domain/shared/token-usage.js";
import { emitStageProgressEvent } from "../../../render/transcripts/stage-progress.js";
import type { VerifyProgressRenderer } from "../../../render/transcripts/verify.js";
import { toErrorMessage } from "../../../utils/errors.js";
import { pathExists } from "../../../utils/fs.js";
import { prepareScratchAgentWorkspace } from "../../../workspace/agents.js";
import { extractProviderNativeTokenUsageForSession } from "../../../workspace/chat/native-usage.js";
import type { TokenUsageResult } from "../../../workspace/chat/token-usage-result.js";
import { ensureWorkspaceDependencies } from "../../../workspace/dependencies.js";
import {
  type AgentWorkspacePaths,
  buildScopedAgentWorkspacePaths,
} from "../../../workspace/layout.js";
import {
  getVerificationRubricExecutionDirectoryPath,
  getVerificationRubricResultPath,
  VORATIQ_VERIFICATION_DIR,
} from "../../../workspace/structure.js";
import type { ExtractedTokenUsage } from "../../run/model/types.js";
import type { VerificationRecordMutators } from "../model/mutators.js";
import {
  type VerificationResultArtifact,
  verificationResultArtifactSchema,
} from "../model/types.js";
import { writeVerificationArtifact } from "./artifacts.js";
import {
  assertNoVerificationIdentityLeak,
  assertRubricResultSelectorsMatchAliasMap,
  buildForbiddenVerificationIdentityTokens,
  parseRubricResultPayload,
} from "./blinding.js";
import { buildRubricPrompt, type RubricTemplateContents } from "./prompt.js";
import {
  attachVerifierWorkspaceMounts,
  buildStagedVerificationInputs,
  sharedInputsUseReferenceRepo,
  type SharedVerificationInputs,
} from "./shared-layout.js";
import type { ResolvedVerificationTarget } from "./target.js";

export interface VerifyCompetitionCandidate {
  readonly agent: AgentDefinition;
  readonly template: RubricTemplateContents;
}

export interface PreparedVerifyCompetitionCandidate {
  readonly candidate: VerifyCompetitionCandidate;
  readonly workspacePaths: AgentWorkspacePaths;
}

export type VerifyCompetitionExecution =
  | {
      readonly template: string;
      readonly verifierId: string;
      readonly status: "failed";
      readonly artifactPath: string;
      readonly startedAt: string;
      readonly completedAt: string;
      readonly error: string;
      readonly tokenUsage?: ExtractedTokenUsage;
      readonly tokenUsageResult: TokenUsageResult;
    }
  | {
      readonly template: string;
      readonly verifierId: string;
      readonly status: "succeeded";
      readonly artifactPath: string;
      readonly startedAt: string;
      readonly completedAt: string;
      readonly tokenUsage?: ExtractedTokenUsage;
      readonly tokenUsageResult: TokenUsageResult;
    };

export interface CreateVerifyCompetitionAdapterInput {
  readonly root: string;
  readonly verificationId: string;
  readonly resolvedTarget: ResolvedVerificationTarget;
  readonly aliasMap?: Record<string, string>;
  readonly environment: EnvironmentConfig;
  readonly extraContextFiles: readonly ResolvedExtraContextFile[];
  readonly sharedInputs: SharedVerificationInputs;
  readonly teardown: TeardownController;
  readonly mutators: VerificationRecordMutators;
  readonly renderer?: VerifyProgressRenderer;
}

export function createVerifyCompetitionAdapter(
  input: CreateVerifyCompetitionAdapterInput,
): CompetitionCommandAdapter<
  VerifyCompetitionCandidate,
  PreparedVerifyCompetitionCandidate,
  VerifyCompetitionExecution
> {
  const {
    root,
    verificationId,
    resolvedTarget,
    aliasMap,
    environment,
    extraContextFiles,
    sharedInputs,
    teardown,
    mutators,
    renderer,
  } = input;

  const startedAtByExecutionKey = new Map<string, string>();
  const tokenUsageResultByExecutionKey = new Map<string, TokenUsageResult>();

  function executionKeyForCandidate(
    candidate: VerifyCompetitionCandidate,
  ): string {
    return `${candidate.template.template}:${candidate.agent.id}`;
  }

  return {
    prepareCandidates: (
      candidates,
    ): CompetitionPreparationResult<
      PreparedVerifyCompetitionCandidate,
      VerifyCompetitionExecution
    > => ({
      ready: candidates.map((candidate) => {
        const workspacePaths = buildVerifierRubricWorkspacePaths({
          root,
          verificationId,
          verifierId: candidate.agent.id,
          template: candidate.template.template,
        });
        registerScratchWorkspaceTeardown(
          teardown,
          workspacePaths,
          candidate.agent.id,
          candidate.template.template,
        );
        return { candidate, workspacePaths };
      }),
      failures: [],
    }),
    queueCandidate: async (candidate) => {
      await mutators.recordMethodSnapshot({
        method: "rubric",
        template: candidate.template.template,
        verifierId: candidate.agent.id,
        scope:
          resolvedTarget.target.kind === "run"
            ? { kind: "run" }
            : { kind: "target" },
        status: "queued",
      });
      emitStageProgressEvent(renderer, {
        type: "stage.candidate",
        stage: "verify",
        candidate: {
          methodKey: `rubric:${candidate.template.template}:${candidate.agent.id}`,
          verifierLabel: candidate.template.template,
          agentLabel: candidate.agent.id,
          status: "queued",
        },
      });
    },
    onCandidateRunning: async (prepared) => {
      const startedAt = new Date().toISOString();
      const executionKey = executionKeyForCandidate(prepared.candidate);
      startedAtByExecutionKey.set(executionKey, startedAt);
      await mutators.recordMethodSnapshot({
        method: "rubric",
        template: prepared.candidate.template.template,
        verifierId: prepared.candidate.agent.id,
        scope:
          resolvedTarget.target.kind === "run"
            ? { kind: "run" }
            : { kind: "target" },
        status: "running",
        startedAt,
      });
      emitStageProgressEvent(renderer, {
        type: "stage.candidate",
        stage: "verify",
        candidate: {
          methodKey: `rubric:${prepared.candidate.template.template}:${prepared.candidate.agent.id}`,
          verifierLabel: prepared.candidate.template.template,
          agentLabel: prepared.candidate.agent.id,
          status: "running",
          startedAt,
        },
      });
    },
    executeCandidate: async (prepared) => {
      const executionKey = executionKeyForCandidate(prepared.candidate);
      const startedAt =
        startedAtByExecutionKey.get(executionKey) ?? new Date().toISOString();
      const { workspacePaths } = prepared;

      await prepareScratchAgentWorkspace({ paths: workspacePaths });
      await attachVerifierWorkspaceMounts({
        workspacePath: workspacePaths.workspacePath,
        contextPath: workspacePaths.contextPath,
        sharedInputs,
      });
      await ensureWorkspaceDependencies({
        root,
        workspacePath: workspacePaths.workspacePath,
        environment,
      });
      await stageExtraContextFiles({
        contextPath: workspacePaths.contextPath,
        files: extraContextFiles,
      });

      const staged = buildStagedVerificationInputs({
        workspacePaths,
        sharedInputs,
      });
      const prompt = buildRubricPrompt({
        template: prepared.candidate.template,
        target: resolvedTarget.target,
        staged,
        extraContextFiles,
      });

      assertNoVerificationIdentityLeak({
        text: prompt,
        forbidden: buildForbiddenVerificationIdentityTokens({
          resolvedTarget,
          allowed: [
            prepared.candidate.agent.id,
            prepared.candidate.agent.model,
          ],
        }),
      });

      const sandboxPolicy = composeStageSandboxPolicy({
        stageWriteProtectedPaths: [
          workspacePaths.contextPath,
          join(workspacePaths.workspacePath, "context"),
          join(workspacePaths.workspacePath, "inputs"),
          sharedInputs.sharedInputsAbsolute,
          ...(sharedInputsUseReferenceRepo(sharedInputs)
            ? [
                join(workspacePaths.workspacePath, "reference_repo"),
                sharedInputs.referenceRepoAbsolute,
              ]
            : []),
        ],
      });

      const result = await runSandboxedAgent({
        root,
        sessionId: verificationId,
        sandboxStageId: "verify",
        agent: prepared.candidate.agent,
        prompt,
        environment,
        teardownAuthOnExit: false,
        captureChat: true,
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
        extraWriteProtectedPaths: sandboxPolicy.extraWriteProtectedPaths,
        extraReadProtectedPaths: sandboxPolicy.extraReadProtectedPaths,
      });
      const tokenUsageResult = await extractProviderNativeTokenUsageForSession({
        root,
        domain: VORATIQ_VERIFICATION_DIR,
        sessionId: verificationId,
        agentId: prepared.candidate.agent.id,
        provider: prepared.candidate.agent.provider,
        modelId: prepared.candidate.agent.model,
        chatCaptured: result.chat?.captured === true,
        format: result.chat?.format,
        artifactPath: result.chat?.artifactPath,
      });
      tokenUsageResultByExecutionKey.set(executionKey, tokenUsageResult);
      const tokenUsage = resolveTokenUsage(tokenUsageResult);

      const completedAt = new Date().toISOString();
      const artifactPath = getVerificationRubricResultPath({
        sessionId: verificationId,
        verifierId: prepared.candidate.agent.id,
        template: prepared.candidate.template.template,
      });

      if (result.exitCode !== 0 || result.errorMessage) {
        const detectedDetail =
          result.watchdog?.trigger && result.errorMessage
            ? result.errorMessage
            : await detectAgentProcessFailureDetail({
                provider: prepared.candidate.agent.provider,
                stdoutPath: workspacePaths.stdoutPath,
                stderrPath: workspacePaths.stderrPath,
              });
        const detail =
          detectedDetail ??
          result.errorMessage ??
          `Agent exited with code ${result.exitCode ?? "unknown"}`;
        await writeFailureRubricArtifact({
          root,
          artifactPath,
          verifierId: prepared.candidate.agent.id,
          template: prepared.candidate.template.template,
          generatedAt: completedAt,
          error: detail,
        });

        return {
          template: prepared.candidate.template.template,
          verifierId: prepared.candidate.agent.id,
          status: "failed",
          artifactPath,
          startedAt,
          completedAt,
          error: detail,
          tokenUsage,
          tokenUsageResult,
        };
      }

      const outputPath = resolve(workspacePaths.workspacePath, "result.json");
      if (!(await pathExists(outputPath))) {
        const detail = `Missing result.json. See stderr: ${workspacePaths.stderrPath}`;
        await writeFailureRubricArtifact({
          root,
          artifactPath,
          verifierId: prepared.candidate.agent.id,
          template: prepared.candidate.template.template,
          generatedAt: completedAt,
          error: detail,
        });
        return {
          template: prepared.candidate.template.template,
          verifierId: prepared.candidate.agent.id,
          status: "failed",
          artifactPath,
          startedAt,
          completedAt,
          error: detail,
          tokenUsage,
          tokenUsageResult,
        };
      }

      const raw = await readFile(outputPath, "utf8");
      try {
        assertNoVerificationIdentityLeak({
          text: raw,
          forbidden: buildForbiddenVerificationIdentityTokens({
            resolvedTarget,
            allowed: [
              prepared.candidate.agent.id,
              prepared.candidate.agent.model,
            ],
          }),
        });

        const resultPayload = parseRubricResultPayload(raw);
        const artifact = verificationResultArtifactSchema.parse({
          method: "rubric",
          template: prepared.candidate.template.template,
          verifierId: prepared.candidate.agent.id,
          generatedAt: completedAt,
          status: "succeeded" as const,
          result: resultPayload,
        } satisfies VerificationResultArtifact);

        assertRubricResultSelectorsMatchAliasMap({
          artifactPath,
          result: artifact.method === "rubric" ? artifact.result : undefined,
          aliasMap,
        });

        await writeVerificationArtifact({
          root,
          artifactPath,
          artifact,
        });

        return {
          template: prepared.candidate.template.template,
          verifierId: prepared.candidate.agent.id,
          status: "succeeded",
          artifactPath,
          startedAt,
          completedAt,
          tokenUsage,
          tokenUsageResult,
        };
      } catch (error) {
        const detail = toErrorMessage(error);
        await writeFailureRubricArtifact({
          root,
          artifactPath,
          verifierId: prepared.candidate.agent.id,
          template: prepared.candidate.template.template,
          generatedAt: completedAt,
          error: detail,
        });
        return {
          template: prepared.candidate.template.template,
          verifierId: prepared.candidate.agent.id,
          status: "failed",
          artifactPath,
          startedAt,
          completedAt,
          error: detail,
          tokenUsage,
          tokenUsageResult,
        };
      }
    },
    onCandidateCompleted: async (prepared, result) => {
      const executionKey = executionKeyForCandidate(prepared.candidate);
      await mutators.recordMethodSnapshot({
        method: "rubric",
        template: prepared.candidate.template.template,
        verifierId: prepared.candidate.agent.id,
        scope:
          resolvedTarget.target.kind === "run"
            ? { kind: "run" }
            : { kind: "target" },
        status: result.status,
        artifactPath: result.artifactPath,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        tokenUsage: result.tokenUsage,
        ...(result.status === "failed" ? { error: result.error } : {}),
      });
      emitStageProgressEvent(renderer, {
        type: "stage.candidate",
        stage: "verify",
        candidate: {
          methodKey: `rubric:${prepared.candidate.template.template}:${prepared.candidate.agent.id}`,
          verifierLabel: prepared.candidate.template.template,
          agentLabel: prepared.candidate.agent.id,
          status: result.status,
          startedAt: result.startedAt,
          completedAt: result.completedAt,
          artifactPath: result.artifactPath,
          tokenUsage: result.tokenUsage,
          tokenUsageResult: result.tokenUsageResult,
        },
      });
      startedAtByExecutionKey.delete(executionKey);
      tokenUsageResultByExecutionKey.delete(executionKey);
    },
    captureExecutionFailure: async ({ prepared, error }) => {
      const executionKey = executionKeyForCandidate(prepared.candidate);
      const startedAt =
        startedAtByExecutionKey.get(executionKey) ?? new Date().toISOString();
      const completedAt = new Date().toISOString();
      const artifactPath = getVerificationRubricResultPath({
        sessionId: verificationId,
        verifierId: prepared.candidate.agent.id,
        template: prepared.candidate.template.template,
      });
      const detail = toErrorMessage(error);
      const tokenUsageResult =
        tokenUsageResultByExecutionKey.get(executionKey) ??
        buildUnavailableTokenUsageResult({
          provider: prepared.candidate.agent.provider,
          modelId: prepared.candidate.agent.model,
          message: detail,
        });
      const tokenUsage = resolveTokenUsage(tokenUsageResult);

      await writeFailureRubricArtifact({
        root,
        artifactPath,
        verifierId: prepared.candidate.agent.id,
        template: prepared.candidate.template.template,
        generatedAt: completedAt,
        error: detail,
      });

      await mutators.recordMethodSnapshot({
        method: "rubric",
        template: prepared.candidate.template.template,
        verifierId: prepared.candidate.agent.id,
        scope:
          resolvedTarget.target.kind === "run"
            ? { kind: "run" }
            : { kind: "target" },
        status: "failed",
        artifactPath,
        startedAt,
        completedAt,
        tokenUsage,
        error: detail,
      });
      emitStageProgressEvent(renderer, {
        type: "stage.candidate",
        stage: "verify",
        candidate: {
          methodKey: `rubric:${prepared.candidate.template.template}:${prepared.candidate.agent.id}`,
          verifierLabel: prepared.candidate.template.template,
          agentLabel: prepared.candidate.agent.id,
          status: "failed",
          startedAt,
          completedAt,
          artifactPath,
          tokenUsage,
          tokenUsageResult,
        },
      });
      startedAtByExecutionKey.delete(executionKey);
      tokenUsageResultByExecutionKey.delete(executionKey);
      return {
        template: prepared.candidate.template.template,
        verifierId: prepared.candidate.agent.id,
        status: "failed",
        artifactPath,
        startedAt,
        completedAt,
        error: detail,
        tokenUsage,
        tokenUsageResult,
      };
    },
    sortResults: compareVerificationsByTemplateThenVerifierId,
  };
}

async function writeFailureRubricArtifact(options: {
  root: string;
  artifactPath: string;
  verifierId: string;
  template: string;
  generatedAt: string;
  error: string;
}): Promise<void> {
  const { root, artifactPath, verifierId, template, generatedAt, error } =
    options;

  await writeVerificationArtifact({
    root,
    artifactPath,
    artifact: {
      method: "rubric",
      template,
      verifierId,
      generatedAt,
      status: "failed",
      result: {},
      error,
    },
  });
}

function buildVerifierRubricWorkspacePaths(options: {
  root: string;
  verificationId: string;
  verifierId: string;
  template: string;
}): AgentWorkspacePaths {
  const { root, verificationId, verifierId, template } = options;
  return buildScopedAgentWorkspacePaths({
    agentRoot: resolve(
      root,
      getVerificationRubricExecutionDirectoryPath({
        sessionId: verificationId,
        verifierId,
        template,
      }),
    ),
  });
}

function compareVerificationsByTemplateThenVerifierId(
  left: VerifyCompetitionExecution,
  right: VerifyCompetitionExecution,
): number {
  return (
    left.template.localeCompare(right.template) ||
    left.verifierId.localeCompare(right.verifierId)
  );
}

function registerScratchWorkspaceTeardown(
  teardown: TeardownController,
  workspacePaths: AgentWorkspacePaths,
  verifierId: string,
  template: string,
): void {
  const labelPrefix = `${verifierId}/${template}`;
  teardown.addPath(workspacePaths.workspacePath, `${labelPrefix} workspace`);
  teardown.addPath(workspacePaths.contextPath, `${labelPrefix} context`);
  teardown.addPath(workspacePaths.runtimePath, `${labelPrefix} runtime`);
  teardown.addPath(workspacePaths.sandboxPath, `${labelPrefix} sandbox`);
}
