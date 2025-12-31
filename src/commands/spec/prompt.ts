import {
  appendConstraints,
  appendOutputRequirements,
} from "../shared/prompt-helpers.js";

export interface BuildSpecPromptOptions {
  description: string;
  title?: string;
  feedback?: string;
  previousDraft?: string;
  draftOutputPath: string;
  repoRootPath: string;
  workspaceRootPath: string;
}

export function buildSpecDraftPrompt(options: BuildSpecPromptOptions): string {
  const {
    description,
    title,
    feedback,
    previousDraft,
    draftOutputPath,
    repoRootPath,
    workspaceRootPath,
  } = options;

  const lines: string[] = [
    "Translate the user description into a concise, repo-grounded Markdown spec.",
    "",
    "Specs describe **what** and **why**, not **how**. Don't prescribe implementation details—agents choose the approach.",
    "",
    "Context:",
    "- Agents run headlessly and cannot ask clarifying questions.",
    "- Don't assume external URL access; include needed context inline.",
    "",
    "Guidance:",
    "- State the goal explicitly and unambiguously.",
    "- Reference existing code for context, not to dictate where changes go.",
    "- Match structure to complexity—simple tasks need only a sentence or two.",
    "- Be direct; use bullets; avoid hedging.",
    "",
    "Structure (when needed):",
    "- H1 title, Summary, Context, Acceptance Criteria.",
    "",
    "Acceptance Criteria:",
    "- Each item must be independently verifiable.",
    "- Focus on observable outcomes, not implementation steps.",
  ];

  appendConstraints(lines, {
    readAccess: repoRootPath,
    writeAccess: workspaceRootPath,
  });
  appendOutputRequirements(lines, [
    `- Save the full spec to \`${draftOutputPath}\` in the workspace root.`,
  ]);

  if (previousDraft && previousDraft.trim().length > 0) {
    lines.push(
      "",
      "Previous draft to refine:",
      "```markdown",
      previousDraft.trimEnd(),
      "```",
    );
  }

  if (title) {
    lines.push("", `Title to use: ${title}`);
  }

  if (feedback && feedback.trim().length > 0) {
    lines.push(
      "",
      "Address this reviewer feedback without pausing for interaction:",
      feedback.trim(),
    );
  }

  lines.push("", "User description:", "```", description.trim(), "```");

  return `${lines.join("\n")}\n`;
}
