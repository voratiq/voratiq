import { dirname, resolve } from "node:path";

import { Command, Option } from "commander";

import { checkPlatformSupport } from "../agents/runtime/sandbox.js";
import { resolveBlindedRecommendation } from "../commands/review/blinded.js";
import {
  executeReviewCommand,
  type ReviewCommandResult as ReviewExecutionResult,
} from "../commands/review/command.js";
import { ReviewGenerationFailedError } from "../commands/review/errors.js";
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
import { formatDurationLabel } from "../render/utils/agents.js";
import { readReviewRecords } from "../reviews/records/persistence.js";
import type { ReviewRecord } from "../reviews/records/types.js";
import { toErrorMessage } from "../utils/errors.js";
import { normalizePathForDisplay, relativeToRoot } from "../utils/path.js";
import { parsePositiveInteger } from "../utils/validators.js";
import {
  resolveWorkspacePath,
  REVIEW_RECOMMENDATION_FILENAME,
  VORATIQ_REVIEWS_SESSIONS_DIR,
} from "../workspace/structure.js";
import { type CommandOutputWriter, writeCommandOutput } from "./output.js";

export interface ReviewCommandOptions {
  runId: string;
  agentIds?: string[];
  agentOverrideFlag?: string;
  profile?: string;
  maxParallel?: number;
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
    agentIds,
    agentOverrideFlag,
    profile,
    maxParallel,
    suppressHint,
    writeOutput = writeCommandOutput,
  } = options;
  const { root, workspacePaths } = await resolveCliContext();
  checkPlatformSupport();
  ensureSandboxDependencies();

  writeOutput({
    alerts: [{ severity: "info", message: "Generating review…" }],
  });

  const execution = await executeReviewCommand({
    root,
    runsFilePath: workspacePaths.runsFile,
    reviewsFilePath: workspacePaths.reviewsFile,
    runId,
    agentIds,
    agentOverrideFlag,
    profileName: profile,
    maxParallel,
  });

  const record = await readReviewSessionRecord({
    root,
    reviewsFilePath: workspacePaths.reviewsFile,
    reviewId: execution.reviewId,
  });
  if (!record) {
    throw new ReviewGenerationFailedError([
      `Review session ${execution.reviewId} record not found after execution.`,
    ]);
  }

  const aliasMap = record.blinded?.aliasMap;
  const sessionStartMs = safeParseTimestamp(record.createdAt);

  const reviewerBlocks = await Promise.all(
    record.reviewers.map(async (reviewerRecord) => {
      const reviewerAgentId = reviewerRecord.agentId;
      const duration = formatReviewerDuration({
        sessionStartMs,
        completedAt: reviewerRecord.completedAt,
      });

      const outputPath = reviewerRecord.outputPath;
      if (reviewerRecord.status !== "succeeded") {
        return {
          reviewerAgentId,
          outputPath,
          status: reviewerRecord.status,
          duration,
          previewLines: undefined,
          errorLine:
            reviewerRecord.error ??
            "Reviewer process failed. No review output detected.",
        } as const;
      }

      const recommendationPath = resolve(
        root,
        dirname(outputPath),
        REVIEW_RECOMMENDATION_FILENAME,
      );

      try {
        const recommendation =
          await readReviewRecommendation(recommendationPath);
        const previewRecommendation =
          recommendation.resolved_preferred_agent !== undefined || !aliasMap
            ? recommendation
            : resolveBlindedRecommendation({
                recommendation,
                aliasMap,
              }).recommendation;
        const previewLines = buildMarkdownPreviewLines(
          formatResolvedRecommendationSnippet(previewRecommendation, aliasMap),
        );

        return {
          reviewerAgentId,
          outputPath,
          status: reviewerRecord.status,
          duration,
          previewLines,
          errorLine: undefined,
        } as const;
      } catch (error) {
        throw new ReviewGenerationFailedError(
          [
            `Failed to load recommendation artifact for reviewer ${reviewerAgentId}.`,
          ],
          [
            `Expected ${REVIEW_RECOMMENDATION_FILENAME} at ${recommendationPath}.`,
            toErrorMessage(error),
          ],
        );
      }
    }),
  );

  const body = renderReviewTranscript({
    runId: execution.runRecord.runId,
    reviewId: execution.reviewId,
    createdAt: record.createdAt,
    elapsed:
      formatReviewElapsed(record.createdAt, record.completedAt) ??
      formatReviewElapsed(record.createdAt) ??
      "—",
    workspacePath: normalizePathForDisplay(
      relativeToRoot(
        root,
        resolveWorkspacePath(
          root,
          VORATIQ_REVIEWS_SESSIONS_DIR,
          execution.reviewId,
        ),
      ),
    ),
    status: record.status,
    reviewers: reviewerBlocks,
    suppressHint,
  });

  return {
    ...execution,
    body,
    exitCode: record.status === "succeeded" ? 0 : 1,
  };
}

