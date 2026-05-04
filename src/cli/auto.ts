import { Command, Option } from "commander";

import {
  type AutoCommandDependencies,
  type AutoCommandEvent,
  executeAutoCommand,
} from "../commands/auto/command.js";
import {
  validateAutoCommandOptions,
  validateAutoVerificationConfig,
} from "../commands/auto/validation.js";
import { loadVerificationConfig } from "../configs/verification/loader.js";
import type {
  AutoApplyStatus,
  AutoTerminalStatus,
  RunAutoOutcome,
} from "../domain/run/model/types.js";
import { rewriteRunRecord } from "../domain/run/persistence/adapter.js";
import { resolveCliContext } from "../preflight/index.js";
import { renderAutoSummaryTranscript } from "../render/transcripts/auto.js";
import { renderWorkspaceAutoInitializedNotice } from "../render/transcripts/shared.js";
import { renderCliError } from "../render/utils/errors.js";
import { HintedError } from "../utils/errors.js";
import { formatAlertMessage } from "../utils/output.js";
import { runApplyCommand } from "./apply.js";
import { toCliError } from "./errors.js";
import {
  collectRepeatedStringOption,
  parseMaxParallelOption,
} from "./option-parsers.js";
import { beginChainedCommandOutput, writeCommandOutput } from "./output.js";
import { promptForRepositoryLinkIfNeeded } from "./repository-link.js";
import { runRunCommand } from "./run.js";
import { runSpecCommand } from "./spec.js";
import { runVerifyCommand } from "./verify.js";

export interface AutoCommandOptions {
  specPath?: string;
  description?: string;
  runAgentIds?: readonly string[];
  verifyAgentIds?: readonly string[];
  profile?: string;
  maxParallel?: number;
  branch?: boolean;
  apply?: boolean;
  commit?: boolean;
}

export interface AutoCommandResult {
  exitCode: number;
  runId?: string;
  appliedAgentId?: string;
  auto: {
    status: AutoTerminalStatus;
    detail?: string;
  };
  apply: {
    status: AutoApplyStatus;
    detail?: string;
  };
}

interface AutoRuntimeOptions {
  now?: () => number;
}

function replayAutoCommandEvent(event: AutoCommandEvent): void {
  if (event.kind === "body") {
    writeCommandOutput({
      body: event.body,
      stderr: event.stderr,
      exitCode: event.exitCode,
    });
    return;
  }

  if (event.kind === "warning") {
    const warningBody = formatAlertMessage("Warning", "yellow", event.detail);
    writeCommandOutput({
      body: event.separateWithDivider ? `---\n\n${warningBody}` : warningBody,
    });
    return;
  }

  if (event.kind === "error") {
    writeCommandOutput({ body: renderCliError(toCliError(event.error)) });
    return;
  }
}

async function persistAutoOutcome(options: {
  runId?: string;
  outcome: RunAutoOutcome;
}): Promise<void> {
  const { runId, outcome } = options;
  if (!runId) {
    return;
  }

  try {
    const { root, workspacePaths } = await resolveCliContext();
    await rewriteRunRecord({
      root,
      runsFilePath: workspacePaths.runsFile,
      runId,
      mutate: (record) => ({
        ...record,
        auto: outcome,
      }),
      forceFlush: true,
      suppressAppUpload: true,
    });
  } catch {
    // Keep auto command behavior resilient in unit tests and non-standard
    // harnesses where run records may be mocked or unavailable.
  }
}

