import {
  appendExtraContextPromptSection,
  type ResolvedExtraContextFile,
} from "../../../commands/shared/extra-context.js";
import {
  appendConstraints,
  appendOutputRequirements,
} from "../../../commands/shared/prompt-helpers.js";

export interface BuildRunPromptOptions {
  specContent: string;
  workspacePath: string;
  extraContextFiles?: readonly ResolvedExtraContextFile[];
}

export function buildRunPrompt(options: BuildRunPromptOptions): string {
  const { specContent, workspacePath, extraContextFiles = [] } = options;

  const lines = [
    "Implement the following task:",
    "",
    "```",
    specContent.trimEnd(),
    "```",
  ];

  appendConstraints(lines, {
    readAccess: workspacePath,
    writeAccess: workspacePath,
  });
  appendExtraContextPromptSection(lines, extraContextFiles);
  appendOutputRequirements(lines, [
    "- When finished, clean the workspace of temporary files/dirs you created (e.g., `tmp`, `.tmp`, etc.) unless they are intended deliverables.",
    "- Then write a 1-2 sentence summary to `.summary.txt` (in the workspace root).",
  ]);

  return `${lines.join("\n")}\n`;
}
