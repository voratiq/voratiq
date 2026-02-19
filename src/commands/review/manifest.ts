import { basename } from "node:path";

import type { RunRecordEnhanced } from "../../runs/records/enhanced.js";
import { pathExists } from "../../utils/fs.js";
import { resolvePath } from "../../utils/path.js";

export type ReviewArtifactDescriptor = {
  path: string;
  exists: boolean;
};

export interface BlindedReviewManifest {
  version: number;
  run: {
    runId: string;
    status: string;
    specPath: string;
    baseRevisionSha: string;
    createdAt: string;
    completedAt?: string;
    baseSnapshotPath: string;
  };
  candidates: Array<{
    candidateId: string;
    status: string;
    commitSha?: string;
    diffStatistics?: string;
    artifacts: {
      diff?: ReviewArtifactDescriptor;
    };
    evals: Array<{
      slug: string;
      status: string;
      error?: string;
      exitCode?: number | null;
    }>;
    error?: string;
    warnings?: string[];
  }>;
}

export interface ReviewManifest {
  version: number;
  run: {
    runId: string;
    status: string;
    specPath: string;
    baseRevisionSha: string;
    createdAt: string;
    completedAt?: string;
  };
  agents: Array<{
    agentId: string;
    status: string;
    commitSha?: string;
    diffStatistics?: string;
    artifacts: {
      diff?: ReviewArtifactDescriptor;
      chat?: ReviewArtifactDescriptor;
      summary?: ReviewArtifactDescriptor;
      stdout?: ReviewArtifactDescriptor;
      stderr?: ReviewArtifactDescriptor;
    };
    evals: Array<{
      slug: string;
      status: string;
      log?: ReviewArtifactDescriptor;
      error?: string;
      exitCode?: number | null;
      command?: string;
    }>;
    error?: string;
    warnings?: string[];
  }>;
}

export async function buildReviewManifest(options: {
  root: string;
  run: RunRecordEnhanced;
}): Promise<{
  manifest: ReviewManifest;
  missingArtifacts: string[];
}> {
  const { root, run } = options;

  const missingNames: string[] = [];
  const seenMissing = new Set<string>();

  const noteMissing = (path: string) => {
    const name = basename(path);
    if (seenMissing.has(name)) {
      return;
    }
    seenMissing.add(name);
    missingNames.push(name);
  };

  const describe = async (
    repoRelativePath: string | undefined,
  ): Promise<ReviewArtifactDescriptor | undefined> => {
    if (!repoRelativePath) {
      return undefined;
    }
    const exists = await pathExists(resolvePath(root, repoRelativePath));
    if (!exists) {
      noteMissing(repoRelativePath);
    }
    return { path: repoRelativePath, exists };
  };

  const completedAt = resolveRunCompletedAt(run);

  const agents = await Promise.all(
    run.agents.map(async (agent) => {
      const artifacts = agent.assets;
      const diff = await describe(artifacts.diffPath);
      const chat = await describe(artifacts.chatPath);
      const summary = await describe(artifacts.summaryPath);
      const stdout = await describe(artifacts.stdoutPath);
      const stderr = await describe(artifacts.stderrPath);

      const evals = await Promise.all(
        agent.evals.map(async (evaluation) => ({
          slug: evaluation.slug,
          status: evaluation.status,
          ...(typeof evaluation.exitCode === "number" ||
          evaluation.exitCode === null
            ? { exitCode: evaluation.exitCode }
            : {}),
          ...(evaluation.command ? { command: evaluation.command } : {}),
          ...(evaluation.error ? { error: evaluation.error } : {}),
          ...(evaluation.logPath
            ? { log: await describe(evaluation.logPath) }
            : {}),
        })),
      );

      return {
        agentId: agent.agentId,
        status: agent.status,
        ...(agent.commitSha ? { commitSha: agent.commitSha } : {}),
        ...(agent.diffStatistics
          ? { diffStatistics: agent.diffStatistics }
          : {}),
        artifacts: {
          ...(diff ? { diff } : {}),
          ...(chat ? { chat } : {}),
          ...(summary ? { summary } : {}),
          ...(stdout ? { stdout } : {}),
          ...(stderr ? { stderr } : {}),
        },
        evals,
        ...(agent.error ? { error: agent.error } : {}),
        ...(agent.warnings ? { warnings: agent.warnings } : {}),
      };
    }),
  );

  return {
    manifest: {
      version: 1,
      run: {
        runId: run.runId,
        status: run.status,
        specPath: run.spec.path,
        baseRevisionSha: run.baseRevisionSha,
        createdAt: run.createdAt,
        ...(completedAt ? { completedAt } : {}),
      },
      agents,
    },
    missingArtifacts: missingNames,
  };
}