async function readReviewSessionRecord(options: {
  root: string;
  reviewsFilePath: string;
  reviewId: string;
}): Promise<ReviewRecord | undefined> {
  const { root, reviewsFilePath, reviewId } = options;
  const records = await readReviewRecords({
    root,
    reviewsFilePath,
    limit: 1,
    predicate: (record) => record.sessionId === reviewId,
  });
  return records[0];
}

function formatResolvedRecommendationSnippet(
  recommendation: ReviewRecommendation,
  aliasMap?: Record<string, string>,
): string {
  const preferredSource =
    recommendation.resolved_preferred_agent ?? recommendation.preferred_agent;
  const preferredAgent = preferredSource.trim();
  const nextActions = recommendation.next_actions
    .map((action) => action.trim())
    .filter(Boolean)
    .map((action) =>
      resolveAliasesInText(
        canonicalizeApplyActionLine(action, aliasMap),
        aliasMap,
      ),
    );
  const rationale =
    recommendation.rationale.trim().length > 0
      ? resolveAliasesInText(recommendation.rationale.trim(), aliasMap)
      : "none";

  return [
    "## Recommendation",
    `**Preferred Candidate**: ${preferredAgent || "none"}`,
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

function resolveAliasesInText(
  value: string,
  aliasMap?: Record<string, string>,
): string {
  if (!aliasMap) {
    return value;
  }

  let resolved = value;
  const entries = Object.entries(aliasMap);
  for (const [alias, canonical] of entries) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const pattern = new RegExp(`(?<![a-z0-9_-])${escaped}(?![a-z0-9_-])`, "gu");
    resolved = resolved.replace(pattern, canonical);
  }
  return resolved;
}

function safeParseTimestamp(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return parsed;
}

function formatReviewElapsed(
  createdAt: string,
  completedAt?: string,
): string | undefined {
  const start = safeParseTimestamp(createdAt);
  if (start === undefined) {
    return undefined;
  }
  const end = completedAt ? safeParseTimestamp(completedAt) : Date.now();
  if (end === undefined || end < start) {
    return undefined;
  }
  return formatDurationLabel(end - start);
}

function formatReviewerDuration(options: {
  sessionStartMs?: number;
  completedAt?: string;
}): string {
  const { sessionStartMs, completedAt } = options;
  if (sessionStartMs === undefined) {
    return "—";
  }
  const completedMs = safeParseTimestamp(completedAt);
  if (completedMs === undefined || completedMs < sessionStartMs) {
    return "—";
  }
  return formatDurationLabel(completedMs - sessionStartMs) ?? "—";
}

interface ReviewCommandActionOptions {
  run: string;
  agent?: string[];
  profile?: string;
  maxParallel?: number;
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

export function createReviewCommand(): Command {
  return new Command("review")
    .description("Generate a review of run artifacts")
    .requiredOption("--run <run-id>", "Identifier of the recorded run")
    .addOption(
      new Option("--agent <agent-id>", "Reviewer agent identifier (repeatable)")
        .default([], "")
        .argParser(collectAgentOption),
    )
    .option("--profile <name>", 'Orchestration profile (default: "default")')
    .option(
      "--max-parallel <count>",
      "Maximum number of reviewers to run concurrently",
      parseMaxParallelOption,
    )
    .allowExcessArguments(false)
    .action(async (options: ReviewCommandActionOptions) => {
      const result = await runReviewCommand({
        runId: options.run,
        agentIds: options.agent,
        profile: options.profile,
        maxParallel: options.maxParallel,
      });

      writeCommandOutput({
        body: result.body,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    });
}
