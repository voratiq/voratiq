import {
  appendExtraContextPromptSection,
  type ResolvedExtraContextFile,
} from "../../../competition/shared/extra-context.js";
import {
  appendConstraints,
  appendOutputRequirements,
  buildWorkspaceArtifactRequirements,
} from "../../../competition/shared/prompt-helpers.js";

export interface BuildRunPromptOptions {
  specContent: string;
  workspacePath: string;
  contextPath?: string;
  extraContextFiles?: readonly ResolvedExtraContextFile[];
}

export function buildRunPrompt(options: BuildRunPromptOptions): string {
  const {
    specContent,
    workspacePath,
    contextPath,
    extraContextFiles = [],
  } = options;

  const lines = [
    "Implement the following task:",
    "",
    "```",
    specContent.trimEnd(),
    "```",
  ];

  appendConstraints(lines, {
    stageId: "run",
    workspacePath,
    supplementalReadAccess:
      contextPath && extraContextFiles.length > 0 ? [contextPath] : [],
  });
  appendExtraContextPromptSection(lines, extraContextFiles);
  appendOutputRequirements(lines, [
    "- When finished, clean the workspace of temporary files/dirs you created (e.g., `tmp`, `.tmp`, etc.) unless they are intended deliverables.",
    ...buildWorkspaceArtifactRequirements([
      {
        instruction: "Then write a 1-2 sentence summary",
        path: ".summary.txt",
      },
    ]),
  ]);

  return `${lines.join("\n")}\n`;
}
