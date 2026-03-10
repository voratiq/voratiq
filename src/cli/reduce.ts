import { readFile } from "node:fs/promises";

import { Command, Option } from "commander";

import { checkPlatformSupport } from "../agents/runtime/sandbox.js";
import { executeReduceCommand } from "../commands/reduce/command.js";
import {
  buildMarkdownPreviewLines,
  extractMarkdownSection,
} from "../commands/shared/preview.js";
import { resolveExtraContextFiles } from "../competition/shared/extra-context.js";
import {
  readReductionArtifact,
  type ReductionArtifact,
} from "../domains/reductions/competition/reduction.js";
import type { ReductionTarget } from "../domains/reductions/model/types.js";
import { readReductionRecords } from "../domains/reductions/persistence/adapter.js";
import {
  ensureSandboxDependencies,
  resolveCliContext,
} from "../preflight/index.js";
import {
  createReduceRenderer,
  formatReduceElapsed,
  formatReducerDuration,
  renderReduceTranscript,
} from "../render/transcripts/reduce.js";
import { createStageStartLineEmitter } from "../render/utils/stage-output.js";
import {
  normalizePathForDisplay,
  relativeToRoot,
  resolvePath,
} from "../utils/path.js";
import { parsePositiveInteger } from "../utils/validators.js";
import { VORATIQ_REDUCTIONS_FILE } from "../workspace/structure.js";
import type { CommandOutputWriter } from "./output.js";
import { writeCommandOutput } from "./output.js";

export interface ReduceCommandOptions {
  target: ReductionTarget;
  agentIds?: string[];
  agentOverrideFlag?: string;
  profile?: string;
  maxParallel?: number;
  extraContext?: string[];
  suppressHint?: boolean;
  writeOutput?: CommandOutputWriter;
  stdout?: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };
}

export interface ReduceCommandResult {
  reductionId: string;
  body: string;
  exitCode?: number;
}

