import { execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

import { colorize } from "../utils/colors.js";

export interface UpdatePromptDeps {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  execCommand?: (command: string) => void;
}

/**
 * Show the interactive update prompt and handle user choice.
 * Returns true if the process should exit (update was performed),
 * false if the user chose to skip (continue original command).
 */
export async function showUpdatePrompt(
  notice: string,
  deps: UpdatePromptDeps,
): Promise<boolean> {
  const { stdin, stdout, execCommand = defaultExecCommand } = deps;

  stdout.write(`\n${notice}\n`);
  stdout.write("\nWhat would you like to do?\n");
  stdout.write("  [1] Update now (npm install -g voratiq@latest)\n");
  stdout.write("  [2] Skip\n");

  const rl = createInterface({
    input: stdin,
    output: stdout,
  });

  try {
    for (;;) {
      const answer = await rl.question("[1]: ");
      const trimmed = answer.trim();
      const normalized = trimmed.length === 0 ? "1" : trimmed;

      if (normalized === "1") {
        stdout.write(
          "  Updating Voratiq via `npm install -g voratiq@latest`\n",
        );
        execCommand("npm install -g voratiq@latest");
        stdout.write("\n");
        const successLine = colorize(
          "  Update completed. Please rerun your command.",
          "green",
        );
        stdout.write(`${successLine}\n`);
        return true;
      }

      if (normalized === "2") {
        return false;
      }

      stdout.write("Please choose 1 or 2.\n");
    }
  } finally {
    rl.close();
  }
}

function defaultExecCommand(command: string): void {
  execSync(command, { stdio: "inherit" });
}
