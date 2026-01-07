import { CliError } from "../../cli/errors.js";

export class ApplyError extends CliError {
  constructor(
    headline: string,
    detailLines: readonly string[] = [],
    hintLines: readonly string[] = [],
  ) {
    super(headline, detailLines, hintLines);
    this.name = "ApplyError";
  }
}

export class ApplyRunDeletedError extends ApplyError {
  constructor(public readonly runId: string) {
    super(
      `Run ${runId} has been deleted.`,
      [],
      ["Re-run the spec to generate fresh artifacts before applying."],
    );
    this.name = "ApplyRunDeletedError";
  }
}

export class ApplyRunMetadataCorruptedError extends ApplyError {
  constructor(detail: string) {
    super(
      "Run history is corrupted; cannot apply.",
      [detail],
      [
        "Inspect `.voratiq/runs/index.json` and the affected run directory under `.voratiq/runs/sessions/<id>` or regenerate the run with `voratiq run`.",
      ],
    );
    this.name = "ApplyRunMetadataCorruptedError";
  }
}

export class ApplyAgentNotFoundError extends ApplyError {
  constructor(
    public readonly runId: string,
    public readonly agentId: string,
  ) {
    super(
      `Agent ${agentId} not found in run ${runId}.`,
      [],
      [
        `To review run information: voratiq review --run ${runId} --agent <agent-id>.`,
      ],
    );
    this.name = "ApplyAgentNotFoundError";
  }
}

export class ApplyAgentDiffNotRecordedError extends ApplyError {
  constructor(
    public readonly runId: string,
    public readonly agentId: string,
  ) {
    super(`Agent ${agentId} did not record a diff for run ${runId}.`, [
      `Select an agent that produced a diff via \`voratiq review --run ${runId} --agent <agent-id>\`.`,
    ]);
    this.name = "ApplyAgentDiffNotRecordedError";
  }
}

export class ApplyAgentDiffMissingOnDiskError extends ApplyError {
  constructor(public readonly diffPath: string) {
    super(
      "Recorded diff is missing from disk.",
      [`Expected diff at ${diffPath} but it was not found.`],
      ["Ensure the run directory still exists or re-run the agents."],
    );
    this.name = "ApplyAgentDiffMissingOnDiskError";
  }
}

export class ApplyAgentSummaryNotRecordedError extends ApplyError {
  constructor(
    public readonly runId: string,
    public readonly agentId: string,
  ) {
    super(
      `Agent ${agentId} did not record a summary for run ${runId}.`,
      ["A summary artifact is required for `voratiq apply --commit`."],
      [
        "Re-run the spec to regenerate artifacts or apply without `--commit` and commit manually.",
      ],
    );
    this.name = "ApplyAgentSummaryNotRecordedError";
  }
}

export class ApplyAgentSummaryMissingOnDiskError extends ApplyError {
  constructor(public readonly summaryPath: string) {
    super(
      "Recorded summary is missing from disk.",
      [`Expected summary at ${summaryPath} but it was not found.`],
      ["Ensure the run directory still exists or re-run the agents."],
    );
    this.name = "ApplyAgentSummaryMissingOnDiskError";
  }
}

export class ApplyAgentSummaryEmptyError extends ApplyError {
  constructor(public readonly summaryPath: string) {
    super(
      "Recorded summary is empty.",
      [`Expected summary at ${summaryPath} to contain a commit subject.`],
      [
        "Re-run the spec to regenerate artifacts or apply without `--commit` and commit manually.",
      ],
    );
    this.name = "ApplyAgentSummaryEmptyError";
  }
}

export class ApplyGitCommitError extends ApplyError {
  constructor(detail: string) {
    super(
      "Failed to create git commit.",
      [detail],
      ["The diff remains applied; resolve the issue and commit manually."],
    );
    this.name = "ApplyGitCommitError";
  }
}

export interface ApplyBaseMismatchOptions {
  baseRevisionSha: string;
  headRevision: string;
}

export class ApplyBaseMismatchError extends ApplyError {
  constructor(options: ApplyBaseMismatchOptions) {
    const { baseRevisionSha, headRevision } = options;
    super(
      `Repository HEAD (${shortSha(headRevision)}) no longer matches the run's base revision (${shortSha(baseRevisionSha)}).`,
      [
        "Reset to the recorded base or rerun the specification, or pass `--ignore-base-mismatch` to proceed at your own risk.",
      ],
    );
    this.name = "ApplyBaseMismatchError";
  }
}

export class ApplyPatchApplicationError extends ApplyError {
  constructor(
    detail: string,
    diffPath: string,
    runId: string,
    agentId: string,
  ) {
    super(
      "Failed to apply the recorded diff.",
      [detail, `Inspect the patch at ${diffPath} for additional context.`],
      [
        `Resolve the conflict and rerun \`voratiq apply --run ${runId} --agent ${agentId}\`.`,
      ],
    );
    this.name = "ApplyPatchApplicationError";
  }
}

function shortSha(sha: string): string {
  return sha.length > 12 ? sha.slice(0, 12) : sha;
}
