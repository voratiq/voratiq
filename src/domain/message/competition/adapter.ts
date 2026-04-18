import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { detectAgentProcessFailureDetail } from "../../../agents/runtime/failures.js";
import { runSandboxedAgent } from "../../../agents/runtime/harness.js";
import { teardownSessionAuth } from "../../../agents/runtime/registry.js";
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
  registerScratchWorkspaceTeardownPaths,
  runTeardown,
  type TeardownController,
} from "../../../competition/shared/teardown.js";
import type { AgentDefinition } from "../../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../../configs/environment/types.js";
import {
  buildUnavailableTokenUsageResult,
  resolveTokenUsage,
} from "../../../domain/shared/token-usage.js";
import { toErrorMessage } from "../../../utils/errors.js";
import {
  normalizePathForDisplay,
  relativeToRoot,
  resolvePath,
} from "../../../utils/path.js";
import { extractProviderNativeTokenUsageForSession } from "../../../workspace/chat/native-usage.js";
import type { TokenUsageResult } from "../../../workspace/chat/token-usage-result.js";
import {
  MESSAGE_RESPONSE_FILENAME,
  VORATIQ_MESSAGE_DIR,
} from "../../../workspace/constants.js";
import {
  type AgentWorkspacePaths,
  scaffoldAgentSessionWorkspace,
} from "../../../workspace/layout.js";
import { promoteWorkspaceFile } from "../../../workspace/promotion.js";
import type { ExtractedTokenUsage } from "../../run/model/types.js";
import { buildMessagePrompt } from "./prompt.js";

export type MessageCompetitionCandidate = AgentDefinition;

export interface MessageCompetitionExecution {
  readonly agentId: string;
  readonly status: "succeeded" | "failed";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outputPath?: string;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly tokenUsage?: ExtractedTokenUsage;
  readonly tokenUsageResult: TokenUsageResult;
  readonly error?: string;
}

interface PreparedMessageCompetitionCandidate {
  readonly candidate: MessageCompetitionCandidate;
  readonly workspacePaths: AgentWorkspacePaths;
  readonly prompt: string;
}

export interface CreateMessageCompetitionAdapterInput {
  readonly root: string;
  readonly messageId: string;
  readonly prompt: string;
  readonly environment: EnvironmentConfig;
  readonly extraContextFiles?: readonly ResolvedExtraContextFile[];
  readonly teardown?: TeardownController;
}

export function createMessageCompetitionAdapter(
  input: CreateMessageCompetitionAdapterInput,
): CompetitionCommandAdapter<
  MessageCompetitionCandidate,
  PreparedMessageCompetitionCandidate,
  MessageCompetitionExecution
