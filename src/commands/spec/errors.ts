import { CliError } from "../../cli/errors.js";

export class SpecError extends CliError {
  constructor(
    headline: string,
    detailLines: readonly string[] = [],
    hintLines: readonly string[] = [],
  ) {
    super(headline, detailLines, hintLines);
    this.name = "SpecError";
  }
}

export class SpecAgentNotFoundError extends SpecError {
  constructor(public readonly agentId: string) {
    super(
      `Agent \`${agentId}\` not found in \`agents.yaml\`.`,
      [],
      ["Add this agent to `agents.yaml`."],
    );
    this.name = "SpecAgentNotFoundError";
  }
}

export class SpecOutputExistsError extends SpecError {
  constructor(outputPath: string) {
    super(
      `Output file already exists: \`${outputPath}\`.`,
      [],
      ["Use a different `--output` path or remove the existing file."],
    );
    this.name = "SpecOutputExistsError";
  }
}

export class SpecOutputPathError extends SpecError {
  constructor(message: string) {
    super(message, [], ["Use a path inside `specs/` or omit `--output`."]);
    this.name = "SpecOutputPathError";
  }
}

export class SpecGenerationFailedError extends SpecError {
  constructor(detailLines: readonly string[] = []) {
    super("Specification generation failed.", detailLines, [
      "Inspect `stderr.log` to diagnose the failure.",
    ]);
    this.name = "SpecGenerationFailedError";
  }
}
