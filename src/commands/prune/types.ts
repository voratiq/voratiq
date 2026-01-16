import type { ConfirmationOptions } from "../../render/interactions/confirmation.js";

export type PruneConfirmationHandler = (
  options: ConfirmationOptions,
) => Promise<boolean>;

export interface PruneCommandInput {
  root: string;
  runsDir: string;
  runsFilePath: string;
  runId: string;
  confirm: PruneConfirmationHandler;
  purge?: boolean;
  clock?: () => Date;
}

export interface PruneAllCommandInput {
  root: string;
  runsDir: string;
  runsFilePath: string;
  confirm: PruneConfirmationHandler;
  purge?: boolean;
  clock?: () => Date;
}

export interface PruneBranchSummary {
  deleted: string[];
  skipped: string[];
}

export interface PruneWorkspaceSummary {
  removed: string[];
  missing: string[];
}

export interface PruneArtifactSummary {
  purged: boolean;
  removed: string[];
  missing: string[];
}

export interface PruneSuccessResult {
  status: "pruned";
  runId: string;
  specPath: string;
  runPath: string;
  createdAt: string;
  deletedAt: string;
  workspaces: PruneWorkspaceSummary;
  artifacts: PruneArtifactSummary;
  branches: PruneBranchSummary;
}

export interface PruneAbortedResult {
  status: "aborted";
  runId: string;
  specPath: string;
  runPath: string;
}

export type PruneResult = PruneSuccessResult | PruneAbortedResult;

export interface PruneAllSuccessResult {
  status: "pruned";
  runIds: string[];
}

export interface PruneAllNoopResult {
  status: "noop";
  runIds: string[];
}

export interface PruneAllAbortedResult {
  status: "aborted";
  runIds: string[];
}

export type PruneAllResult =
  | PruneAllSuccessResult
  | PruneAllNoopResult
  | PruneAllAbortedResult;
