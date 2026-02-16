import { detectAgentProcessFailureDetail } from "../../agents/runtime/failures.js";
import { runSandboxedAgent } from "../../agents/runtime/harness.js";
import type {
  CompetitionCommandAdapter,
  CompetitionPreparationResult,
} from "../../competition/command-adapter.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../configs/environment/types.js";
import { toErrorMessage } from "../../utils/errors.js";
import {
  normalizePathForDisplay,
  relativeToRoot,
  resolvePath,
} from "../../utils/path.js";
import {
  type AgentWorkspacePaths,
  buildAgentSessionWorkspacePaths,
  scaffoldAgentWorkspace,
} from "../../workspace/layout.js";
import { promoteWorkspaceFile } from "../../workspace/promotion.js";
import { VORATIQ_SPECS_DIR } from "../../workspace/structure.js";
import { pruneWorkspace } from "../shared/prune.js";
import { buildSpecPrompt } from "./prompt.js";

const SPEC_ARTIFACT_FILENAME = "spec.md";

export type SpecCompetitionCandidate = AgentDefinition;

export interface PreparedSpecCompetitionCandidate {
  readonly candidate: SpecCompetitionCandidate;
  readonly workspacePaths: AgentWorkspacePaths;
  readonly prompt: string;
}

export interface SpecCompetitionExecution {
  readonly agentId: string;
  readonly specPath: string;
  readonly status: "generated" | "failed";
  readonly error?: string;
}

export interface CreateSpecCompetitionAdapterInput {
  readonly root: string;
  readonly sessionId: string;
  readonly description: string;
  readonly specTitle?: string;
  readonly environment: EnvironmentConfig;
}

export function createSpecCompetitionAdapter(
  input: CreateSpecCompetitionAdapterInput,
): CompetitionCommandAdapter<
  SpecCompetitionCandidate,
  PreparedSpecCompetitionCandidate,
  SpecCompetitionExecution
> {
  const { root, sessionId, description, specTitle, environment } = input;

  const workspacesToPrune = new Set<string>();

  return {
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
          domain: VORATIQ_SPECS_DIR,
          sessionId,
          agentId: candidate.id,
        });
        workspacesToPrune.add(workspacePaths.workspacePath);

        try {
          await scaffoldAgentWorkspace(workspacePaths);

          const prompt = buildSpecPrompt({
            description,
            title: specTitle,
            outputPath: SPEC_ARTIFACT_FILENAME,
            repoRootPath: root,
            workspacePath: workspacePaths.workspacePath,
          });

          ready.push({
            candidate,
            workspacePaths,
            prompt,
          });
        } catch (error) {
          failures.push({
            agentId: candidate.id,
            specPath: resolveDraftSpecPath(root, workspacePaths.workspacePath),
            status: "failed",
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
          extraWriteProtectedPaths: [],
          extraReadProtectedPaths: [],
        });

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
            specPath: resolveDraftSpecPath(root, workspacePaths.workspacePath),
            status: "failed",
            error: detail,
          };
        }

        const promoteResult = await promoteWorkspaceFile({
          workspacePath: workspacePaths.workspacePath,
          artifactsPath: workspacePaths.artifactsPath,
          stagedRelativePath: SPEC_ARTIFACT_FILENAME,
          artifactRelativePath: SPEC_ARTIFACT_FILENAME,
          deleteStaged: true,
        });

        return {
          agentId: candidate.id,
          specPath: normalizePathForDisplay(
            relativeToRoot(root, promoteResult.artifactPath),
          ),
          status: "generated",
        };
      } catch (error) {
        return {
          agentId: candidate.id,
          specPath: resolveDraftSpecPath(root, workspacePaths.workspacePath),
          status: "failed",
          error: toErrorMessage(error),
        };
      }
    },
    finalizeCompetition: async () => {
      for (const workspacePath of workspacesToPrune) {
        await pruneWorkspace(workspacePath);
      }
    },
    sortResults: compareSpecExecutionsByAgentId,
  };
}

function resolveDraftSpecPath(root: string, workspacePath: string): string {
  return normalizePathForDisplay(
    relativeToRoot(root, resolvePath(workspacePath, SPEC_ARTIFACT_FILENAME)),
  );
}

function compareSpecExecutionsByAgentId(
  left: SpecCompetitionExecution,
  right: SpecCompetitionExecution,
): number {
  return left.agentId.localeCompare(right.agentId);
}
