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
} from "../domain/reduce/competition/reduction.js";
import type {
  ReductionRecord,
  ReductionTarget,
} from "../domain/reduce/model/types.js";
import { readReductionRecords } from "../domain/reduce/persistence/adapter.js";
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
import {
  resolveWorkspacePath,
  VORATIQ_REDUCTION_FILE,
  VORATIQ_VERIFICATION_FILE,
} from "../workspace/structure.js";
import {
  buildReduceOperatorEnvelope,
  createSilentCliWriter,
  writeOperatorResultEnvelope,
} from "./operator-envelope.js";
import type { CommandOutputWriter } from "./output.js";
import { writeCommandOutput } from "./output.js";

export interface ReduceCommandOptions {
  target: ReductionTarget;
  agentIds?: string[];
  agentOverrideFlag?: string;
  profile?: string;
  maxParallel?: number;
  extraContext?: string[];
  json?: boolean;
  suppressHint?: boolean;
  writeOutput?: CommandOutputWriter;
  stdout?: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };
  stderr?: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };
}

export interface ReduceCommandResult {
  reductionId: string;
  status: ReductionRecord["status"];
  target: ReductionTarget;
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
    json = false,
    suppressHint,
    writeOutput,
    stdout,
    stderr,
  } = options;
  const effectiveWriteOutput = json
    ? undefined
    : (writeOutput ?? writeCommandOutput);
  const rendererStdout = json ? createSilentCliWriter() : stdout;
  const rendererStderr = json ? createSilentCliWriter() : stderr;

  const { root, workspacePaths } = await resolveCliContext();

  checkPlatformSupport();
  ensureSandboxDependencies();
  const extraContextFiles = await resolveExtraContextFiles({
    root,
    paths: extraContext,
  });

  const startLine = createStageStartLineEmitter((message) => {
    effectiveWriteOutput?.({
      alerts: [{ severity: "info", message }],
    });
  });
  if (effectiveWriteOutput) {
    startLine.emit("Reducing artifacts…");
  }

  const renderer = createReduceRenderer({
    stdout: rendererStdout,
    stderr: rendererStderr,
  });

  const execution = await executeReduceCommand({
    root,
    specsFilePath: workspacePaths.specsFile,
    runsFilePath: workspacePaths.runsFile,
    reductionsFilePath:
      workspacePaths.reductionsFile ?? resolveReductionIndexPath(root),
    verificationsFilePath:
      workspacePaths.verificationsFile ??
      resolveWorkspacePath(root, VORATIQ_VERIFICATION_FILE),
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
        status: reducer.status,
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
    elapsed:
      formatReduceElapsed({
        status: record.status,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
      }) ?? "—",
    workspacePath: normalizePathForDisplay(
      relativeToRoot(
        root,
        resolvePath(root, `.voratiq/reduce/sessions/${execution.reductionId}`),
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
    status: record.status,
    target: record.target,
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
  verify?: string;
  reduce?: string;
  agent?: string[];
  profile?: string;
  maxParallel?: number;
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

function resolveTargetFromOptions(
  options: ReduceCommandActionOptions,
  command: Command,
): ReductionTarget {
  const entries = [
    { type: "spec" as const, flag: "--spec", value: options.spec },
    { type: "run" as const, flag: "--run", value: options.run },
    {
      type: "verify" as const,
      flag: "--verify",
      value: options.verify,
    },
    {
      type: "reduce" as const,
      flag: "--reduce",
      value: options.reduce,
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
      `error: exactly one target flag is required: \`--spec\`, \`--run\`, \`--verify\`, or \`--reduce\` (${detail})`,
      { exitCode: 1 },
    );
  }

  const selected = entries[0];
  if (!selected || !selected.value) {
    command.error(
      "error: exactly one target flag is required: `--spec`, `--run`, `--verify`, or `--reduce`",
      { exitCode: 1 },
    );
  }

  return { type: selected.type, id: selected.value };
}

export function createReduceCommand(): Command {
  return new Command("reduce")
    .description("Reduce artifact sets into a summarized form")
    .addOption(new Option("--spec <spec-id>", "Spec to reduce"))
    .addOption(new Option("--run <run-id>", "Run to reduce"))
    .addOption(new Option("--verify <verify-id>", "Verification to reduce"))
    .addOption(new Option("--reduce <reduce-id>", "Reduction to reduce"))
    .addOption(
      new Option(
        "--agent <agent-id>",
        "Set reducers directly (repeatable; order preserved)",
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
    .option("--json", "Emit a machine-readable result envelope")
    .allowExcessArguments(false)
    .action(async (options: ReduceCommandActionOptions, command: Command) => {
      const target = resolveTargetFromOptions(options, command);
      const result = await runReduceCommand({
        target,
        agentIds: options.agent,
        profile: options.profile,
        maxParallel: options.maxParallel,
        extraContext: options.extraContext,
        json: Boolean(options.json),
        writeOutput: options.json ? undefined : writeCommandOutput,
      });

      if (options.json) {
        writeOperatorResultEnvelope(
          buildReduceOperatorEnvelope({
            reductionId: result.reductionId,
            target: result.target,
            status: result.status,
          }),
          result.exitCode,
        );
        return;
      }
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
  return resolvePath(root, `.voratiq/${VORATIQ_REDUCTION_FILE}`);
}
