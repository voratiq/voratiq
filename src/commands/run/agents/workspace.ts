import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentId } from "../../../configs/agents/types.js";
import type { EnvironmentConfig } from "../../../configs/environment/types.js";
import { normalizePathForDisplay, resolvePath } from "../../../utils/path.js";
import { prepareAgentWorkspace } from "../../../workspace/agents.js";
import {
  type AgentWorkspacePaths,
  buildAgentWorkspacePaths,
} from "../../../workspace/layout.js";
import {
  getAgentSessionDiffPath,
  getAgentSessionEvalsDirectoryPath,
  getAgentSessionSummaryPath,
  VORATIQ_RUNS_DIR,
} from "../../../workspace/structure.js";

export const WORKSPACE_SUMMARY_FILENAME = ".summary.txt" as const;

export interface RunAgentWorkspacePaths extends AgentWorkspacePaths {
  diffPath: string;
  summaryPath: string;
  evalsDirPath: string;
}

export async function buildRunAgentWorkspace(options: {
  root: string;
  runId: string;
  agentId: AgentId;
  baseRevisionSha: string;
  environment: EnvironmentConfig;
}): Promise<RunAgentWorkspacePaths> {
  const { root, runId, agentId, baseRevisionSha, environment } = options;
  const corePaths = buildAgentWorkspacePaths({
    root,
    runId,
    agentId,
  });
  const workspacePaths = buildRunAgentWorkspacePaths({
    root,
    runId,
    agentId,
    corePaths,
  });
  await prepareAgentWorkspace({
    paths: corePaths,
    baseRevisionSha,
    root,
    agentId,
    runId,
    environment,
  });
  await ensureRunArtifactWorkspace(workspacePaths);
  return workspacePaths;
}

async function ensureRunArtifactWorkspace(
  paths: RunAgentWorkspacePaths,
): Promise<void> {
  await mkdir(paths.evalsDirPath, { recursive: true });
  await mkdir(dirname(paths.diffPath), { recursive: true });
  await mkdir(dirname(paths.summaryPath), { recursive: true });
  await writeFile(paths.diffPath, "", { encoding: "utf8" });
  await writeFile(paths.summaryPath, "", { encoding: "utf8" });
}

export function buildRunAgentWorkspacePaths(options: {
  root: string;
  runId: string;
  agentId: AgentId;
  corePaths: AgentWorkspacePaths;
}): RunAgentWorkspacePaths {
  const { root, runId, agentId, corePaths } = options;
  const diffRelative = normalizePathForDisplay(
    getAgentSessionDiffPath(VORATIQ_RUNS_DIR, runId, agentId),
  );
  const summaryRelative = normalizePathForDisplay(
    getAgentSessionSummaryPath(VORATIQ_RUNS_DIR, runId, agentId),
  );
  const evalsRelative = normalizePathForDisplay(
    getAgentSessionEvalsDirectoryPath(VORATIQ_RUNS_DIR, runId, agentId),
  );

  return {
    ...corePaths,
    diffPath: resolvePath(root, diffRelative),
    summaryPath: resolvePath(root, summaryRelative),
    evalsDirPath: resolvePath(root, evalsRelative),
  };
}
