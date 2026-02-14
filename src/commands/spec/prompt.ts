import {
  appendConstraints,
  appendOutputRequirements,
} from "../shared/prompt-helpers.js";

export interface BuildSpecPromptOptions {
  description: string;
  title?: string;
  outputPath: string;
  repoRootPath: string;
  workspacePath: string;
}

export function buildSpecPrompt(options: BuildSpecPromptOptions): string {
  const { description, title, outputPath, repoRootPath, workspacePath } =
    options;

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
    writeAccess: workspacePath,
  });
  appendOutputRequirements(lines, [
    `- Save the full spec to \`${outputPath}\` in the workspace root.`,
  ]);

  if (title) {
    lines.push("", `Title to use: ${title}`);
  }

  lines.push("", "User description:", "```", description.trim(), "```");

  return `${lines.join("\n")}\n`;
}