export async function runAutoCommand(
  options: AutoCommandOptions,
  runtime: AutoRuntimeOptions = {},
): Promise<AutoCommandResult> {
  validateAutoCommandOptions(options);
  const now = runtime.now ?? Date.now.bind(Date);
  const { root, workspaceAutoInitialized } = await resolveCliContext({
    workspaceAutoInitMode: "when-missing",
    restoreShippedVerificationTemplates: false,
  });
  await promptForRepositoryLinkIfNeeded({ root });
  const workspaceNotice = workspaceAutoInitialized
    ? renderWorkspaceAutoInitializedNotice()
    : undefined;
  if (workspaceNotice) {
    writeCommandOutput({
      alerts: [{ severity: "info", message: workspaceNotice }],
      leadingNewline: false,
    });
  }
  const verificationConfig = loadVerificationConfig({ root });
  await validateAutoVerificationConfig({
    root,
    command: {
      description: options.description,
      specPath: options.specPath,
    },
    verificationConfig,
  });

  const chainedOutput = beginChainedCommandOutput();

  try {
    const dependencies: AutoCommandDependencies = {
      now,
      onEvent: replayAutoCommandEvent,
      runSpecStage: async (input) => {
        const result = await runSpecCommand({
          description: input.description,
          profile: input.profile,
          maxParallel: input.maxParallel,
          suppressHint: input.suppressHint,
          writeOutput: writeCommandOutput,
        });

        if (!result.sessionId) {
          throw new HintedError("Spec stage did not return a session id.", {
            hintLines: [
              "Re-run the spec stage and confirm the spec session persisted correctly.",
            ],
          });
        }

        return {
          ...result,
          sessionId: result.sessionId,
        };
      },
      runRunStage: async (input) => {
        const suppressBlankLines = !process.stdout.isTTY;
        return runRunCommand({
          specPath: input.specPath,
          agentIds: input.agentIds ? [...input.agentIds] : undefined,
          agentOverrideFlag: input.agentOverrideFlag,
          profile: input.profile,
          maxParallel: input.maxParallel,
          branch: input.branch,
          writeOutput: writeCommandOutput,
          suppressHint: true,
          suppressLeadingBlankLine: suppressBlankLines,
          suppressTrailingBlankLine: suppressBlankLines,
          stdout: chainedOutput.stdout,
          stderr: chainedOutput.stderr,
        });
      },
      runVerifyStage: async (input) =>
        runVerifyCommand({
          target: input.target,
          agentIds: input.agentIds ? [...input.agentIds] : undefined,
          agentOverrideFlag: input.agentOverrideFlag,
          profile: input.profile,
          maxParallel: input.maxParallel,
          suppressHint: input.suppressHint,
          stdout: chainedOutput.stdout,
          stderr: chainedOutput.stderr,
        }).then((result) => ({
          verificationId: result.verificationId,
          body: result.body,
          stderr: undefined,
          exitCode: result.exitCode,
          selectedSpecPath: result.selectedSpecPath,
          selection: result.selection?.decision,
          selectionWarnings: result.selection?.warnings,
          warningMessage: result.warningMessage,
        })),
      runApplyStage: async (input) =>
        runApplyCommand({
          runId: input.runId,
          agentId: input.agentId,
          commit: input.commit,
        }),
    };

    const execution = await executeAutoCommand(options, dependencies);

    const autoOutcome: RunAutoOutcome = {
      status: execution.auto.status,
      completedAt: new Date(now()).toISOString(),
      ...(execution.auto.detail ? { detail: execution.auto.detail } : {}),
      apply: {
        status: execution.apply.status,
        ...(execution.appliedAgentId
          ? { agentId: execution.appliedAgentId }
          : {}),
        ...(execution.apply.detail ? { detail: execution.apply.detail } : {}),
      },
    };

    await persistAutoOutcome({
      runId: execution.runId,
      outcome: autoOutcome,
    });

    writeCommandOutput({
      body: renderAutoSummaryTranscript(execution.summary),
      exitCode: execution.exitCode,
    });

    return {
      exitCode: execution.exitCode,
      runId: execution.runId,
      ...(execution.appliedAgentId
        ? { appliedAgentId: execution.appliedAgentId }
        : {}),
      auto: execution.auto,
      apply: execution.apply,
    };
  } finally {
    chainedOutput.end();
  }
}

interface AutoCommandActionOptions {
  spec?: string;
  description?: string;
  runAgent?: string[];
  verifyAgent?: string[];
  profile?: string;
  maxParallel?: number;
  branch?: boolean;
  apply?: boolean;
  commit?: boolean;
}

export function createAutoCommand(): Command {
  return new Command("auto")
    .description("Run spec, run, verify, and apply as one command")
    .option("--spec <path>", "Existing spec to run")
    .option("--description <text>", "Generate a spec, then run and verify it")
    .addOption(
      new Option(
        "--run-agent <agent-id>",
        "Set run-stage agents directly (repeatable; order preserved)",
      )
        .default([], "")
        .argParser(collectRepeatedStringOption),
    )
    .addOption(
      new Option(
        "--verify-agent <agent-id>",
        "Set verify-stage agents directly (repeatable)",
      )
        .default([], "")
        .argParser(collectRepeatedStringOption),
    )
    .option("--profile <name>", 'Orchestration profile (default: "default")')
    .option(
      "--max-parallel <count>",
      "Max concurrent agents/verifiers",
      parseMaxParallelOption,
    )
    .option("--branch", "Create or checkout a branch named after the spec")
    .option(
      "--apply",
      "Apply the selected candidate after verification",
      () => true,
    )
    .option("--commit", "Commit after apply (requires --apply)", () => true)
    .allowExcessArguments(false)
    .action(async (options: AutoCommandActionOptions) => {
      await runAutoCommand({
        specPath: options.spec,
        description: options.description,
        runAgentIds: options.runAgent,
        verifyAgentIds: options.verifyAgent,
        profile: options.profile,
        maxParallel: options.maxParallel,
        branch: options.branch,
        apply: options.apply ?? false,
        commit: options.commit ?? false,
      });
    });
}
