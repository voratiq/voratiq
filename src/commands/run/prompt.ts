import {
  appendConstraints,
  appendOutputRequirements,
} from "../shared/prompt-helpers.js";

export interface BuildRunPromptOptions {
  specContent: string;
  workspacePath: string;
}

export function buildRunPrompt(options: BuildRunPromptOptions): string {
  const { specContent, workspacePath } = options;

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
  appendOutputRequirements(lines, [
    "- When finished, clean the workspace of temporary files/dirs you created (e.g., `tmp`, `.tmp`, etc.) unless they are intended deliverables.",
    "- Then write a 1-2 sentence summary to `.summary.txt` (in the workspace root).",
  ]);

  return `${lines.join("\n")}\n`;
}
