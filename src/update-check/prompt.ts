import { spawnSync } from "node:child_process";

import type { CommandOutputWriter } from "../cli/output.js";
import {
  renderUpdateProgressLines,
  renderUpdatePromptPreface,
} from "../render/transcripts/update-check.js";
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
  writeCommandOutput?: CommandOutputWriter;
  execCommand?: (command: string, args: readonly string[]) => void;
}

export interface UpdatePromptResult {
  shouldExit: boolean;
  exitCode?: number;
}

const UPDATE_COMMAND = "npm";
const UPDATE_ARGS = ["install", "-g", "voratiq@latest"] as const;

/**
 * Show the interactive update prompt and handle user choice.
 * Returns an object indicating whether the process should exit and with what code.
 */
export async function showUpdatePrompt(
  notice: string,
  deps: UpdatePromptDeps,
): Promise<UpdatePromptResult> {
  const {
    prompt,
    write,
    writeCommandOutput,
    execCommand = defaultExecCommand,
  } = deps;

  let firstPrompt = true;

  for (;;) {
    const response = await prompt({
      message: "[1]",
      prefaceLines: firstPrompt
        ? renderUpdatePromptPreface(notice, firstPrompt)
        : undefined,
    });
    const trimmed = response.trim();
    const normalized = trimmed.length === 0 ? "1" : trimmed;

    if (normalized === "1") {
      write(`${renderUpdateProgressLines().join("\n")}\n`);
      try {
        execCommand(UPDATE_COMMAND, UPDATE_ARGS);
      } catch {
        writeStatusLine(
          "Update failed. Please try again manually.",
          "red",
          write,
          writeCommandOutput,
        );
        return { shouldExit: true, exitCode: 1 };
      }
      writeStatusLine(
        "Update completed. Please rerun your command.",
        "green",
        write,
        writeCommandOutput,
      );
      return { shouldExit: true, exitCode: 0 };
    }

    if (normalized === "2") {
      return { shouldExit: false };
    }

    write("Please choose 1 or 2.\n");
    firstPrompt = false;
  }
}

function writeStatusLine(
  message: string,
  color: "green" | "red",
  fallbackWrite: UpdatePromptWriter,
  writeCommandOutput?: CommandOutputWriter,
): void {
  const rendered = colorize(message, color);
  if (writeCommandOutput) {
    writeCommandOutput({ body: rendered });
    return;
  }

  fallbackWrite("\n");
  fallbackWrite(rendered);
  fallbackWrite("\n");
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
