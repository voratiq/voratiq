import {
  appendExtraContextPromptSection,
  type ResolvedExtraContextFile,
} from "../../../competition/shared/extra-context.js";
import {
  appendConstraints,
  appendOutputRequirements,
  buildWorkspaceArtifactRequirements,
} from "../../../competition/shared/prompt-helpers.js";

export interface BuildSpecPromptOptions {
  description: string;
  title?: string;
  markdownOutputPath: string;
  dataOutputPath: string;
  repoRootPath: string;
  workspacePath: string;
  extraContextFiles?: readonly ResolvedExtraContextFile[];
}

export function buildSpecPrompt(options: BuildSpecPromptOptions): string {
  const {
    description,
    title,
    markdownOutputPath,
    dataOutputPath,
    repoRootPath,
    workspacePath,
    extraContextFiles = [],
  } = options;

  const lines: string[] = [
    "Write a spec for the task described below.",
    "",
    "A spec defines **what** to build and **why**, not **how**. Don't prescribe implementation details—agents choose the approach.",
  ];

  if (title) {
    lines.push("", `Title: ${title}`);
  }

  lines.push(
    "",
    "User description:",
    "```",
    description.trim(),
    "```",
    "",
    "Required spec structure:",
    "- **H1 title**",
    "- **## Objective** — concise prose stating the goal.",
    "- **## Scope** — flat bullet list.",
    "- **## Acceptance Criteria** — flat bullet list. Each item independently verifiable, focused on observable outcomes.",
    "- **## Constraints** — flat bullet list.",
    "- **## Exit Signal** — concise prose.",
    "- **## Out of Scope** (optional) — flat bullet list when useful to prevent scope creep.",
    "",
    "Authoring guidance:",
    "- State the goal explicitly and unambiguously.",
    "- Reference existing code for context, not to dictate where changes go.",
    "- Be direct, concrete, and executable.",
    "- Include needed external context inline—don't reference URLs that agents cannot access.",
    "- Do not embed runtime or execution environment details (sandbox constraints, headless mode, file-access rules) in the spec content. Those are agent instructions, not spec content.",
  );

  appendConstraints(lines, {
    stageId: "spec",
    repoRootPath,
    workspacePath,
  });
  appendExtraContextPromptSection(lines, extraContextFiles);
  appendOutputRequirements(
    lines,
    buildWorkspaceArtifactRequirements(
      [
        {
          instruction: "Save the spec as markdown",
          path: markdownOutputPath,
        },
        {
          instruction: "Save the same spec as JSON",
          path: dataOutputPath,
          schema: {
            leadIn: "with this shape",
            content: [
              "`{`",
              "`  title: string,`",
              "`  objective: string,`",
              "`  scope: string[],`",
              "`  acceptanceCriteria: string[],`",
              "`  constraints: string[],`",
              "`  exitSignal: string,`",
              "`  outOfScope?: string[],`",
              "`}`",
            ],
          },
        },
      ],
      ["- Both files must describe the same spec."],
    ),
  );

  return `${lines.join("\n")}\n`;
}
