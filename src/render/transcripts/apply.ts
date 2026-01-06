import type { ApplyResult } from "../../commands/apply/types.js";
import { colorize } from "../../utils/colors.js";
import { formatRunWorkspaceRelative } from "../../workspace/layout.js";
import {
  buildAgentArtifactPaths,
  buildAgentEvalViews,
  getAgentDirectoryPath,
  getAgentManifestPath,
} from "../../workspace/structure.js";
import type { AgentSectionInput } from "../utils/agents.js";
import { formatRunTimestamp } from "../utils/records.js";
import { renderTranscriptWithMetadata } from "./shared.js";

export function renderApplyTranscript(result: ApplyResult): string {
  const agent = result.agent;
  const artifacts = agent.artifacts ?? {};
  const { startedAt, completedAt } = agent;

  if (!startedAt || !completedAt) {
    throw new Error("apply transcript requires agent lifecycle timestamps");
  }

  const assets = buildAgentArtifactPaths({
    runId: result.runId,
    agentId: agent.agentId,
    artifacts,
  });

  const agentDisplay = {
    ...agent,
    startedAt,
    completedAt,
    baseDirectory: getAgentDirectoryPath(result.runId, agent.agentId),
    runtimeManifestPath: getAgentManifestPath(result.runId, agent.agentId),
    assets,
    evals: buildAgentEvalViews({
      runId: result.runId,
      agentId: agent.agentId,
      evals: agent.evals,
    }),
  } satisfies AgentSectionInput;

  const warnings = result.ignoredBaseMismatch
    ? [
        `${colorize("Warning:", "yellow")} Applied despite base mismatch (\`--ignore-base-mismatch\`).`,
      ]
    : undefined;

  const afterAgentsLines = [colorize("Diff applied to working tree.", "green")];
  if (result.appliedCommitSha) {
    afterAgentsLines.push(`Commit created: ${result.appliedCommitSha}`);
  }

  return renderTranscriptWithMetadata({
    metadata: {
      runId: result.runId,
      status: result.status,
      specPath: result.specPath,
      workspacePath: formatRunWorkspaceRelative(result.runId),
      createdAt: formatRunTimestamp(result.createdAt),
      baseRevisionSha: result.baseRevisionSha,
    },
    agents: [agentDisplay],
    warnings,
    afterAgents: [afterAgentsLines],
    hint: {
      message: result.appliedCommitSha
        ? "Review the commit (e.g., `git show --stat`) and run tests."
        : "Review changes (e.g., `git status`) and run tests before committing.",
    },
  });
}
