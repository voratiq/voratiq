import { basename } from "node:path";

import { Command } from "commander";

import { checkPlatformSupport } from "../agents/runtime/sandbox.js";
import { executeRunCommand } from "../commands/run/command.js";
import { checkoutOrCreateBranch } from "../preflight/branch.js";
import {
  ensureCleanWorkingTree,
  ensureSandboxDependencies,
  ensureSpecPath,
  resolveCliContext,
} from "../preflight/index.js";
import { createRunRenderer } from "../render/transcripts/run.js";
import type { RunReport } from "../runs/records/types.js";
import { parsePositiveInteger } from "../utils/validators.js";
import { writeCommandOutput } from "./output.js";

export interface RunCommandOptions {
  specPath: string;
  agentIds?: string[];
  maxParallel?: number;
  branch?: boolean;
  suppressHint?: boolean;
  suppressLeadingBlankLine?: boolean;
  suppressTrailingBlankLine?: boolean;
  stdout?: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };
  stderr?: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };
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
    maxParallel,
    branch,
    suppressHint,
    suppressLeadingBlankLine,
    suppressTrailingBlankLine,
    stdout,
    stderr,
  } = options;

  const { root, workspacePaths } = await resolveCliContext();
  checkPlatformSupport();
  ensureSandboxDependencies();
  await ensureCleanWorkingTree(root);
  const { absolutePath, displayPath } = await ensureSpecPath(specPath, root);

  if (branch) {
    const branchName = deriveBranchNameFromSpecPath(displayPath);
    await checkoutOrCreateBranch(root, branchName);
  }

  const renderer = createRunRenderer({
    stdout,
    stderr,
    suppressLeadingBlankLine,
    suppressTrailingBlankLine,
  });

  const report = await executeRunCommand({
    root,
    runsFilePath: workspacePaths.runsFile,
    specAbsolutePath: absolutePath,
    specDisplayPath: displayPath,
    agentIds,
    maxParallel,
    renderer,
  });

  const body = renderer.complete(report, { suppressHint });

  // Unlike other commands, `run` signals a degraded outcome via exit code 1
  // when any agent fails. Eval failures are quality signals displayed in the output
  // but do not affect exit code. All other CLI commands either throw on error
  // or return a clean success with exit code 0, so keep this deviation explicit.
  const exitCode = report.hadAgentFailure ? 1 : undefined;

  return { report, body, exitCode };
}

/**
 * Derives a branch name from a spec file path by extracting the basename without extension.
 *
 * Examples:
 * - `specs/separate-eval-outcomes.md` → `separate-eval-outcomes`
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
  maxParallel?: number;
  branch?: boolean;
}

function collectAgentOption(value: string, previous: string[]): string[] {
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
    .description("Execute configured agents against a spec")
    .requiredOption("--spec <path>", "Path to the specification to execute")
    .option(
      "--agent <agent-id>",
      "Agent identifier override (repeatable; preserves CLI order)",
      collectAgentOption,
      [],
    )
    .option(
      "--max-parallel <count>",
      "Maximum number of agents to run concurrently",
      parseMaxParallelOption,
    )
    .option("--branch", "Checkout or create a branch named after the spec file")
    .allowExcessArguments(false)
    .action(async (options: RunCommandActionOptions) => {
      const runOptions: RunCommandOptions = {
        specPath: options.spec,
        agentIds: options.agent,
        maxParallel: options.maxParallel,
        branch: options.branch,
      };

      const result = await runRunCommand(runOptions);
      writeCommandOutput({
        body: result.body,
        exitCode: result.exitCode,
      });
    });
}
