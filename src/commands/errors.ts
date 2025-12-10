import { CliError } from "../cli/errors.js";

export class RunNotFoundCliError extends CliError {
  constructor(runId: string) {
    super(`Run ${runId} not found.`, ["To review past runs: voratiq list"]);
    this.name = "RunNotFoundCliError";
  }
}
