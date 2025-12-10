export interface BuildAgentPromptOptions {
  specContent: string;
}

export function buildAgentPrompt(options: BuildAgentPromptOptions): string {
  const { specContent } = options;

  const lines = [
    "Implement the following task:",
    "",
    "```",
    specContent.trimEnd(),
    "```",
    "",
    "Constraints:",
    "- You are running headlessly. Never pause for user interaction.",
    "- You are sandboxed. If an operation is blocked, skip it and continue.",
    "- When finished, write a 1-2 sentence summary to `.summary.txt` (in the workspace root).",
  ];

  return `${lines.join("\n")}\n`;
}
