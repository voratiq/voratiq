import { dirname, resolve } from "node:path";

import { Command, Option } from "commander";

import { checkPlatformSupport } from "../agents/runtime/sandbox.js";
import {
  executeReviewCommand,
  type ReviewCommandResult as ReviewExecutionResult,
} from "../commands/review/command.js";
import { buildMarkdownPreviewLines } from "../commands/shared/preview.js";
import { resolveExtraContextFiles } from "../competition/shared/extra-context.js";
import { resolveBlindedRecommendation } from "../domains/reviews/competition/blinded.js";
import { ReviewGenerationFailedError } from "../domains/reviews/competition/errors.js";
import {
  readReviewRecommendation,
  type ReviewRecommendation,
} from "../domains/reviews/competition/recommendation.js";
import type { ReviewRecord } from "../domains/reviews/model/types.js";
import { readReviewRecords } from "../domains/reviews/persistence/adapter.js";
import {
  ensureSandboxDependencies,
  resolveCliContext,
} from "../preflight/index.js";
import {
  createReviewRenderer,
  renderReviewTranscript,
} from "../render/transcripts/review.js";
import { formatRenderLifecycleDuration } from "../render/utils/duration.js";
import { createStageStartLineEmitter } from "../render/utils/stage-output.js";
import { TERMINAL_REVIEW_STATUSES } from "../status/index.js";
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
  extraContext?: string[];
  suppressHint?: boolean;
  suppressLeadingBlankLine?: boolean;
  suppressTrailingBlankLine?: boolean;
  stdout?: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };
  stderr?: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };
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
    extraContext,
    suppressHint,
    suppressLeadingBlankLine,
    suppressTrailingBlankLine,
    stdout,
    stderr,
    writeOutput = writeCommandOutput,
  } = options;
  const { root, workspacePaths } = await resolveCliContext();

  checkPlatformSupport();
  ensureSandboxDependencies();
  const extraContextFiles = await resolveExtraContextFiles({
    root,
    paths: extraContext,
  });

  const startLine = createStageStartLineEmitter((message) => {
    writeOutput({
      alerts: [{ severity: "info", message }],
    });
  });
  startLine.emit("Generating review…");

  const renderer = createReviewRenderer({
    stdout,
    stderr,
    suppressLeadingBlankLine,
    suppressTrailingBlankLine,
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
    extraContextFiles,
    renderer,
  });

  const record = await readReviewSessionRecord({
    root,
    reviewsFilePath: workspacePaths.reviewsFile,
    reviewId: execution.reviewId,
  });
  if (!record) {
    throw new ReviewGenerationFailedError([
      `Review session \`${execution.reviewId}\` record not found after execution.`,
    ]);
  }

  const aliasMap = record.blinded?.aliasMap;
  const recommendedApplyAgents = new Set<string>();
  const reviewerBlocks = await Promise.all(
    record.reviewers.map(async (reviewerRecord) => {
      const reviewerAgentId = reviewerRecord.agentId;
      const duration = formatReviewerDuration({
        status: reviewerRecord.status,
        startedAt: reviewerRecord.startedAt,
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
            "Reviewer process failed with no `review.md` output.",
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
        const resolvedPreferredAgent =
          previewRecommendation.resolved_preferred_agent ??
          previewRecommendation.preferred_agent;
        const normalizedPreferredAgent = resolvedPreferredAgent.trim();
        if (normalizedPreferredAgent.length > 0) {
          recommendedApplyAgents.add(normalizedPreferredAgent);
        }

        return {
          reviewerAgentId,
          outputPath,
          status: reviewerRecord.status,
          duration,
          previewLines,
          errorLine: undefined,
        } as const;
      } catch {
        throw new ReviewGenerationFailedError(
          [
            `Failed to load \`${REVIEW_RECOMMENDATION_FILENAME}\` for reviewer \`${reviewerAgentId}\`.`,
          ],
          [
            `Re-run review to regenerate \`${REVIEW_RECOMMENDATION_FILENAME}\`.`,
          ],
        );
      }
    }),
  );
  const recommendedAgentId =
    recommendedApplyAgents.size === 1
      ? [...recommendedApplyAgents][0]
      : undefined;

  const body = renderReviewTranscript({
    runId: execution.runRecord.runId,
    reviewId: execution.reviewId,
    createdAt: record.createdAt,
    elapsed:
      formatReviewElapsed({
        status: record.status,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
      }) ?? "—",
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
    recommendedAgentId,
    suppressHint,
    isTty: stdout?.isTTY ?? process.stdout.isTTY,
    includeSummarySection: !(stdout?.isTTY ?? process.stdout.isTTY),
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

function formatReviewElapsed(options: {
  status: ReviewRecord["status"];
  startedAt?: string;
  completedAt?: string;
  now?: number;
}): string | undefined {
  return formatRenderLifecycleDuration({
    lifecycle: {
      status: options.status,
      startedAt: options.startedAt,
      completedAt: options.completedAt,
    },
    terminalStatuses: TERMINAL_REVIEW_STATUSES,
    now: options.now,
  });
}

function formatReviewerDuration(options: {
  status: ReviewRecord["reviewers"][number]["status"];
  startedAt?: string;
  completedAt?: string;
  now?: number;
}): string {
  return (
    formatRenderLifecycleDuration({
      lifecycle: {
        status: options.status,
        startedAt: options.startedAt,
        completedAt: options.completedAt,
      },
      terminalStatuses: TERMINAL_REVIEW_STATUSES,
      now: options.now,
    }) ?? "—"
  );
}

interface ReviewCommandActionOptions {
  run: string;
  agent?: string[];
  profile?: string;
  maxParallel?: number;
  extraContext?: string[];
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

export function createReviewCommand(): Command {
  return new Command("review")
    .description("Review a recorded run")
    .requiredOption("--run <run-id>", "Run ID to review")
    .addOption(
      new Option(
        "--agent <agent-id>",
        "Set reviewers directly (repeatable; order preserved)",
      )
        .default([], "")
        .argParser(collectAgentOption),
    )
    .option("--profile <name>", 'Orchestration profile (default: "default")')
    .option(
      "--max-parallel <count>",
      "Max concurrent reviewers (default: all)",
      parseMaxParallelOption,
    )
    .addOption(
      new Option(
        "--extra-context <path>",
        "Stage an extra context file into each reviewer workspace (repeatable)",
      )
        .default([], "")
        .argParser(collectExtraContextOption),
    )
    .allowExcessArguments(false)
    .action(async (options: ReviewCommandActionOptions) => {
      const result = await runReviewCommand({
        runId: options.run,
        agentIds: options.agent,
        profile: options.profile,
        maxParallel: options.maxParallel,
        extraContext: options.extraContext,
      });

      writeCommandOutput({
        body: result.body,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    });
}
