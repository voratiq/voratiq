import { CliError } from "../../cli/errors.js";

export class ReviewError extends CliError {
  constructor(
    headline: string,
    detailLines: readonly string[] = [],
    hintLines: readonly string[] = [],
  ) {
    super(headline, detailLines, hintLines);
    this.name = "ReviewError";
  }
}

export class ReviewAgentNotFoundError extends ReviewError {
  constructor(public readonly agentId: string) {
    super(
      `Agent "${agentId}" not found in agents.yaml.`,
      [],
      ["To add this agent, edit `.voratiq/agents.yaml`."],
    );
    this.name = "ReviewAgentNotFoundError";
  }
}

export class ReviewGenerationFailedError extends ReviewError {
  constructor(
    detailLines: readonly string[] = [],
    hintLines: readonly string[] = [],
  ) {
    super("Review generation failed.", detailLines, hintLines);
    this.name = "ReviewGenerationFailedError";
  }
}

export class ReviewNoEligibleCandidatesError extends ReviewError {
  constructor() {
    super("Review generation failed. No eligible candidates to review.");
    this.name = "ReviewNoEligibleCandidatesError";
  }
}
