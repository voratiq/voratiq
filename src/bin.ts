#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

const ROOT_AUTO_DESCRIPTION_HELP_TEXT = [
  "",
  "Flat intent entrypoint (equivalent to `voratiq auto --description <text>`):",
  "  voratiq --description <text> [--run-agent <agent-id>] [--review-agent <agent-id>] [--profile <name>] [--max-parallel <count>] [--branch] [--apply] [--commit]",
  "",
  "For an existing spec path, use:",
  "  voratiq auto --spec <path> [options]",
].join("\n");

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
  await terminateActiveSessionsSafe("failed", context);
  await flushPendingHistory();
  const { CliError, toCliError } = await import("./cli/errors.js");
  const { renderCliError } = await import("./render/utils/errors.js");
  const normalized = toCliError(error);
  const rendered = renderCliError(
    new CliError(
      normalized.headline,
      [`Context: ${context}.`, ...normalized.detailLines],
      normalized.hintLines,
    ),
  );
  console.error(rendered);
  process.exit(1);
}

async function handleSignal(signal: NodeJS.Signals): Promise<void> {
  const exitCode = SIGNAL_EXIT_CODES[signal] ?? 1;
  const teardownError = await terminateActiveSessionsSafe("aborted", signal);
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

async function terminateActiveReviewSafe(
  status: "failed" | "aborted",
  context: string,
): Promise<Error | null> {
  try {
    const { terminateActiveReview } = await import(
      "./commands/review/lifecycle.js"
    );
    await terminateActiveReview(status);
    return null;
  } catch (error) {
    const { toErrorMessage } = await import("./utils/errors.js");
    const normalizedError =
      error instanceof Error ? error : new Error(toErrorMessage(error));
    console.error(
      `[voratiq] Failed to teardown review after ${context}: ${toErrorMessage(error)}`,
    );
    return normalizedError;
  }
}

async function terminateActiveSessionsSafe(
  status: "failed" | "aborted",
  context: string,
): Promise<Error | null> {
  const runError = await terminateActiveRunSafe(status, context);
  const reviewError = await terminateActiveReviewSafe(status, context);
  if (runError && reviewError) {
    return new AggregateError(
      [runError, reviewError],
      `Failed to teardown run and review after ${context}`,
    );
  }
  return runError ?? reviewError ?? null;
}

export async function runCli(
  argv: readonly string[] = process.argv,
): Promise<void> {
  const { Command, CommanderError } = await import("commander");
  const program = new Command();
  const effectiveArgv = normalizeRootIntentArgv(argv);

  const localVersion = (await import("./utils/version.js")).getVoratiqVersion();

  program
    .name("voratiq")
    .description("Voratiq CLI")
    .addHelpText("after", ROOT_AUTO_DESCRIPTION_HELP_TEXT)
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

  try {
    // Show update prompt if a cached notice is available
    const updateNotice = updateHandle?.peekNotice();
    if (updateNotice) {
      const { showUpdatePrompt } = await import("./update-check/prompt.js");
      const { createConfirmationInteractor } = await import(
        "./render/interactions/confirmation.js"
      );
      const { writeCommandOutput } = await import("./cli/output.js");

      const interactor = createConfirmationInteractor();
      try {
        const result = await showUpdatePrompt(updateNotice, {
          prompt: (opts) => interactor.prompt(opts),
          write: (text) => process.stdout.write(text),
          writeCommandOutput,
        });
        if (result.shouldExit) {
          if (result.exitCode !== undefined && result.exitCode !== 0) {
            process.exitCode = result.exitCode;
          }
          return;
        }
      } finally {
        interactor.close();
      }
    }

    await registerCommands(program, effectiveArgv);

    if (effectiveArgv.length <= 2) {
      const { writeCommandOutput } = await import("./cli/output.js");
      writeCommandOutput({ body: program.helpInformation() });
      return;
    }

    try {
      await program.parseAsync(effectiveArgv);
    } catch (error) {
      if (error instanceof CommanderError) {
        const { commanderAlreadyRendered } = await import(
          "./cli/commander-utils.js"
        );
        if (commanderAlreadyRendered(error)) {
          process.exitCode = error.exitCode ?? 0;
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
  } finally {
    updateHandle?.finish();
  }
}

function normalizeRootIntentArgv(argv: readonly string[]): readonly string[] {
  if (!shouldRouteRootDescriptionToAuto(argv)) {
    return argv;
  }

  const [nodePath = "node", cliPath = "voratiq"] = argv;
  return [nodePath, cliPath, "auto", ...argv.slice(2)];
}

function shouldRouteRootDescriptionToAuto(argv: readonly string[]): boolean {
  const firstUserArgument = argv[2];
  if (!firstUserArgument || firstUserArgument === "--") {
    return false;
  }

  if (!firstUserArgument.startsWith("-")) {
    return false;
  }

  return hasRootDescriptionFlag(argv);
}

function hasRootDescriptionFlag(argv: readonly string[]): boolean {
  for (let index = 2; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry || entry === "--") {
      return false;
    }

    if (entry === "--description" || entry.startsWith("--description=")) {
      return true;
    }
  }

  return false;
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
