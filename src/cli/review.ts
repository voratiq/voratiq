import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Command } from "commander";

import { checkPlatformSupport } from "../agents/runtime/sandbox.js";
import {
  executeReviewCommand,
  type ReviewCommandResult as ReviewExecutionResult,
} from "../commands/review/command.js";
import {
  buildMarkdownPreviewLines,
  extractMarkdownSection,
} from "../commands/shared/preview.js";
import {
  ensureSandboxDependencies,
  resolveCliContext,
} from "../preflight/index.js";
import { renderReviewTranscript } from "../render/transcripts/review.js";
import { type CommandOutputWriter, writeCommandOutput } from "./output.js";

export interface ReviewCommandOptions {
  runId: string;
  agentId?: string;
  agentOverrideFlag?: string;
  profile?: string;
  suppressHint?: boolean;
  writeOutput?: CommandOutputWriter;
}

export interface ReviewCommandResult extends ReviewExecutionResult {
  body: string;
  stderr?: string;
  exitCode?: number;
}

export async function runReviewCommand(
  options: ReviewCommandOptions,
): Promise<ReviewCommandResult> {
  const {
    runId,
    agentId,
    agentOverrideFlag,
    profile,
    suppressHint,
    writeOutput = writeCommandOutput,
  } = options;
  const { root, workspacePaths } = await resolveCliContext();
  checkPlatformSupport();
  ensureSandboxDependencies();

  writeOutput({
    alerts: [{ severity: "info", message: "Generating review..." }],
  });

  const execution = await executeReviewCommand({
    root,
    runsFilePath: workspacePaths.runsFile,
    reviewsFilePath: workspacePaths.reviewsFile,
    runId,
    agentId,
    agentOverrideFlag,
    profileName: profile,
  });

  let previewLines: string[] | undefined;
  try {
    const reviewContent = await readFile(
      resolve(root, execution.outputPath),
      "utf8",
    );
    const recommendationSection = extractMarkdownSection(reviewContent, {
      heading: "Recommendation",
    });
    previewLines = recommendationSection
      ? buildMarkdownPreviewLines(recommendationSection)
      : undefined;
  } catch {
    previewLines = undefined;
  }

  const body = renderReviewTranscript({
    runId: execution.runRecord.runId,
    outputPath: execution.outputPath,
    previewLines,
    suppressHint,
    ...(execution.missingArtifacts.length > 0
      ? { missingArtifacts: execution.missingArtifacts }
      : {}),
  });

  return {
    ...execution,
    body,
  };
}

interface ReviewCommandActionOptions {
  run: string;
  agent?: string;
  profile?: string;
}

export function createReviewCommand(): Command {
  return new Command("review")
    .description("Generate a review of run artifacts")
    .requiredOption("--run <run-id>", "Identifier of the recorded run")
    .option("--agent <agent-id>", "Reviewer agent identifier")
    .option(
      "--profile <name>",
      "Orchestration profile (default: \"default\")",
    )
    .allowExcessArguments(false)
    .action(async (options: ReviewCommandActionOptions) => {
      const result = await runReviewCommand({
        runId: options.run,
        agentId: options.agent,
        profile: options.profile,
      });

      writeCommandOutput({
        body: result.body,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    });
}
