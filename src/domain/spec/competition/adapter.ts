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
  runTeardown,
} from "../../../competition/shared/teardown.js";
import type { AgentDefinition } from "../../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../../configs/environment/types.js";
import type { ExtractedTokenUsage } from "../../../domain/run/model/types.js";
import {
  buildUnavailableTokenUsageResult,
  resolveTokenUsage,
} from "../../../domain/shared/token-usage.js";
import { buildSpecPrompt } from "../../../domain/spec/competition/prompt.js";
import { parseSpecData } from "../../../domain/spec/model/output.js";
import { toErrorMessage } from "../../../utils/errors.js";
import {
  normalizePathForDisplay,
  relativeToRoot,
} from "../../../utils/path.js";
import { slugify } from "../../../utils/slug.js";
import { extractProviderNativeTokenUsageForSession } from "../../../workspace/chat/native-usage.js";
import type { TokenUsageResult } from "../../../workspace/chat/token-usage-result.js";
import {
  type AgentWorkspacePaths,
  buildAgentSessionWorkspacePaths,
  scaffoldAgentWorkspace,
} from "../../../workspace/layout.js";
import { promoteWorkspaceFile } from "../../../workspace/promotion.js";
import { VORATIQ_SPEC_DIR } from "../../../workspace/structure.js";

const SPEC_MARKDOWN_FILENAME = "spec.md";
const SPEC_DATA_FILENAME = "spec.json";

export type SpecCompetitionCandidate = AgentDefinition;

export interface PreparedSpecCompetitionCandidate {
  readonly candidate: SpecCompetitionCandidate;
  readonly workspacePaths: AgentWorkspacePaths;
  readonly prompt: string;
}

export interface SpecCompetitionExecution {
  readonly agentId: string;
  readonly outputPath?: string;
  readonly dataPath?: string;
  readonly status: "succeeded" | "failed";
  readonly tokenUsage?: ExtractedTokenUsage;
  readonly tokenUsageResult: TokenUsageResult;
  readonly error?: string;
}

export interface CreateSpecCompetitionAdapterInput {
  readonly root: string;
  readonly sessionId: string;
  readonly description: string;
  readonly specTitle?: string;
  readonly environment: EnvironmentConfig;
  readonly extraContextFiles?: readonly ResolvedExtraContextFile[];
}

export function createSpecCompetitionAdapter(
  input: CreateSpecCompetitionAdapterInput,
): CompetitionCommandAdapter<
  SpecCompetitionCandidate,
  PreparedSpecCompetitionCandidate,
  SpecCompetitionExecution
> {
  const {
    root,
    sessionId,
    description,
    specTitle,
    environment,
    extraContextFiles = [],
  } = input;

  const teardown = createTeardownController(`spec \`${sessionId}\``);
  teardown.addAction({
    key: `spec-auth:${sessionId}`,
    label: "session auth",
    cleanup: async () => {
      await teardownSessionAuth(sessionId);
    },
  });

  return {
    failurePolicy: "continue",
    prepareCandidates: async (
      candidates,
    ): Promise<
      CompetitionPreparationResult<
        PreparedSpecCompetitionCandidate,
        SpecCompetitionExecution
      >
    > => {
      const ready: PreparedSpecCompetitionCandidate[] = [];
      const failures: SpecCompetitionExecution[] = [];

      for (const candidate of candidates) {
        const workspacePaths = buildAgentSessionWorkspacePaths({
          root,
          domain: VORATIQ_SPEC_DIR,
          sessionId,
          agentId: candidate.id,
        });
        registerScratchWorkspaceTeardown(
          teardown,
          workspacePaths,
          candidate.id,
        );

        try {
          await scaffoldAgentWorkspace(workspacePaths);
          await stageExtraContextFiles({
            contextPath: workspacePaths.contextPath,
            files: extraContextFiles,
          });

          const prompt = buildSpecPrompt({
            description,
            title: specTitle,
            markdownOutputPath: SPEC_MARKDOWN_FILENAME,
            dataOutputPath: SPEC_DATA_FILENAME,
            repoRootPath: root,
            workspacePath: workspacePaths.workspacePath,
            extraContextFiles,
          });

          ready.push({
            candidate,
            workspacePaths,
            prompt,
          });
        } catch (error) {
          failures.push({
            agentId: candidate.id,
            status: "failed",
            tokenUsageResult: buildUnavailableTokenUsageResult({
              provider: candidate.provider,
              modelId: candidate.model,
              message: toErrorMessage(error),
            }),
            error: toErrorMessage(error),
          });
        }
      }

      return {
        ready,
        failures,
      };
    },
    executeCandidate: async (prepared): Promise<SpecCompetitionExecution> => {
      const { candidate, workspacePaths, prompt } = prepared;

      try {
        const result = await runSandboxedAgent({
          root,
          sessionId,
          sandboxStageId: "spec",
          agent: candidate,
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
          teardownAuthOnExit: false,
          ...composeStageSandboxPolicy(),
        });
        const tokenUsageResult =
          await extractProviderNativeTokenUsageForSession({
            root,
            domain: VORATIQ_SPEC_DIR,
            sessionId,
            agentId: candidate.id,
            provider: candidate.provider,
            modelId: candidate.model,
            chatCaptured: result.chat?.captured === true,
            format: result.chat?.format,
            artifactPath: result.chat?.artifactPath,
          });
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
          return {
            agentId: candidate.id,
            status: "failed",
            tokenUsage,
            tokenUsageResult,
            error: detail,
          };
        }

        const stagedMarkdownPath = join(
          workspacePaths.workspacePath,
          SPEC_MARKDOWN_FILENAME,
        );
        const stagedDataPath = join(
          workspacePaths.workspacePath,
          SPEC_DATA_FILENAME,
        );
        await readFile(stagedMarkdownPath, "utf8");
        const specData = parseSpecData(await readFile(stagedDataPath, "utf8"));
        const artifactBasename = slugify(specData.title, "spec");
        const artifactMarkdownFilename = `${artifactBasename}.md`;
        const artifactDataFilename = `${artifactBasename}.json`;

        const markdownPromoteResult = await promoteWorkspaceFile({
          workspacePath: workspacePaths.workspacePath,
          artifactsPath: workspacePaths.artifactsPath,
          stagedRelativePath: SPEC_MARKDOWN_FILENAME,
          artifactRelativePath: artifactMarkdownFilename,
          deleteStaged: true,
        });
        const dataPromoteResult = await promoteWorkspaceFile({
          workspacePath: workspacePaths.workspacePath,
          artifactsPath: workspacePaths.artifactsPath,
          stagedRelativePath: SPEC_DATA_FILENAME,
          artifactRelativePath: artifactDataFilename,
          deleteStaged: true,
        });

        return {
          agentId: candidate.id,
          outputPath: normalizePathForDisplay(
            relativeToRoot(root, markdownPromoteResult.artifactPath),
          ),
          dataPath: normalizePathForDisplay(
            relativeToRoot(root, dataPromoteResult.artifactPath),
          ),
          status: "succeeded",
          tokenUsage,
          tokenUsageResult,
        };
      } catch (error) {
        return {
          agentId: candidate.id,
          status: "failed",
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
      await runTeardown(teardown);
    },
    sortResults: compareSpecExecutionsByAgentId,
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

function compareSpecExecutionsByAgentId(
  left: SpecCompetitionExecution,
  right: SpecCompetitionExecution,
): number {
  return left.agentId.localeCompare(right.agentId);
}
