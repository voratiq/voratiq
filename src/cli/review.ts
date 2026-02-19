import { dirname, resolve } from "node:path";

import { Command } from "commander";

import { checkPlatformSupport } from "../agents/runtime/sandbox.js";
import { resolveBlindedRecommendation } from "../commands/review/blinded.js";
import {
  executeReviewCommand,
  type ReviewCommandResult as ReviewExecutionResult,
} from "../commands/review/command.js";
import {
  readReviewRecommendation,
  type ReviewRecommendation,
} from "../commands/review/recommendation.js";
import { buildMarkdownPreviewLines } from "../commands/shared/preview.js";
import {
  ensureSandboxDependencies,
  resolveCliContext,
} from "../preflight/index.js";
import { renderReviewTranscript } from "../render/transcripts/review.js";
import { readReviewRecords } from "../reviews/records/persistence.js";
import { REVIEW_RECOMMENDATION_FILENAME } from "../workspace/structure.js";
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
    const recommendationPath = resolve(
      root,
      dirname(execution.outputPath),
      REVIEW_RECOMMENDATION_FILENAME,
    );
    const recommendation = await readReviewRecommendation(recommendationPath);
    const previewResolution = await resolveReviewPreviewRecommendation({
      recommendation,
      root,
      reviewsFilePath: workspacePaths.reviewsFile,
      reviewId: execution.reviewId,
    });
    previewLines = buildMarkdownPreviewLines(
      formatResolvedRecommendationSnippet(
        previewResolution.recommendation,
        previewResolution.aliasMap,
      ),
    );
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

interface ReviewPreviewResolution {
  recommendation: ReviewRecommendation;
  aliasMap?: Record<string, string>;
}

async function resolveReviewPreviewRecommendation(options: {
  recommendation: ReviewRecommendation;
  root: string;
  reviewsFilePath: string;
  reviewId: string;
}): Promise<ReviewPreviewResolution> {
  const { recommendation, root, reviewsFilePath, reviewId } = options;
  const aliasMap = await readReviewAliasMap({
    root,
    reviewsFilePath,
    reviewId,
  });
  if (recommendation.resolved_preferred_agents !== undefined) {
    return { recommendation, ...(aliasMap ? { aliasMap } : {}) };
  }

  if (!aliasMap) {
    return { recommendation };
  }
  return {
    recommendation: resolveBlindedRecommendation({
      recommendation,
      aliasMap,
    }).recommendation,
    aliasMap,
  };
}

async function readReviewAliasMap(options: {
  root: string;
  reviewsFilePath: string;
  reviewId: string;
}): Promise<Record<string, string> | undefined> {
  const { root, reviewsFilePath, reviewId } = options;
  try {
    const records = await readReviewRecords({
      root,
      reviewsFilePath,
      limit: 1,
      predicate: (record) => record.sessionId === reviewId,
    });
    return records[0]?.blinded?.aliasMap;
  } catch {
    return undefined;
  }
}

function formatResolvedRecommendationSnippet(
  recommendation: ReviewRecommendation,
  aliasMap?: Record<string, string>,
): string {
  const preferredSource =
    recommendation.resolved_preferred_agents ?? recommendation.preferred_agents;
  const preferredAgents = Array.from(
    new Set(preferredSource.map((agentId) => agentId.trim()).filter(Boolean)),
  );
  const nextActions = recommendation.next_actions
    .map((action) => action.trim())
    .filter(Boolean)
    .map((action) => canonicalizeApplyActionLine(action, aliasMap));
  const rationaleSource =
    recommendation.rationale.trim().length > 0
      ? recommendation.rationale.trim()
      : "none";
  const rationale = canonicalizeAliasTokens(rationaleSource, aliasMap);

  return [
    "## Recommendation",
    `**Preferred Candidate(s)**: ${
      preferredAgents.length > 0 ? preferredAgents.join(", ") : "none"
    }`,
    `**Rationale**: ${rationale}`,
    "**Next Actions**:",
    ...(nextActions.length > 0 ? nextActions : ["none"]),
  ].join("\n");
}

function canonicalizeApplyActionLine(
  action: string,
  aliasMap?: Record<string, string>,
): string {
  if (!aliasMap) {
    return action;
  }

  const applyWithAgentPattern =
    /(\bvoratiq\s+apply\b.*?\s--agent\s+)(["']?)([^\s"'`]+)\2/giu;
  return action.replace(
    applyWithAgentPattern,
    (match, prefix: string, quote: string, selector: string) => {
      const canonical = aliasMap[selector];
      if (!canonical) {
        return match;
      }
      return `${prefix}${quote}${canonical}${quote}`;
    },
  );
}

function canonicalizeAliasTokens(
  content: string,
  aliasMap?: Record<string, string>,
): string {
  if (!aliasMap) {
    return content;
  }
  let output = content;
  const entries = Object.entries(aliasMap).sort(
    ([left], [right]) => right.length - left.length,
  );

  for (const [alias, canonical] of entries) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(?<![a-z0-9_-])${escaped}(?![a-z0-9_-])`,
      "giu",
    );
    output = output.replace(pattern, canonical);
  }

  return output;
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
    .option("--profile <name>", 'Orchestration profile (default: "default")')
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
