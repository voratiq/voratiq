import { CliError } from "../../cli/errors.js";

export class PruneError extends CliError {
  constructor(message: string) {
    super(message);
    this.name = "PruneError";
  }
}

export class RunMetadataMissingError extends PruneError {
  constructor(public readonly runId: string) {
    super(
      `Run metadata for ${runId} is missing from .voratiq/runs/sessions/${runId}/record.json; prune cannot proceed.`,
    );
    this.name = "RunMetadataMissingError";
  }
}

export class PruneBranchDeletionError extends PruneError {
  constructor(
    public readonly branch: string,
    public readonly detail: string,
  ) {
    super(`Failed to delete branch ${branch}: ${detail}`);
    this.name = "PruneBranchDeletionError";
  }
}

export class PruneRunDeletedError extends PruneError {
  constructor(public readonly runId: string) {
    super(`Run ${runId} has been deleted.`);
    this.name = "PruneRunDeletedError";
  }
}
