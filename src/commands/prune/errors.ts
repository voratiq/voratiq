import { CliError } from "../../cli/errors.js";

export class PruneError extends CliError {
  constructor(
    headline: string,
    detailLines: readonly string[] = [],
    hintLines: readonly string[] = [],
  ) {
    super(headline, detailLines, hintLines);
    this.name = "PruneError";
  }
}

export class RunMetadataMissingError extends PruneError {
  constructor(public readonly runId: string) {
    super(
      `Run metadata for \`${runId}\` is missing.`,
      [`Expected \`record.json\` under \`run/sessions/${runId}/\`.`],
      ["Re-run the spec to regenerate this run before pruning."],
    );
    this.name = "RunMetadataMissingError";
  }
}

export class PruneBranchDeletionError extends PruneError {
  constructor(
    public readonly branch: string,
    public readonly detail: string,
  ) {
    super(
      `Failed to delete branch \`${branch}\`.`,
      [detail],
      ["Delete the branch manually, then retry prune."],
    );
    this.name = "PruneBranchDeletionError";
  }
}

export class PruneRunDeletedError extends PruneError {
  constructor(public readonly runId: string) {
    super(
      `Run \`${runId}\` has been deleted.`,
      [],
      ["Select a different run to prune."],
    );
    this.name = "PruneRunDeletedError";
  }
}
