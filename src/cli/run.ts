import { Command } from "commander";

import { checkPlatformSupport } from "../agents/runtime/sandbox.js";
import { executeRunCommand } from "../commands/run/command.js";
import {
  ensureCleanWorkingTree,
  ensureSandboxDependencies,
  ensureSpecPath,
  resolveCliContext,
} from "../preflight/index.js";
import type { RunReport } from "../records/types.js";
import { createRunRenderer } from "../render/transcripts/run.js";
import { parsePositiveInteger } from "../utils/validators.js";
import { writeCommandOutput } from "./output.js";

export interface RunCommandOptions {
  specPath: string;
  maxParallel?: number;
}

export interface RunCommandResult {
  report: RunReport;
  body: string;
  exitCode?: number;
}

export async function runRunCommand(
  options: RunCommandOptions,
): Promise<RunCommandResult> {
  const { specPath, maxParallel } = options;

  const { root, workspacePaths } = await resolveCliContext();
  checkPlatformSupport();
  ensureSandboxDependencies();
  await ensureCleanWorkingTree(root);
  const { absolutePath, displayPath } = await ensureSpecPath(specPath, root);

  const renderer = createRunRenderer();

  const report = await executeRunCommand({
    root,
    runsFilePath: workspacePaths.runsFile,
    specAbsolutePath: absolutePath,
    specDisplayPath: displayPath,
    maxParallel,
    renderer,
  });

  const body = renderer.complete(report);

  // Unlike other commands, `run` signals a degraded outcome via exit code 1
  // when any agent or eval fails. All other CLI commands either throw on error
  // or return a clean success with exit code 0, so keep this deviation explicit.
  const exitCode =
    report.hadAgentFailure || report.hadEvalFailure ? 1 : undefined;

  return { report, body, exitCode };
}

interface RunCommandActionOptions {
  spec: string;
  maxParallel?: number;
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
      "--max-parallel <count>",
      "Maximum number of agents to run concurrently",
      parseMaxParallelOption,
    )
    .allowExcessArguments(false)
    .action(async (options: RunCommandActionOptions) => {
      const runOptions: RunCommandOptions = {
        specPath: options.spec,
        maxParallel: options.maxParallel,
      };

      const result = await runRunCommand(runOptions);
      writeCommandOutput({
        body: result.body,
        exitCode: result.exitCode,
      });
    });
}
