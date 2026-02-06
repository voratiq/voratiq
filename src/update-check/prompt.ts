import { spawnSync } from "node:child_process";

import { colorize } from "../utils/colors.js";

export interface UpdatePromptHandler {
  (options: { message: string; prefaceLines?: string[] }): Promise<string>;
}

export interface UpdatePromptWriter {
  (text: string): void;
}

export interface UpdatePromptDeps {
  prompt: UpdatePromptHandler;
  write: UpdatePromptWriter;
  execCommand?: (command: string, args: readonly string[]) => void;
}

export interface UpdatePromptResult {
  shouldExit: boolean;
  exitCode?: number;
}

const UPDATE_COMMAND = "npm";
const UPDATE_ARGS = ["install", "-g", "voratiq@latest"] as const;
const UPDATE_COMMAND_TEXT = `${UPDATE_COMMAND} ${UPDATE_ARGS.join(" ")}`;

/**
 * Show the interactive update prompt and handle user choice.
 * Returns an object indicating whether the process should exit and with what code.
 */
export async function showUpdatePrompt(
  notice: string,
  deps: UpdatePromptDeps,
): Promise<UpdatePromptResult> {
  const { prompt, write, execCommand = defaultExecCommand } = deps;

  const prefaceLines = [
    "",
    notice,
    "",
    "What would you like to do?",
    "  [1] Update now (npm install -g voratiq@latest)",
    "  [2] Skip",
  ];

  let firstPrompt = true;

  for (;;) {
    const response = await prompt({
      message: "[1]",
      prefaceLines: firstPrompt ? prefaceLines : undefined,
    });
    const trimmed = response.trim();
    const normalized = trimmed.length === 0 ? "1" : trimmed;

    if (normalized === "1") {
      write(`  Updating Voratiq via \`${UPDATE_COMMAND_TEXT}\`\n`);
      try {
        execCommand(UPDATE_COMMAND, UPDATE_ARGS);
      } catch {
        write("\n");
        write(colorize("  Update failed. Please try again manually.", "red"));
        write("\n");
        return { shouldExit: true, exitCode: 1 };
      }
      write("\n");
      write(
        colorize("  Update completed. Please rerun your command.", "green"),
      );
      write("\n");
      return { shouldExit: true, exitCode: 0 };
    }

    if (normalized === "2") {
      return { shouldExit: false };
    }

    write("Please choose 1 or 2.\n");
    firstPrompt = false;
  }
}

function defaultExecCommand(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`Update command exited with status ${result.status}`);
  }
  if (result.signal) {
    throw new Error(`Update command terminated with signal ${result.signal}`);
  }
}
