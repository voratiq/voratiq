#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

let activeJsonEnvelopeOperator:
  | import("./cli/operator-envelope.js").EnvelopeOperator
  | undefined;
let processGuardsInstalled = false;

function installProcessGuards(): void {
  if (processGuardsInstalled) {
    return;
  }
  processGuardsInstalled = true;

  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void handleSignal(signal);
    });
  }

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
  if (activeJsonEnvelopeOperator) {
    const { buildFailedOperatorEnvelope, writeOperatorResultEnvelope } =
      await import("./cli/operator-envelope.js");
    writeOperatorResultEnvelope(
      buildFailedOperatorEnvelope({
        operator: activeJsonEnvelopeOperator,
        error,
      }),
      1,
    );
    process.exit(1);
    return;
  }
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
  if (activeJsonEnvelopeOperator) {
    const { buildFailedOperatorEnvelope, writeOperatorResultEnvelope } =
      await import("./cli/operator-envelope.js");
    writeOperatorResultEnvelope(
      buildFailedOperatorEnvelope({
        operator: activeJsonEnvelopeOperator,
        error: new Error(`Signal received: ${signal}`),
      }),
      exitCode,
    );
  }
  process.exit(exitCode);
}

async function flushPendingHistory(): Promise<void> {
  try {
    const { flushAllSpecRecordBuffers } =
      await import("./domain/spec/persistence/adapter.js");
    await flushAllSpecRecordBuffers();
  } catch (error) {
    console.warn(
      `[voratiq] Failed to flush spec history buffers: ${(error as Error).message}`,
    );
  }
  try {
    const { flushAllRunRecordBuffers } =
      await import("./domain/run/persistence/adapter.js");
    await flushAllRunRecordBuffers();
  } catch (error) {
    console.warn(
      `[voratiq] Failed to flush run history buffers: ${(error as Error).message}`,
    );
  }
  try {
    const { flushAllReductionRecordBuffers } =
      await import("./domain/reduce/persistence/adapter.js");
    await flushAllReductionRecordBuffers();
  } catch (error) {
    console.warn(
      `[voratiq] Failed to flush reduction history buffers: ${(error as Error).message}`,
    );
  }
  try {
    const { flushAllVerificationRecordBuffers } =
      await import("./domain/verify/persistence/adapter.js");
    await flushAllVerificationRecordBuffers();
  } catch (error) {
    console.warn(
      `[voratiq] Failed to flush verification history buffers: ${(error as Error).message}`,
    );
  }
  try {
    const { flushAllMessageRecordBuffers } =
      await import("./domain/message/persistence/adapter.js");
    await flushAllMessageRecordBuffers();
  } catch (error) {
    console.warn(
      `[voratiq] Failed to flush message history buffers: ${(error as Error).message}`,
    );
  }
  try {
    const { flushAllInteractiveSessionBuffers } =
      await import("./domain/interactive/persistence/adapter.js");
    await flushAllInteractiveSessionBuffers();
  } catch (error) {
    console.warn(
      `[voratiq] Failed to flush interactive history buffers: ${(error as Error).message}`,
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

async function terminateActiveVerificationSafe(
  status: "failed" | "aborted",
  context: string,
): Promise<Error | null> {
  try {
    const { terminateActiveVerification } =
      await import("./commands/verify/lifecycle.js");
    await terminateActiveVerification(status);
    return null;
  } catch (error) {
    const { toErrorMessage } = await import("./utils/errors.js");
    const normalizedError =
      error instanceof Error ? error : new Error(toErrorMessage(error));
    console.error(
      `[voratiq] Failed to teardown verification after ${context}: ${toErrorMessage(error)}`,
    );
    return normalizedError;
  }
}

async function terminateActiveInteractiveSafe(
  status: "failed" | "aborted",
  context: string,
): Promise<Error | null> {
  try {
    const { terminateActiveInteractive } =
      await import("./commands/interactive/lifecycle.js");
    await terminateActiveInteractive(status, context);
    return null;
  } catch (error) {
    const { toErrorMessage } = await import("./utils/errors.js");
    const normalizedError =
      error instanceof Error ? error : new Error(toErrorMessage(error));
    console.error(
      `[voratiq] Failed to teardown interactive session after ${context}: ${toErrorMessage(error)}`,
    );
    return normalizedError;
  }
}

async function terminateActiveMessageSafe(
  status: "failed" | "aborted",
  context: string,
): Promise<Error | null> {
  try {
    const { terminateActiveMessage } =
      await import("./commands/message/lifecycle.js");
    await terminateActiveMessage(status);
    return null;
  } catch (error) {
    const { toErrorMessage } = await import("./utils/errors.js");
    const normalizedError =
      error instanceof Error ? error : new Error(toErrorMessage(error));
    console.error(
      `[voratiq] Failed to teardown message after ${context}: ${toErrorMessage(error)}`,
    );
    return normalizedError;
  }
}

async function terminateActiveSessionsSafe(
  status: "failed" | "aborted",
  context: string,
): Promise<Error | null> {
  const runError = await terminateActiveRunSafe(status, context);
  const verificationError = await terminateActiveVerificationSafe(
    status,
    context,
  );
  const interactiveError = await terminateActiveInteractiveSafe(
    status,
    context,
  );
  const messageError = await terminateActiveMessageSafe(status, context);

  const errors = [
    runError,
    verificationError,
    interactiveError,
    messageError,
  ].filter((error): error is Error => error instanceof Error);

  if (errors.length > 1) {
    return new AggregateError(
      errors,
      `Failed to teardown active sessions after ${context}`,
    );
  }

  return errors[0] ?? null;
}

function renderRootLauncherGitGuidance(options: {
  cwd: string;
  reason: "no_repository" | "not_repository_root";
  repositoryRoot?: string;
}): string {
  const lines: string[] = [];

  if (options.reason === "not_repository_root") {
    lines.push(
      "Bare `voratiq` launches an interactive session from a repository root.",
      "",
      `Current directory: ${options.cwd}`,
    );
    if (options.repositoryRoot) {
      lines.push(`Repository root: ${options.repositoryRoot}`);
    }
    lines.push(
      "",
      "Next step:",
      options.repositoryRoot
        ? `  cd ${options.repositoryRoot} && voratiq`
        : "  Switch to the repository root and rerun `voratiq`.",
    );
    return lines.join("\n");
  }

  lines.push(
    "Bare `voratiq` launches an interactive session from a git repository root.",
    "",
    `Current directory: ${options.cwd}`,
    "",
    "Next steps:",
    "  git init",
    "  voratiq",
    "",
    "Or switch to an existing repository root and rerun `voratiq`.",
  );
  return lines.join("\n");
}

export async function runCli(
  argv: readonly string[] = process.argv,
): Promise<void> {
  installProcessGuards();

  const { Command, CommanderError } = await import("commander");
  const program = new Command();
  const effectiveArgv = argv;
  const { resolveJsonEnvelopeOperator } =
    await import("./cli/operator-envelope.js");
  const jsonEnvelopeOperator = resolveJsonEnvelopeOperator(effectiveArgv);
  activeJsonEnvelopeOperator = jsonEnvelopeOperator;
  const commandName = findCommandName(effectiveArgv);

  const localVersion = (await import("./utils/version.js")).getVoratiqVersion();

  program
    .name("voratiq")
    .description(
      "Agent ensembles to design, generate, and select the best code for every task.",
    )
    .enablePositionalOptions()
    .version(localVersion, "-v, --version", "print the Voratiq version")
    .exitOverride()
    .showHelpAfterError()
    .helpCommand(false);

  if (jsonEnvelopeOperator) {
    program.configureOutput({
      writeOut: () => {},
      writeErr: () => {},
      outputError: () => {},
    });
  }

  const isMcpCommand = commandName === "mcp";
  const updateHandle = isMcpCommand
    ? undefined
    : (await import("./update-check/checker.js")).startUpdateCheck(
        localVersion,
        {
          isTty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
          env: process.env,
          cachePath: (
            await import("./update-check/state-path.js")
          ).resolveUpdateStatePath(process.env),
        },
      );

  try {
    if (!isMcpCommand) {
      // Show update prompt if a cached notice is available
      const updateNotice = updateHandle?.peekNotice();
      if (updateNotice) {
        const { showUpdatePrompt } = await import("./update-check/prompt.js");
        const { createConfirmationInteractor } =
          await import("./render/interactions/confirmation.js");
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
    }

    await registerCommands(program, effectiveArgv);

    const { shouldStartRootLauncher } = await import("./cli/root-launcher.js");
    if (shouldStartRootLauncher(effectiveArgv)) {
      try {
        const { runInteractiveRootLauncher } =
          await import("./cli/root-launcher.js");
        const { createEntrypointVoratiqCliTarget } =
          await import("./utils/voratiq-cli-target.js");
        await runInteractiveRootLauncher({
          selfCliTarget: createEntrypointVoratiqCliTarget({
            cliEntrypoint: effectiveArgv[1],
          }),
        });
      } catch (error) {
        const { GitRepositoryError } = await import("./utils/errors.js");
        if (
          error instanceof GitRepositoryError &&
          (error.reason === "no_repository" ||
            error.reason === "not_repository_root")
        ) {
          const { writeCommandOutput } = await import("./cli/output.js");
          writeCommandOutput({
            body: renderRootLauncherGitGuidance({
              cwd: process.cwd(),
              reason: error.reason,
              repositoryRoot: error.repositoryRoot,
            }),
          });
          return;
        }
        const { toCliError } = await import("./cli/errors.js");
        const { renderCliError } = await import("./render/utils/errors.js");
        const { writeCommandOutput } = await import("./cli/output.js");
        const cliError = toCliError(error);
        writeCommandOutput({
          body: renderCliError(cliError),
          exitCode: 1,
        });
      }
      return;
    }

    if (effectiveArgv.length <= 2) {
      const { writeCommandOutput } = await import("./cli/output.js");
      writeCommandOutput({ body: program.helpInformation() });
      return;
    }

    try {
      await program.parseAsync(effectiveArgv);
    } catch (error) {
      if (error instanceof CommanderError) {
        if (jsonEnvelopeOperator) {
          const { buildFailedOperatorEnvelope, writeOperatorResultEnvelope } =
            await import("./cli/operator-envelope.js");
          writeOperatorResultEnvelope(
            buildFailedOperatorEnvelope({
              operator: jsonEnvelopeOperator,
              error,
            }),
            error.exitCode ?? 1,
          );
          return;
        }
        const { commanderAlreadyRendered } =
          await import("./cli/commander-utils.js");
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

      if (jsonEnvelopeOperator) {
        const { buildFailedOperatorEnvelope, writeOperatorResultEnvelope } =
          await import("./cli/operator-envelope.js");
        writeOperatorResultEnvelope(
          buildFailedOperatorEnvelope({
            operator: jsonEnvelopeOperator,
            error,
          }),
          1,
        );
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
    activeJsonEnvelopeOperator = undefined;
    updateHandle?.finish();
  }
}

async function registerCommands(
  program: InstanceType<(typeof import("commander"))["Command"]>,
  argv: readonly string[],
): Promise<void> {
  const commandName = findCommandName(argv);
  const wantsHelp = argv.includes("--help") || argv.includes("-h");
  const wantsVersion = argv.includes("--version") || argv.includes("-v");
  const knownCommandNames = new Set([
    "init",
    "sync",
    "spec",
    "run",
    "reduce",
    "verify",
    "message",
    "auto",
    "apply",
    "list",
    "prune",
    "mcp",
  ]);

  const loadAll =
    commandName === undefined ||
    (wantsHelp && commandName === undefined) ||
    (commandName !== undefined && !knownCommandNames.has(commandName));

  if (commandName === undefined && wantsVersion && !wantsHelp) {
    return;
  }

  if (loadAll) {
    program.addCommand((await import("./cli/init.js")).createInitCommand());
    program.addCommand((await import("./cli/sync.js")).createSyncCommand());
    program.addCommand((await import("./cli/spec.js")).createSpecCommand());
    program.addCommand((await import("./cli/run.js")).createRunCommand());
    program.addCommand((await import("./cli/reduce.js")).createReduceCommand());
    program.addCommand((await import("./cli/verify.js")).createVerifyCommand());
    program.addCommand(
      (await import("./cli/message.js")).createMessageCommand(),
    );
    program.addCommand((await import("./cli/auto.js")).createAutoCommand());
    program.addCommand((await import("./cli/apply.js")).createApplyCommand());
    program.addCommand((await import("./cli/list.js")).createListCommand());
    program.addCommand((await import("./cli/prune.js")).createPruneCommand());
    program.addCommand((await import("./cli/mcp.js")).createMcpCommand());
    return;
  }

  switch (commandName) {
    case "init":
      program.addCommand((await import("./cli/init.js")).createInitCommand());
      break;
    case "sync":
      program.addCommand((await import("./cli/sync.js")).createSyncCommand());
      break;
    case "spec":
      program.addCommand((await import("./cli/spec.js")).createSpecCommand());
      break;
    case "run":
      program.addCommand((await import("./cli/run.js")).createRunCommand());
      break;
    case "reduce":
      program.addCommand(
        (await import("./cli/reduce.js")).createReduceCommand(),
      );
      break;
    case "verify":
      program.addCommand(
        (await import("./cli/verify.js")).createVerifyCommand(),
      );
      break;
    case "message":
      program.addCommand(
        (await import("./cli/message.js")).createMessageCommand(),
      );
      break;
    case "auto":
      program.addCommand((await import("./cli/auto.js")).createAutoCommand());
      break;
    case "apply":
      program.addCommand((await import("./cli/apply.js")).createApplyCommand());
      break;
    case "list":
      program.addCommand((await import("./cli/list.js")).createListCommand());
      break;
    case "prune":
      program.addCommand((await import("./cli/prune.js")).createPruneCommand());
      break;
    case "mcp":
      program.addCommand((await import("./cli/mcp.js")).createMcpCommand());
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

if (shouldAutorun()) {
  installProcessGuards();
  void runCli();
}
