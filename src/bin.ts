#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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
    void handleFatalError("uncaught exception", error);
  });

  process.on("unhandledRejection", (reason) => {
    void handleFatalError("unhandled rejection", reason);
  });
}

async function handleFatalError(
  context: string,
  error: unknown,
): Promise<void> {
  await terminateActiveRunSafe("failed", context);
  await flushPendingHistory();
  console.error(error);
  process.exit(1);
}

async function handleSignal(signal: NodeJS.Signals): Promise<void> {
  const exitCode = SIGNAL_EXIT_CODES[signal] ?? 1;
  const teardownError = await terminateActiveRunSafe("aborted", signal);
  if (teardownError) {
    await flushPendingHistory();
    process.exit(1);
    return;
  }

  await flushPendingHistory();
  process.exit(exitCode);
}

async function flushPendingHistory(): Promise<void> {
  try {
    const { flushAllRunRecordBuffers } = await import(
      "./runs/records/persistence.js"
    );
    await flushAllRunRecordBuffers();
  } catch (error) {
    console.warn(
      `[voratiq] Failed to flush run history buffers: ${(error as Error).message}`,
    );
  }
  try {
    const { flushAllReviewRecordBuffers } = await import(
      "./reviews/records/persistence.js"
    );
    await flushAllReviewRecordBuffers();
  } catch (error) {
    console.warn(
      `[voratiq] Failed to flush review history buffers: ${(error as Error).message}`,
    );
  }
  try {
    const { flushAllSpecRecordBuffers } = await import(
      "./specs/records/persistence.js"
    );
    await flushAllSpecRecordBuffers();
  } catch (error) {
    console.warn(
      `[voratiq] Failed to flush spec history buffers: ${(error as Error).message}`,
    );
  }
}

async function terminateActiveRunSafe(
  status: "failed" | "aborted",
  context: string,
): Promise<Error | null> {
  try {
    const { terminateActiveRun } = await import("./commands/run/lifecycle.js");
    await terminateActiveRun(status);
    return null;
  } catch (error) {
    const { toErrorMessage } = await import("./utils/errors.js");
    const normalizedError =
      error instanceof Error ? error : new Error(toErrorMessage(error));
    console.error(
      `[voratiq] Failed to teardown run after ${context}: ${toErrorMessage(error)}`,
    );
    return normalizedError;
  }
}

export async function runCli(
  argv: readonly string[] = process.argv,
): Promise<void> {
  const { Command, CommanderError } = await import("commander");
  const program = new Command();

  const localVersion = (await import("./utils/version.js")).getVoratiqVersion();

  program
    .name("voratiq")
    .description("Voratiq CLI")
    .version(localVersion, "-v, --version", "print the Voratiq version")
    .exitOverride()
    .showHelpAfterError()
    .helpCommand(false);

  // Start update check (non-blocking)
  const { startUpdateCheck } = await import("./update-check/mvp.js");
  const { resolveUpdateStatePath } = await import(
    "./update-check/state-path.js"
  );
  const updateHandle = startUpdateCheck(localVersion, {
    isTty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    env: process.env,
    cachePath: resolveUpdateStatePath(process.env),
  });

  // Show update prompt if a cached notice is available
  const updateNotice = updateHandle?.peekNotice();
  if (updateNotice) {
    const { showUpdatePrompt } = await import("./update-check/prompt.js");
    const shouldExit = await showUpdatePrompt(updateNotice, {
      stdin: process.stdin,
      stdout: process.stdout,
    });
    if (shouldExit) {
      updateHandle?.finish();
      return;
    }
  }

  await registerCommands(program, argv);

  if (argv.length <= 2) {
    const { writeCommandOutput } = await import("./cli/output.js");
    writeCommandOutput({ body: program.helpInformation() });
    updateHandle?.finish();
    return;
  }

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      const { commanderAlreadyRendered } = await import(
        "./cli/commander-utils.js"
      );
      if (commanderAlreadyRendered(error)) {
        process.exitCode = error.exitCode ?? 0;
        updateHandle?.finish();
        return;
      }

      const { CliError } = await import("./cli/errors.js");
      const { renderCliError } = await import("./render/utils/errors.js");
      const { toErrorMessage } = await import("./utils/errors.js");
      const { writeCommandOutput } = await import("./cli/output.js");
      writeCommandOutput({
        body: renderCliError(new CliError(toErrorMessage(error))),
        exitCode: error.exitCode ?? 1,
      });
      updateHandle?.finish();
      return;
    }

    const { toCliError } = await import("./cli/errors.js");
    const { renderCliError } = await import("./render/utils/errors.js");
    const { writeCommandOutput } = await import("./cli/output.js");
    const cliError = toCliError(error);
    const body = renderCliError(cliError);
    writeCommandOutput({
      body,
      exitCode: 1,
    });
  }

  updateHandle?.finish();
}

