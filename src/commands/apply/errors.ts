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

export class ApplyRunMetadataCorruptedError extends ApplyError {
  constructor(detail: string) {
    super(
      "Run history is corrupted.",
      [detail],
      ["Check `run/index.json` and the affected session directory."],
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
      `Agent \`${agentId}\` not found in run \`${runId}\`.`,
      [],
      ["Check available agents with `voratiq list`."],
    );
    this.name = "ApplyAgentNotFoundError";
  }
}

export class ApplyAgentSelectorUnresolvedError extends ApplyError {
  constructor(options: {
    runId: string;
    selector: string;
    canonicalAgentIds: readonly string[];
    aliases: readonly string[];
  }) {
    const { runId, selector, canonicalAgentIds, aliases } = options;
    const canonicalPreview = canonicalAgentIds
      .slice(0, 20)
      .map((agentId) => `\`${agentId}\``)
      .join(", ");
    const aliasPreview = aliases
      .slice(0, 20)
      .map((alias) => `\`${alias}\``)
      .join(", ");
    const detailLines = [
      ...(canonicalAgentIds.length > 0
        ? [
            `Available agent ids: ${canonicalPreview}${
              canonicalAgentIds.length > 20 ? ", ..." : ""
            }.`,
          ]
        : []),
      ...(aliases.length > 0
        ? [
            `Available blinded aliases: ${aliasPreview}${
              aliases.length > 20 ? ", ..." : ""
            }.`,
          ]
        : []),
    ];
    super(
      `Agent selector \`${selector}\` did not match run \`${runId}\`.`,
      detailLines,
      [
        "Use an agent id or a verification-selected blinded alias for this run.",
      ],
    );
    this.name = "ApplyAgentSelectorUnresolvedError";
  }
}

export class ApplyAgentSelectorAmbiguousError extends ApplyError {
  constructor(options: {
    runId: string;
    selector: string;
    matches: Array<{ verificationId: string; agentId: string }>;
  }) {
    const { runId, selector, matches } = options;
    const lines = matches
      .slice(0, 10)
      .map((match) => `- \`${match.verificationId}\`: \`${match.agentId}\``);
    super(
      `Blinded alias \`${selector}\` is ambiguous for run \`${runId}\`.`,
      [
        "This alias resolves differently across verification sessions:",
        ...lines,
        matches.length > 10 ? "- ..." : "",
      ].filter((line) => line.length > 0),
      ["Use a canonical agent id for this run."],
    );
    this.name = "ApplyAgentSelectorAmbiguousError";
  }
}

export class ApplyVerificationPolicyLoadError extends ApplyError {
  constructor(options: {
    runId: string;
    verificationFailures: readonly {
      verificationId: string;
      detail: string;
    }[];
  }) {
    const { runId, verificationFailures } = options;
    const detailLines = verificationFailures
      .slice(0, 10)
      .flatMap((failure) => [
        `Verification: \`${failure.verificationId}\`.`,
        failure.detail,
      ]);

    super(
      `Failed to load verification policy data for run \`${runId}\`.`,
      detailLines,
      [
        "Re-run `voratiq verify` for this run to regenerate verification artifacts.",
      ],
    );
    this.name = "ApplyVerificationPolicyLoadError";
  }
}

export class ApplyAgentDiffNotRecordedError extends ApplyError {
  constructor(
    public readonly runId: string,
    public readonly agentId: string,
  ) {
    super(
      `Agent \`${agentId}\` did not record a diff for run \`${runId}\`.`,
      [],
      ["Select an agent that produced a diff in the recorded run."],
    );
    this.name = "ApplyAgentDiffNotRecordedError";
  }
}

export class ApplyAgentDiffMissingOnDiskError extends ApplyError {
  constructor(public readonly diffPath: string) {
    super(
      "Recorded diff is missing from disk.",
      [`Expected diff: \`${diffPath}\`.`],
      ["Re-run to regenerate artifacts."],
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
      `Agent \`${agentId}\` did not record a summary for run \`${runId}\`.`,
      ["A summary artifact is required when using `--commit`."],
      ["Apply without `--commit` and write the commit message manually."],
    );
    this.name = "ApplyAgentSummaryNotRecordedError";
  }
}

export class ApplyAgentSummaryMissingOnDiskError extends ApplyError {
  constructor(public readonly summaryPath: string) {
    super(
      "Recorded summary is missing from disk.",
      [`Expected summary: \`${summaryPath}\`.`],
      ["Re-run to regenerate artifacts."],
    );
    this.name = "ApplyAgentSummaryMissingOnDiskError";
  }
}

export class ApplyAgentSummaryEmptyError extends ApplyError {
  constructor(public readonly summaryPath: string) {
    super(
      "Recorded summary is empty.",
      [`Expected summary with a commit subject: \`${summaryPath}\`.`],
      ["Apply without `--commit` and write the commit message manually."],
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
      `Repository HEAD \`${shortSha(headRevision)}\` no longer matches run base \`${shortSha(baseRevisionSha)}\`.`,
      [],
      ["Use `--ignore-base-mismatch` to apply anyway (conflicts may occur)."],
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
      "Failed to apply recorded diff.",
      [
        detail,
        `Run: \`${runId}\`, agent: \`${agentId}\`.`,
        `Patch: \`${diffPath}\`.`,
      ],
      ["Resolve the conflict, then re-run apply for the same run and agent."],
    );
    this.name = "ApplyPatchApplicationError";
  }
}

function shortSha(sha: string): string {
  return sha.length > 12 ? sha.slice(0, 12) : sha;
}