export async function buildBlindedReviewManifest(options: {
  root: string;
  run: RunRecordEnhanced;
  specPath: string;
  candidates: Array<{
    candidateId: string;
    agentId: string;
    stagedDiffPath: string;
    diffRecorded: boolean;
  }>;
  baseSnapshotPath: string;
}): Promise<{
  manifest: BlindedReviewManifest;
  missingArtifacts: string[];
}> {
  const { root, run, specPath, candidates, baseSnapshotPath } = options;

  const missingNames: string[] = [];
  const seenMissing = new Set<string>();

  const noteMissing = (path: string) => {
    const name = basename(path);
    if (seenMissing.has(name)) {
      return;
    }
    seenMissing.add(name);
    missingNames.push(name);
  };

  const describe = async (
    repoRelativePath: string | undefined,
    existsOverride?: boolean,
  ): Promise<ReviewArtifactDescriptor | undefined> => {
    if (!repoRelativePath) {
      return undefined;
    }
    const onDisk = await pathExists(resolvePath(root, repoRelativePath));
    const exists = (existsOverride ?? true) && onDisk;
    if (!exists) {
      noteMissing(repoRelativePath);
    }
    return { path: repoRelativePath, exists };
  };

  const completedAt = resolveRunCompletedAt(run);
  const byAgentId = new Map(run.agents.map((agent) => [agent.agentId, agent]));

  const blindedCandidates = await Promise.all(
    candidates.map(async (candidate) => {
      const agent = byAgentId.get(candidate.agentId);
      if (!agent) {
        throw new Error(
          `Unable to build blinded manifest: missing run agent for candidate ${candidate.candidateId}.`,
        );
      }

      const diff = await describe(
        candidate.stagedDiffPath,
        candidate.diffRecorded,
      );
      const evals = agent.evals.map((evaluation) => ({
        slug: evaluation.slug,
        status: evaluation.status,
        ...(evaluation.error ? { error: evaluation.error } : {}),
        ...(typeof evaluation.exitCode === "number" ||
        evaluation.exitCode === null
          ? { exitCode: evaluation.exitCode }
          : {}),
      }));

      return {
        candidateId: candidate.candidateId,
        status: agent.status,
        ...(agent.commitSha ? { commitSha: agent.commitSha } : {}),
        ...(agent.diffStatistics
          ? { diffStatistics: agent.diffStatistics }
          : {}),
        artifacts: {
          ...(diff ? { diff } : {}),
        },
        evals,
        ...(agent.error ? { error: agent.error } : {}),
        ...(agent.warnings ? { warnings: agent.warnings } : {}),
      };
    }),
  );

  return {
    manifest: {
      version: 1,
      run: {
        runId: run.runId,
        status: run.status,
        specPath,
        baseRevisionSha: run.baseRevisionSha,
        createdAt: run.createdAt,
        ...(completedAt ? { completedAt } : {}),
        baseSnapshotPath,
      },
      candidates: blindedCandidates,
    },
    missingArtifacts: missingNames,
  };
}

function resolveRunCompletedAt(run: RunRecordEnhanced): string | undefined {
  let latest: string | undefined;
  for (const agent of run.agents) {
    const completedAt = agent.completedAt;
    if (!completedAt) {
      continue;
    }
    if (!latest || completedAt > latest) {
      latest = completedAt;
    }
  }
  return latest;
}