async function registerCommands(
  program: InstanceType<(typeof import("commander"))["Command"]>,
  argv: readonly string[],
): Promise<void> {
  const commandName = findCommandName(argv);
  const wantsHelp = argv.includes("--help") || argv.includes("-h");
  const wantsVersion = argv.includes("--version") || argv.includes("-v");

  const loadAll =
    commandName === undefined ||
    wantsHelp ||
    (commandName !== undefined &&
      ![
        "init",
        "list",
        "spec",
        "run",
        "review",
        "auto",
        "apply",
        "prune",
      ].includes(commandName));

  if (commandName === undefined && wantsVersion && !wantsHelp) {
    return;
  }

  if (loadAll) {
    program.addCommand((await import("./cli/init.js")).createInitCommand());
    program.addCommand((await import("./cli/list.js")).createListCommand());
    program.addCommand((await import("./cli/spec.js")).createSpecCommand());
    program.addCommand((await import("./cli/run.js")).createRunCommand());
    program.addCommand((await import("./cli/review.js")).createReviewCommand());
    program.addCommand((await import("./cli/auto.js")).createAutoCommand());
    program.addCommand((await import("./cli/apply.js")).createApplyCommand());
    program.addCommand((await import("./cli/prune.js")).createPruneCommand());
    return;
  }

  switch (commandName) {
    case "init":
      program.addCommand((await import("./cli/init.js")).createInitCommand());
      break;
    case "list":
      program.addCommand((await import("./cli/list.js")).createListCommand());
      break;
    case "spec":
      program.addCommand((await import("./cli/spec.js")).createSpecCommand());
      break;
    case "run":
      program.addCommand((await import("./cli/run.js")).createRunCommand());
      break;
    case "review":
      program.addCommand(
        (await import("./cli/review.js")).createReviewCommand(),
      );
      break;
    case "auto":
      program.addCommand((await import("./cli/auto.js")).createAutoCommand());
      break;
    case "apply":
      program.addCommand((await import("./cli/apply.js")).createApplyCommand());
      break;
    case "prune":
      program.addCommand((await import("./cli/prune.js")).createPruneCommand());
      break;
  }
}

function findCommandName(argv: readonly string[]): string | undefined {
  for (let index = 2; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry) {
      continue;
    }

    if (entry === "--") {
      return argv[index + 1];
    }

    if (entry.startsWith("-")) {
      continue;
    }

    return entry;
  }

  return undefined;
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

function shouldWriteInitPreface(argv: readonly string[]): boolean {
  const commandName = findCommandName(argv);
  if (commandName !== "init") {
    return false;
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    return false;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    return false;
  }

  return true;
}

function writeInitPreface(): void {
  process.stdout.write("\nInitializing Voratiq…\n");
}

if (shouldAutorun()) {
  if (shouldWriteInitPreface(process.argv)) {
    writeInitPreface();
  }
  installProcessGuards();
  void runCli();
}
