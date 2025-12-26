#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Command, CommanderError } from "commander";

import { createApplyCommand } from "./cli/apply.js";
import { commanderAlreadyRendered } from "./cli/commander-utils.js";
import { CliError, toCliError } from "./cli/errors.js";
import { createInitCommand } from "./cli/init.js";
import { createListCommand } from "./cli/list.js";
import { writeCommandOutput } from "./cli/output.js";
import { createPruneCommand } from "./cli/prune.js";
import { createReviewCommand } from "./cli/review.js";
import { createRunCommand } from "./cli/run.js";
import { terminateActiveRun } from "./commands/run/lifecycle.js";
import { renderCliError } from "./render/utils/errors.js";
import { flushAllRunRecordBuffers } from "./runs/records/persistence.js";
import { toErrorMessage } from "./utils/errors.js";
import { getVoratiqVersion } from "./utils/version.js";

const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

function installProcessGuards(): void {
  process.once("SIGINT", () => {
    void handleSignal("SIGINT");
  });
  process.once("SIGTERM", () => {
    void handleSignal("SIGTERM");
  });

  process.on("uncaughtException", (error) => {
    void terminateActiveRun("failed")
      .catch((teardownError) => {
        console.error(
          `[voratiq] Failed to teardown run after uncaught exception: ${toErrorMessage(teardownError)}`,
        );
      })
      .finally(async () => {
        await flushPendingHistory();
        console.error(error);
        process.exit(1);
      });
  });

  process.on("unhandledRejection", (reason) => {
    void terminateActiveRun("failed")
      .catch((teardownError) => {
        console.error(
          `[voratiq] Failed to teardown run after unhandled rejection: ${toErrorMessage(teardownError)}`,
        );
      })
      .finally(async () => {
        await flushPendingHistory();
        console.error(reason);
        process.exit(1);
      });
  });
}

async function handleSignal(signal: NodeJS.Signals): Promise<void> {
  const exitCode = SIGNAL_EXIT_CODES[signal] ?? 1;
  try {
    await terminateActiveRun("aborted");
  } catch (error) {
    console.error(
      `[voratiq] Failed to teardown run after ${signal}: ${toErrorMessage(error)}`,
    );
    await flushPendingHistory();
    process.exit(1);
    return;
  }

  await flushPendingHistory();
  process.exit(exitCode);
}

async function flushPendingHistory(): Promise<void> {
  try {
    await flushAllRunRecordBuffers();
  } catch (error) {
    console.warn(
      `[voratiq] Failed to flush run history buffers: ${(error as Error).message}`,
    );
  }
}

installProcessGuards();

export async function runCli(
  argv: readonly string[] = process.argv,
): Promise<void> {
  const program = new Command();

  program
    .name("voratiq")
    .description("Voratiq CLI")
    .version(getVoratiqVersion(), "-v, --version", "print the Voratiq version")
    .exitOverride()
    .showHelpAfterError()
    .helpCommand(false);

  program.addCommand(createInitCommand());
  program.addCommand(createListCommand());
  program.addCommand(createRunCommand());
  program.addCommand(createReviewCommand());
  program.addCommand(createApplyCommand());
  program.addCommand(createPruneCommand());

  if (argv.length <= 2) {
    writeCommandOutput({ body: program.helpInformation() });
    return;
  }

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (commanderAlreadyRendered(error)) {
        process.exitCode = error.exitCode ?? 0;
        return;
      }

      writeCommandOutput({
        body: renderCliError(new CliError(toErrorMessage(error))),
        exitCode: error.exitCode ?? 1,
      });
      return;
    }

    const cliError = toCliError(error);
    const body = renderCliError(cliError);
    writeCommandOutput({
      body,
      exitCode: 1,
    });
  }
}

function shouldAutorun(): boolean {
  if (process.env.VORATIQ_CLI_SKIP_AUTORUN === "1") {
    return false;
  }

  const modulePath = safeRealpath(fileURLToPath(import.meta.url));
  const invokedPath =
    process.argv[1] !== undefined
      ? safeRealpath(resolve(process.argv[1]))
      : undefined;

  if (!invokedPath) {
    return true;
  }

  return modulePath === invokedPath;
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

if (shouldAutorun()) {
  void runCli();
}