export async function runReduceCommand(
  options: ReduceCommandOptions,
): Promise<ReduceCommandResult> {
  const {
    target,
    agentIds,
    agentOverrideFlag,
    profile,
    maxParallel,
    extraContext,
    suppressHint,
    writeOutput = writeCommandOutput,
    stdout,
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
  startLine.emit("Reducing artifacts…");

  const renderer = createReduceRenderer({
    stdout,
  });

  const execution = await executeReduceCommand({
    root,
    specsFilePath: workspacePaths.specsFile,
    runsFilePath: workspacePaths.runsFile,
    reviewsFilePath: workspacePaths.reviewsFile,
    reductionsFilePath:
      workspacePaths.reductionsFile ?? resolveReductionIndexPath(root),
    target,
    agentIds,
    agentOverrideFlag,
    profileName: profile,
    maxParallel,
    extraContextFiles,
    renderer,
  });

  const record = await readReductionSessionRecord({
    root,
    reductionsFilePath:
      workspacePaths.reductionsFile ?? resolveReductionIndexPath(root),
    reductionId: execution.reductionId,
  });
  if (!record) {
    throw new Error(
      `Reduction session \`${execution.reductionId}\` record not found after execution.`,
    );
  }

  const reducers = await Promise.all(
    record.reducers.map(async (reducer) => {
      const duration = formatReducerDuration({
        startedAt: reducer.startedAt,
        completedAt: reducer.completedAt,
      });

      let previewLines: string[] | undefined;
      if (reducer.status === "succeeded") {
        try {
          const reductionData = await readReductionArtifact(
            resolvePath(
              root,
              reducer.dataPath ??
                reducer.outputPath.replace(/reduction\.md$/u, "reduction.json"),
            ),
          );
          previewLines = buildMarkdownPreviewLines(
            formatReductionSnippet(reductionData),
          );
        } catch {
          try {
            const markdown = await readFile(
              resolvePath(root, reducer.outputPath),
              "utf8",
            );
            const synthesisSection =
              extractMarkdownSection(markdown, {
                heading: "Synthesis",
                level: 2,
              }) ??
              extractMarkdownSection(markdown, {
                heading: "Reduction",
                level: 2,
              }) ??
              markdown.trim();
            previewLines = buildMarkdownPreviewLines(synthesisSection);
          } catch {
            previewLines = undefined;
          }
        }
      }

      return {
        reducerAgentId: reducer.agentId,
        status: reducer.status,
        duration,
        outputPath: reducer.outputPath,
        dataPath: reducer.dataPath,
        previewLines,
        errorLine: reducer.error ?? undefined,
      };
    }),
  );

  const body = renderReduceTranscript({
    reductionId: execution.reductionId,
    createdAt: record.createdAt,
    elapsed: formatReduceElapsed(record.createdAt, record.completedAt) ?? "—",
    sourceLabel: mapTargetLabel(record.target.type),
    sourcePath: sourcePathForTarget(record.target),
    workspacePath: normalizePathForDisplay(
      relativeToRoot(
        root,
        resolvePath(
          root,
          `.voratiq/reductions/sessions/${execution.reductionId}`,
        ),
      ),
    ),
    status: record.status,
    reducers,
    suppressHint,
    isTty: stdout?.isTTY ?? process.stdout.isTTY,
    includeSummarySection: !(stdout?.isTTY ?? process.stdout.isTTY),
  });

  return {
    reductionId: execution.reductionId,
    body,
    exitCode: record.status === "succeeded" ? 0 : 1,
  };
}

function formatReductionSnippet(reduction: ReductionArtifact): string {
  const lines = ["## Reduction", `**Summary**: ${reduction.summary}`];

  if (reduction.directives.length > 0) {
    lines.push("", "**Directives**:");
    for (const directive of reduction.directives) {
      lines.push(`- ${directive}`);
    }
  }

  if (reduction.risks.length > 0) {
    lines.push("", "**Risks**:");
    for (const risk of reduction.risks) {
      lines.push(`- ${risk}`);
    }
  }

  return lines.join("\n");
}

interface ReduceCommandActionOptions {
  spec?: string;
  run?: string;
  review?: string;
  reduction?: string;
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

function resolveTargetFromOptions(
  options: ReduceCommandActionOptions,
  command: Command,
): ReductionTarget {
  const entries = [
    { type: "spec" as const, flag: "--spec", value: options.spec },
    { type: "run" as const, flag: "--run", value: options.run },
    { type: "review" as const, flag: "--review", value: options.review },
    {
      type: "reduction" as const,
      flag: "--reduction",
      value: options.reduction,
    },
  ].filter(
    (entry) => typeof entry.value === "string" && entry.value.length > 0,
  );

  if (entries.length !== 1) {
    const provided = entries.map((entry) => entry.flag).join(", ");
    const detail =
      entries.length === 0
        ? "No target flag was provided."
        : `Provided: ${provided}.`;
    command.error(
      `error: exactly one of --spec, --run, --review, or --reduction is required (${detail})`,
      { exitCode: 1 },
    );
  }

  const selected = entries[0];
  if (!selected || !selected.value) {
    command.error(
      "error: exactly one of --spec, --run, --review, or --reduction is required",
      { exitCode: 1 },
    );
  }

  return { type: selected.type, id: selected.value };
}

export function createReduceCommand(): Command {
  return new Command("reduce")
    .description("Reduce artifact sets into a summarized form")
    .addOption(new Option("--spec <spec-session-id>", "Spec session to reduce"))
    .addOption(new Option("--run <run-id>", "Run to reduce"))
    .addOption(new Option("--review <review-id>", "Review to reduce"))
    .addOption(new Option("--reduction <reduction-id>", "Reduction to reduce"))
    .addOption(
      new Option(
        "--agent <agent-id>",
        "Set reducer agents directly (repeatable; order preserved)",
      )
        .default([], "")
        .argParser(collectAgentOption),
    )
    .option("--profile <name>", 'Orchestration profile (default: "default")')
    .option(
      "--max-parallel <count>",
      "Max concurrent reducers (default: all)",
      parseMaxParallelOption,
    )
    .addOption(
      new Option(
        "--extra-context <path>",
        "Stage an extra context file into each reducer workspace (repeatable)",
      )
        .default([], "")
        .argParser(collectExtraContextOption),
    )
    .allowExcessArguments(false)
    .action(async (options: ReduceCommandActionOptions, command: Command) => {
      const target = resolveTargetFromOptions(options, command);
      const result = await runReduceCommand({
        target,
        agentIds: options.agent,
        profile: options.profile,
        maxParallel: options.maxParallel,
        extraContext: options.extraContext,
        writeOutput: writeCommandOutput,
      });

      writeCommandOutput({ body: result.body, exitCode: result.exitCode });
    });
}

async function readReductionSessionRecord(options: {
  root: string;
  reductionsFilePath: string;
  reductionId: string;
}) {
  const { root, reductionsFilePath, reductionId } = options;
  const records = await readReductionRecords({
    root,
    reductionsFilePath,
    limit: 1,
    predicate: (record) => record.sessionId === reductionId,
  });
  return records[0];
}

function resolveReductionIndexPath(root: string): string {
  return resolvePath(root, `.voratiq/${VORATIQ_REDUCTIONS_FILE}`);
}

function mapTargetLabel(
  targetType: ReductionTarget["type"],
): "Spec" | "Run" | "Review" | "Reduce" {
  switch (targetType) {
    case "spec":
      return "Spec";
    case "run":
      return "Run";
    case "review":
      return "Review";
    case "reduction":
      return "Reduce";
  }
}

function sourcePathForTarget(target: ReductionTarget): string {
  switch (target.type) {
    case "spec":
      return `.voratiq/specs/sessions/${target.id}`;
    case "run":
      return `.voratiq/runs/sessions/${target.id}`;
    case "review":
      return `.voratiq/reviews/sessions/${target.id}`;
    case "reduction":
      return `.voratiq/reductions/sessions/${target.id}`;
  }
}
