import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { normalizeDiffStatistics } from "../utils/diff.js";
import { isFileSystemError } from "../utils/fs.js";
import {
  type AgentArtifactPaths,
  buildAgentArtifactPaths,
  buildAgentEvalViews,
  getAgentDirectoryPath,
  getAgentManifestPath,
  getRunPromptPath,
} from "../workspace/structure.js";
import type {
  AgentEvalSnapshot,
  AgentStatus,
  RunApplyStatus,
  RunRecord,
  RunSpecDescriptor,
} from "./types.js";

export type AgentEvalEnhanced = AgentEvalSnapshot & {
  logPath?: string;
};

export interface AgentInvocationEnhanced {
  agentId: string;
  model: string;
  startedAt?: string;
  completedAt?: string;
  status: AgentStatus;
  commitSha?: string;
  runtimeManifestPath: string;
  baseDirectory: string;
  assets: AgentArtifactPaths;
  evals: AgentEvalEnhanced[];
  diffStatistics?: string;
  error?: string;
  warnings?: string[];
}

export interface RunRecordEnhanced {
  runId: string;
  createdAt: string;
  status: RunRecord["status"];
  baseRevisionSha: string;
  rootPath: string;
  spec: RunSpecDescriptor;
  promptPath: string;
  agents: AgentInvocationEnhanced[];
  deletedAt?: string | null;
  applyStatus?: RunApplyStatus;
}

export interface BuildRunRecordViewOptions {
  workspaceRoot?: string;
  includeDiffStatistics?: boolean;
}

export function buildRunRecordEnhanced(record: RunRecord): RunRecordEnhanced {
  const promptPath = getRunPromptPath(record.runId);

  const agents: AgentInvocationEnhanced[] = (record.agents ?? []).map(
    (agent) => {
      const baseDirectory = getAgentDirectoryPath(record.runId, agent.agentId);
      const runtimeManifestPath = getAgentManifestPath(
        record.runId,
        agent.agentId,
      );

      const assets = buildAgentArtifactPaths({
        runId: record.runId,
        agentId: agent.agentId,
        artifacts: agent.artifacts,
      });

      const evals: AgentEvalEnhanced[] = buildAgentEvalViews({
        runId: record.runId,
        agentId: agent.agentId,
        evals: agent.evals,
      });

      const enhancedAgent: AgentInvocationEnhanced = {
        agentId: agent.agentId,
        model: agent.model,
        status: agent.status,
        runtimeManifestPath,
        baseDirectory,
        assets,
        evals,
      };
      const normalizedDiff = normalizeDiffStatistics(agent.diffStatistics);
      if (normalizedDiff) {
        enhancedAgent.diffStatistics = normalizedDiff;
      }

      if (typeof agent.startedAt === "string") {
        enhancedAgent.startedAt = agent.startedAt;
      }
      if (typeof agent.completedAt === "string") {
        enhancedAgent.completedAt = agent.completedAt;
      }
      if (typeof agent.commitSha === "string") {
        enhancedAgent.commitSha = agent.commitSha;
      }
      if (typeof agent.error === "string") {
        enhancedAgent.error = agent.error;
      }
      if (Array.isArray(agent.warnings) && agent.warnings.length > 0) {
        enhancedAgent.warnings = [...agent.warnings];
      }

      return enhancedAgent;
    },
  );

  const enhanced: RunRecordEnhanced = {
    runId: record.runId,
    createdAt: record.createdAt,
    status: record.status,
    baseRevisionSha: record.baseRevisionSha,
    rootPath: record.rootPath,
    spec: record.spec,
    promptPath,
    agents,
  };

  if (Object.prototype.hasOwnProperty.call(record, "deletedAt")) {
    enhanced.deletedAt = record.deletedAt ?? null;
  }
  if (record.applyStatus) {
    enhanced.applyStatus = record.applyStatus;
  }

  return enhanced;
}

export async function buildRunRecordView(
  record: RunRecord,
  options: BuildRunRecordViewOptions = {},
): Promise<RunRecordEnhanced> {
  const enhanced = buildRunRecordEnhanced(record);

  if (options.includeDiffStatistics !== false && options.workspaceRoot) {
    await populateDiffStatistics(enhanced, options.workspaceRoot);
  }

  return enhanced;
}

async function populateDiffStatistics(
  run: RunRecordEnhanced,
  workspaceRoot: string,
): Promise<void> {
  await Promise.all(
    run.agents.map(async (agent) => {
      if (agent.diffStatistics) {
        return;
      }
      const diffPath = agent.assets.diffPath;
      if (!diffPath) {
        return;
      }

      try {
        const diffContent = await readFile(
          join(workspaceRoot, diffPath),
          "utf8",
        );
        const summary = summarizeDiff(diffContent);
        const normalizedSummary = normalizeDiffStatistics(summary);
        if (normalizedSummary) {
          agent.diffStatistics = normalizedSummary;
        }
      } catch (error) {
        if (isFileSystemError(error) && error.code === "ENOENT") {
          return;
        }
        throw error;
      }
    }),
  );
}

function summarizeDiff(diffContent: string): string | undefined {
  if (!diffContent.trim()) {
    return undefined;
  }

  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;

  for (const line of diffContent.split(/\r?\n/)) {
    if (line.startsWith("diff --git")) {
      filesChanged += 1;
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      insertions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  if (filesChanged === 0 && insertions === 0 && deletions === 0) {
    return undefined;
  }

  if (filesChanged === 0) {
    filesChanged = 1;
  }

  const parts = [
    `${filesChanged} file${filesChanged === 1 ? "" : "s"} changed`,
  ];
  if (insertions > 0) {
    parts.push(`${insertions} insertion${insertions === 1 ? "" : "s"}(+)`);
  }
  if (deletions > 0) {
    parts.push(`${deletions} deletion${deletions === 1 ? "" : "s"}(-)`);
  }

  return parts.join(", ");
}
