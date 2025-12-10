import { CliError } from "../../cli/errors.js";
import { formatErrorMessage } from "../../utils/output.js";
import { renderTranscript } from "./transcript.js";

export function renderCliError(error: CliError): string {
  const sections: string[][] = [];

  const primary: string[] = [formatErrorMessage(error.headline)];
  if (error.detailLines.length > 0) {
    primary.push("", ...error.detailLines);
  }
  sections.push(primary);

  if (error.hintLines.length > 0) {
    sections.push([...error.hintLines]);
  }

  return renderTranscript({ sections });
}
