import { basename } from "node:path";

import { Command, Option } from "commander";

import { checkPlatformSupport } from "../agents/runtime/sandbox.js";
import { executeRunCommand } from "../commands/run/command.js";
import { resolveExtraContextFiles } from "../competition/shared/extra-context.js";
import type { RunReport } from "../domain/run/model/types.js";
import { checkoutOrCreateBranch } from "../preflight/branch.js";
import {
  ensureCleanWorkingTree,
  ensureSandboxDependencies,
  ensureSpecPath,
  resolveCliContext,
} from "../preflight/index.js";
import { createRunRenderer } from "../render/transcripts/run.js";
import { renderWorkspaceAutoInitializedNotice } from "../render/transcripts/shared.js";
import { createStageStartLineEmitter } from "../render/utils/stage-output.js";
import { mapRunStatusToExitCode } from "../status/index.js";
import { parsePositiveInteger } from "../utils/validators.js";
import {
  buildRunOperatorEnvelope,
  createSilentCliWriter,
  writeOperatorResultEnvelope,
} from "./operator-envelope.js";
import type { CommandOutputWriter } from "./output.js";
import { writeCommandOutput } from "./output.js";

export interface RunCommandOptions {
  specPath: string;
  agentIds?: string[];
  agentOverrideFlag?: string;
  profile?: string;
  maxParallel?: number;
  branch?: boolean;
  extraContext?: string[];
  json?: boolean;
  suppressHint?: boolean;
  suppressLeadingBlankLine?: boolean;
  suppressTrailingBlankLine?: boolean;
  stdout?: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };
  stderr?: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };
  writeOutput?: CommandOutputWriter;
}

export interface RunCommandResult {
  report: RunReport;
  body: string;
  exitCode?: number;
}

export async function runRunCommand(
  options: RunCommandOptions,
): Promise<RunCommandResult> {
  const {
    specPath,
    agentIds,
    agentOverrideFlag,
    profile,
    maxParallel,
    branch,
    extraContext,
    json = false,
    suppressHint,
    suppressLeadingBlankLine,
    suppressTrailingBlankLine,
    stdout,
    stderr,
    writeOutput,
  } = options;
  const effectiveWriteOutput = json
    ? undefined
    : (writeOutput ?? writeCommandOutput);
  const rendererStdout = json ? createSilentCliWriter() : stdout;
  const rendererStderr = json ? createSilentCliWriter() : stderr;

  const { root, workspacePaths, workspaceAutoInitialized } =
    await resolveCliContext({
      workspaceAutoInitMode: "when-missing",
    });

  const workspaceNotice = workspaceAutoInitialized
    ? renderWorkspaceAutoInitializedNotice()
    : undefined;

  if (workspaceNotice && effectiveWriteOutput) {
    effectiveWriteOutput({
      alerts: [{ severity: "info", message: workspaceNotice }],
      leadingNewline: false,
    });
  }

  checkPlatformSupport();
  ensureSandboxDependencies();
  await ensureCleanWorkingTree(root);
  const { absolutePath, displayPath } = await ensureSpecPath(specPath, root);
  const extraContextFiles = await resolveExtraContextFiles({
    root,
    paths: extraContext,
  });

  if (branch) {
    const branchName = deriveBranchNameFromSpecPath(displayPath);
    await checkoutOrCreateBranch(root, branchName);
  }

  if (effectiveWriteOutput) {
    const startLine = createStageStartLineEmitter((message) => {
      effectiveWriteOutput({
        alerts: [{ severity: "info", message }],
      });
    });
    startLine.emit("Executing run…");
  }

  const renderer = createRunRenderer({
    stdout: rendererStdout,
    stderr: rendererStderr,
    suppressLeadingBlankLine,
    suppressTrailingBlankLine,
  });

  const report = await executeRunCommand({
    root,
    runsFilePath: workspacePaths.runsFile,
    specAbsolutePath: absolutePath,
    specDisplayPath: displayPath,
    agentIds,
    agentOverrideFlag,
    profileName: profile,
    maxParallel,
    extraContextFiles,
    renderer,
  });

  const body = renderer.complete(report, { suppressHint });

  const exitCode = mapRunStatusToExitCode(report.status);

  return { report, body, exitCode };
}

/**
 * Derives a branch name from a spec file path by extracting the basename without extension.
 *
 * Examples:
 * - `specs/separate-verification-outcomes.md` → `separate-verification-outcomes`
 * - `specs/foo/bar.md` → `bar`
 * - `my-feature.md` → `my-feature`
 */
export function deriveBranchNameFromSpecPath(specPath: string): string {
  const base = basename(specPath);
  const lastDotIndex = base.lastIndexOf(".");
  if (lastDotIndex <= 0) {
    return base;
  }
  return base.slice(0, lastDotIndex);
}

interface RunCommandActionOptions {
  spec: string;
  agent?: string[];
  profile?: string;
  maxParallel?: number;
  branch?: boolean;
  extraContext?: string[];
  json?: boolean;
}

function collectAgentOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function collectExtraContextOption(
  value: string,
  previous: string[],
): string[] {
  return [...previous, value];
}

function parseMaxParallelOption(value: string): number {
  return parsePositiveInteger(
    value,
    "Expected positive integer after --max-parallel",
    "--max-parallel must be greater than 0",
  );
}

export function createRunCommand(): Command {
  return new Command("run")
    .description("Execute agents against a spec")
    .requiredOption("--spec <path>", "Path to the spec file")
    .addOption(
      new Option(
        "--agent <agent-id>",
        "Set agents directly (repeatable; order preserved)",
      )
        .default([], "")
        .argParser(collectAgentOption),
    )
    .option("--profile <name>", 'Orchestration profile (default: "default")')
    .option(
      "--max-parallel <count>",
      "Max concurrent agents (default: all)",
      parseMaxParallelOption,
    )
    .option("--branch", "Create or checkout a branch named after the spec")
    .addOption(
      new Option(
        "--extra-context <path>",
        "Stage an extra context file into each agent workspace (repeatable)",
      )
        .default([], "")
        .argParser(collectExtraContextOption),
    )
    .option("--json", "Emit a machine-readable result envelope")
    .allowExcessArguments(false)
    .action(async (options: RunCommandActionOptions) => {
      const runOptions: RunCommandOptions = {
        specPath: options.spec,
        agentIds: options.agent,
        profile: options.profile,
        maxParallel: options.maxParallel,
        branch: options.branch,
        extraContext: options.extraContext,
        json: Boolean(options.json),
        writeOutput: options.json ? undefined : writeCommandOutput,
      };

      const result = await runRunCommand(runOptions);
      if (options.json) {
        writeOperatorResultEnvelope(
          buildRunOperatorEnvelope({
            runId: result.report.runId,
            specPath: result.report.spec.path,
            status: result.report.status,
          }),
          result.exitCode,
        );
        return;
      }
      writeCommandOutput({
        body: result.body,
        exitCode: result.exitCode,
      });
    });
}