> {
  const {
    root,
    messageId,
    prompt,
    environment,
    extraContextFiles = [],
    teardown: providedTeardown,
  } = input;

  const teardown =
    providedTeardown ?? createTeardownController(`message \`${messageId}\``);
  const ownsTeardown = providedTeardown === undefined;
  teardown.addAction({
    key: `message-auth:${messageId}`,
    label: "session auth",
    cleanup: async () => {
      await teardownSessionAuth(messageId);
    },
  });

  return {
    failurePolicy: "continue",
    prepareCandidates: async (
      candidates,
    ): Promise<
      CompetitionPreparationResult<
        PreparedMessageCompetitionCandidate,
        MessageCompetitionExecution
      >
    > => {
      const ready: PreparedMessageCompetitionCandidate[] = [];
      const failures: MessageCompetitionExecution[] = [];

      for (const candidate of candidates) {
        const startedAt = new Date().toISOString();
        try {
          const workspacePaths = await scaffoldAgentSessionWorkspace({
            root,
            domain: VORATIQ_MESSAGE_DIR,
            sessionId: messageId,
            agentId: candidate.id,
          });
          registerScratchWorkspaceTeardownPaths(
            teardown,
            workspacePaths,
            candidate.id,
          );
          await stageExtraContextFiles({
            contextPath: workspacePaths.contextPath,
            files: extraContextFiles,
          });

          const builtPrompt = buildMessagePrompt({
            prompt,
            repoRootPath: root,
            workspacePath: workspacePaths.workspacePath,
            extraContextFiles,
          });

          ready.push({
            candidate,
            workspacePaths,
            prompt: builtPrompt,
          });
        } catch (error) {
          const completedAt = new Date().toISOString();
          failures.push({
            agentId: candidate.id,
            status: "failed",
            startedAt,
            completedAt,
            stdoutPath: buildStdoutDisplayPath(root, messageId, candidate.id),
            stderrPath: buildStderrDisplayPath(root, messageId, candidate.id),
            tokenUsageResult: buildUnavailableTokenUsageResult({
              provider: candidate.provider,
              modelId: candidate.model,
              message: toErrorMessage(error),
            }),
            error: toErrorMessage(error),
          });
        }
      }

      return { ready, failures };
    },
    executeCandidate: async (
      prepared,
    ): Promise<MessageCompetitionExecution> => {
      const { candidate, workspacePaths, prompt: builtPrompt } = prepared;
      const startedAt = new Date().toISOString();
      const sandboxPolicy = await composeStageSandboxPolicy({
        stageId: "message",
        root,
        workspacePath: workspacePaths.workspacePath,
        runtimePath: workspacePaths.runtimePath,
        sandboxHomePath: workspacePaths.sandboxHomePath,
        environment,
        contextPath: workspacePaths.contextPath,
        includeStagedContext: extraContextFiles.length > 0,
      });

      try {
        const result = await runSandboxedAgent({
          root,
          sessionId: messageId,
          sandboxStageId: "message",
          agent: candidate,
          prompt: builtPrompt,
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
          teardownAuthOnExit: false,
          ...sandboxPolicy,
        });

        const tokenUsageResult =
          await extractProviderNativeTokenUsageForSession({
            root,
            domain: VORATIQ_MESSAGE_DIR,
            sessionId: messageId,
            agentId: candidate.id,
            provider: candidate.provider,
            modelId: candidate.model,
            chatCaptured: result.chat?.captured === true,
            format: result.chat?.format,
            artifactPath: result.chat?.artifactPath,
          });
        const tokenUsage = resolveTokenUsage(tokenUsageResult);

        if (result.exitCode !== 0 || result.errorMessage) {
          const detail =
            (await detectAgentProcessFailureDetail({
              provider: candidate.provider,
              stdoutPath: workspacePaths.stdoutPath,
              stderrPath: workspacePaths.stderrPath,
            })) ??
            result.errorMessage ??
            `Agent exited with code ${result.exitCode ?? "unknown"}`;
          return {
            agentId: candidate.id,
            status: "failed",
            startedAt,
            completedAt: new Date().toISOString(),
            stdoutPath: normalizePathForDisplay(
              relativeToRoot(root, workspacePaths.stdoutPath),
            ),
            stderrPath: normalizePathForDisplay(
              relativeToRoot(root, workspacePaths.stderrPath),
            ),
            tokenUsage,
            tokenUsageResult,
            error: detail,
          };
        }

        const stagedResponsePath = join(
          workspacePaths.workspacePath,
          MESSAGE_RESPONSE_FILENAME,
        );
        await readFile(stagedResponsePath, "utf8");
        const responsePromoteResult = await promoteWorkspaceFile({
          workspacePath: workspacePaths.workspacePath,
          artifactsPath: workspacePaths.artifactsPath,
          stagedRelativePath: MESSAGE_RESPONSE_FILENAME,
          artifactRelativePath: MESSAGE_RESPONSE_FILENAME,
          deleteStaged: true,
        });

        return {
          agentId: candidate.id,
          status: "succeeded",
          startedAt,
          completedAt: new Date().toISOString(),
          outputPath: normalizePathForDisplay(
            relativeToRoot(root, responsePromoteResult.artifactPath),
          ),
          stdoutPath: normalizePathForDisplay(
            relativeToRoot(root, workspacePaths.stdoutPath),
          ),
          stderrPath: normalizePathForDisplay(
            relativeToRoot(root, workspacePaths.stderrPath),
          ),
          tokenUsage,
          tokenUsageResult,
        };
      } catch (error) {
        return {
          agentId: candidate.id,
          status: "failed",
          startedAt,
          completedAt: new Date().toISOString(),
          stdoutPath: normalizePathForDisplay(
            relativeToRoot(root, workspacePaths.stdoutPath),
          ),
          stderrPath: normalizePathForDisplay(
            relativeToRoot(root, workspacePaths.stderrPath),
          ),
          tokenUsageResult: buildUnavailableTokenUsageResult({
            provider: candidate.provider,
            modelId: candidate.model,
            message: toErrorMessage(error),
          }),
          error: toErrorMessage(error),
        };
      }
    },
    finalizeCompetition: async () => {
      if (ownsTeardown) {
        await runTeardown(teardown);
      }
    },
    sortResults: compareMessageExecutionsByAgentId,
  };
}

function compareMessageExecutionsByAgentId(
  left: MessageCompetitionExecution,
  right: MessageCompetitionExecution,
): number {
  return left.agentId.localeCompare(right.agentId);
}

function buildStdoutDisplayPath(
  root: string,
  messageId: string,
  agentId: string,
): string {
  return normalizePathForDisplay(
    relativeToRoot(
      root,
      resolvePath(
        root,
        `.voratiq/message/sessions/${messageId}/${agentId}/artifacts/stdout.log`,
      ),
    ),
  );
}

function buildStderrDisplayPath(
  root: string,
  messageId: string,
  agentId: string,
): string {
  return normalizePathForDisplay(
    relativeToRoot(
      root,
      resolvePath(
        root,
        `.voratiq/message/sessions/${messageId}/${agentId}/artifacts/stderr.log`,
      ),
    ),
  );
}
