import {
  appendExtraContextPromptSection,
  type ResolvedExtraContextFile,
} from "../../../competition/shared/extra-context.js";
import {
  appendConstraints,
  appendOutputRequirements,
  buildWorkspaceArtifactRequirements,
} from "../../../competition/shared/prompt-helpers.js";

export interface BuildMessagePromptOptions {
  prompt: string;
  repoRootPath: string;
  workspacePath: string;
  extraContextFiles?: readonly ResolvedExtraContextFile[];
}

export function buildMessagePrompt(options: BuildMessagePromptOptions): string {
  const {
    prompt,
    repoRootPath,
    workspacePath,
    extraContextFiles = [],
  } = options;

  const lines: string[] = [
    "Respond to the prompt below using the available repository context.",
    "",
    "Guidance:",
    "- Inspect the repository directly when needed.",
    "- Keep the response focused on the prompt.",
    "",
    "Prompt:",
    "```",
    prompt.trim(),
    "```",
  ];

  appendConstraints(lines, {
    stageId: "message",
    repoRootPath,
    workspacePath,
  });
  appendExtraContextPromptSection(lines, extraContextFiles);
  appendOutputRequirements(
    lines,
    buildWorkspaceArtifactRequirements(
      [
        {
          instruction: "Write the response",
          path: "response.md",
        },
      ],
      ["- `response.md` is required."],
    ),
  );

  return `${lines.join("\n")}\n`;
}
