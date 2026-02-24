import { CliError } from "../cli/errors.js";

export class RunNotFoundCliError extends CliError {
  constructor(runId: string) {
    super(
      `Run \`${runId}\` not found.`,
      [],
      ["Check available runs with `voratiq list`."],
    );
    this.name = "RunNotFoundCliError";
  }
}
