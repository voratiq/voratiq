import { buildRunRecordEnhanced } from "../../runs/records/enhanced.js";
import { rewriteRunRecord } from "../../runs/records/persistence.js";
import type { RunApplyStatus } from "../../runs/records/types.js";
import { toErrorMessage } from "../../utils/errors.js";
import { ensureFileExists } from "../../utils/fs.js";
import {
  getGitStderr,
  getHeadRevision,
  runGitCommand,
} from "../../utils/git.js";
import { resolveDisplayPath } from "../../utils/path.js";
import { fetchRunSafely } from "../fetch.js";
import {
  ApplyAgentDiffMissingOnDiskError,
  ApplyAgentDiffNotRecordedError,
  ApplyAgentNotFoundError,
  ApplyBaseMismatchError,
  ApplyPatchApplicationError,
  ApplyRunDeletedError,
} from "./errors.js";
import type { ApplyResult } from "./types.js";

export interface ApplyCommandInput {
  root: string;
  runsFilePath: string;
  runId: string;
  agentId: string;
  ignoreBaseMismatch: boolean;
}

export async function executeApplyCommand(
  input: ApplyCommandInput,
): Promise<ApplyResult> {
  const { root, runsFilePath, runId, agentId, ignoreBaseMismatch } = input;

  const runRecord = await fetchRunSafely({
    root,
    runsFilePath,
    runId,
    onDeleted: (record) => new ApplyRunDeletedError(record.runId),
  });
  const enhanced = buildRunRecordEnhanced(runRecord);

  const agentRecord = runRecord.agents.find(
    (agent) => agent.agentId === agentId,
  );
  if (!agentRecord) {
    throw new ApplyAgentNotFoundError(runId, agentId);
  }

  const enhancedAgent = enhanced.agents.find(
    (agent) => agent.agentId === agentId,
  );
  if (!enhancedAgent) {
    throw new ApplyAgentNotFoundError(runId, agentId);
  }

  const diffRecorded = agentRecord.artifacts?.diffCaptured ?? false;
  const diffDisplayPath = enhancedAgent.assets.diffPath;
  if (!diffRecorded || !diffDisplayPath) {
    throw new ApplyAgentDiffNotRecordedError(runId, agentId);
  }

  const diffAbsolutePath =
    resolveDisplayPath(root, diffDisplayPath) ?? diffDisplayPath;
  await ensureFileExists(
    diffAbsolutePath,
    () => new ApplyAgentDiffMissingOnDiskError(diffDisplayPath),
  );

  const headRevision = await getHeadRevision(root);
  const baseRevisionSha = runRecord.baseRevisionSha;
  const baseMismatch = headRevision !== baseRevisionSha;
  const ignoredBaseMismatch = baseMismatch && ignoreBaseMismatch;

  if (baseMismatch && !ignoreBaseMismatch) {
    throw new ApplyBaseMismatchError({
      baseRevisionSha,
      headRevision,
    });
  }

  try {
    await applyPatch({
      root,
      diffAbsolutePath,
      diffDisplayPath,
      runId,
      agentId,
    });
  } catch (error) {
    if (error instanceof ApplyPatchApplicationError) {
      await recordApplyStatus({
        root,
        runsFilePath,
        runId,
        agentId,
        ignoredBaseMismatch,
        status: "failed",
        detail: extractApplyFailureDetail(error),
      });
    }
    throw error;
  }

  await recordApplyStatus({
    root,
    runsFilePath,
    runId,
    agentId,
    ignoredBaseMismatch,
    status: "succeeded",
  });

  return {
    runId: runRecord.runId,
    specPath: runRecord.spec.path,
    status: runRecord.status,
    createdAt: runRecord.createdAt,
    baseRevisionSha,
    headRevision,
    agent: agentRecord,
    diffPath: diffDisplayPath,
    ignoredBaseMismatch,
  };
}

async function applyPatch(options: {
  root: string;
  diffAbsolutePath: string;
  diffDisplayPath: string;
  runId: string;
  agentId: string;
}): Promise<void> {
  const { root, diffAbsolutePath, diffDisplayPath, runId, agentId } = options;
  try {
    await runGitCommand(
      ["apply", "--whitespace=nowarn", "--", diffAbsolutePath],
      {
        cwd: root,
      },
    );
  } catch (error) {
    const detail = getGitStderr(error) ?? toErrorMessage(error);
    throw new ApplyPatchApplicationError(
      detail,
      diffDisplayPath,
      runId,
      agentId,
    );
  }
}

interface RecordApplyStatusOptions {
  root: string;
  runsFilePath: string;
  runId: string;
  agentId: string;
  status: RunApplyStatus["status"];
  ignoredBaseMismatch: boolean;
  detail?: string;
}

async function recordApplyStatus(
  options: RecordApplyStatusOptions,
): Promise<void> {
  const {
    root,
    runsFilePath,
    runId,
    agentId,
    status,
    ignoredBaseMismatch,
    detail,
  } = options;

  const appliedAt = new Date().toISOString();
  const normalizedDetail =
    typeof detail === "string" && detail.length > 0
      ? truncateDetail(detail)
      : undefined;

  await rewriteRunRecord({
    root,
    runsFilePath,
    runId,
    mutate: (record) => {
      const applyStatus: RunApplyStatus = {
        agentId,
        appliedAt,
        status,
        ignoredBaseMismatch,
      };

      if (normalizedDetail !== undefined) {
        applyStatus.detail = normalizedDetail;
      }

      return {
        ...record,
        applyStatus,
      };
    },
  });
}

function extractApplyFailureDetail(
  error: ApplyPatchApplicationError,
): string | undefined {
  const [firstDetail] = error.detailLines;
  if (firstDetail && firstDetail.trim().length > 0) {
    return firstDetail.trim();
  }
  return error.message;
}

function truncateDetail(detail: string): string {
  const trimmed = detail.trim();
  return trimmed.length > 256 ? trimmed.slice(0, 256) : trimmed;
}
