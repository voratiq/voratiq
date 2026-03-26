import { Command, Option } from "commander";

import { checkPlatformSupport } from "../agents/runtime/sandbox.js";
import { buildMarkdownPreviewLines } from "../commands/shared/preview.js";
import { executeSpecCommand } from "../commands/spec/command.js";
import { resolveExtraContextFiles } from "../competition/shared/extra-context.js";
import { readSpecData, type SpecData } from "../domain/spec/model/output.js";
import {
  ensureSandboxDependencies,
  resolveCliContext,
} from "../preflight/index.js";
import { renderWorkspaceAutoInitializedNotice } from "../render/transcripts/shared.js";
import {
  createSpecRenderer,
  formatSpecAgentDuration,
  formatSpecElapsed,
  renderSpecTranscript,
} from "../render/transcripts/spec.js";
import { createStageStartLineEmitter } from "../render/utils/stage-output.js";
import { resolvePath } from "../utils/path.js";
import { parsePositiveInteger } from "../utils/validators.js";
import { type CommandOutputWriter, writeCommandOutput } from "./output.js";

export interface SpecCommandOptions {
  description: string;
  agentIds?: string[];
  profile?: string;
  maxParallel?: number;
  title?: string;
  extraContext?: string[];
  suppressHint?: boolean;
  suppressLeadingBlankLine?: boolean;
  suppressTrailingBlankLine?: boolean;
  stdout?: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };
  stderr?: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };
  writeOutput?: CommandOutputWriter;
}

export interface SpecCommandResult {
  body: string;
  sessionId?: string;
  generatedSpecPaths: string[];
  /** Derived convenience path only when exactly one spec artifact was generated. */
  specPath?: string;
}

export async function runSpecCommand(
  options: SpecCommandOptions,
): Promise<SpecCommandResult> {
  const {
    description,
    agentIds,
    profile,
    maxParallel,
    title,
    extraContext,
    suppressHint,
    suppressLeadingBlankLine,
    suppressTrailingBlankLine,
    stdout,
    stderr,
    writeOutput = writeCommandOutput,
  } = options;

  const { root, workspacePaths, workspaceAutoInitialized } =
    await resolveCliContext({
      workspaceAutoInitMode: "when-missing",
    });

  const workspaceNotice = workspaceAutoInitialized
    ? renderWorkspaceAutoInitializedNotice()
    : undefined;

  if (workspaceNotice && writeOutput) {
    writeOutput({
      alerts: [{ severity: "info", message: workspaceNotice }],
      leadingNewline: false,
    });
  }

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

  const renderer = createSpecRenderer({
    stdout,
    stderr,
    suppressLeadingBlankLine,
    suppressTrailingBlankLine,
  });

  const result = await executeSpecCommand({
    root,
    specsFilePath: workspacePaths.specsFile,
    description,
    agentIds,
    profileName: profile,
    maxParallel,
    title,
    extraContextFiles,
    onStatus: (message) => {
      startLine.emit(message);
    },
    renderer,
  });

  const body = renderSpecTranscript(
    {
      sessionId: result.sessionId,
      createdAt: result.record.createdAt,
      elapsed:
        formatSpecElapsed({
          status: result.record.status,
          startedAt: result.record.startedAt,
          completedAt: result.record.completedAt,
        }) ?? "—",
      workspacePath: `.voratiq/spec/sessions/${result.sessionId}`,
      status: result.record.status,
      agents: await Promise.all(
        result.agents.map(async (agent) => ({
          agentId: agent.agentId,
          status: agent.status,
          duration: formatSpecAgentDuration({
            status: agent.status,
            startedAt: agent.startedAt,
            completedAt: agent.completedAt,
          }),
          outputPath: agent.outputPath,
          dataPath: agent.dataPath,
          previewLines:
            agent.status === "succeeded" && agent.dataPath
              ? buildMarkdownPreviewLines(
                  formatSpecPreview(
                    await readSpecData(resolvePath(root, agent.dataPath)),
                  ),
                )
              : undefined,
          errorLine: agent.error ?? undefined,
        })),
      ),
      nextCommandLines: ["voratiq run --spec <path>"],
      isTty: stdout?.isTTY ?? process.stdout.isTTY,
      includeSummarySection: !(stdout?.isTTY ?? process.stdout.isTTY),
    },
    { suppressHint },
  );

  const generatedSpecPaths = result.agents
    .filter((agent) => agent.status === "succeeded" && agent.outputPath)
    .map((agent) => agent.outputPath)
    .filter((outputPath): outputPath is string => outputPath !== undefined);

  return {
    body,
    sessionId: result.sessionId,
    generatedSpecPaths,
    specPath:
      generatedSpecPaths.length === 1 ? generatedSpecPaths[0] : undefined,
  };
}

interface SpecCommandActionOptions {
  description: string;
  agent?: string[];
  profile?: string;
  maxParallel?: number;
  title?: string;
  extraContext?: string[];
}

function formatSpecPreview(spec: SpecData): string {
  const lines = [`# ${spec.title}`, "", "## Objective", "", spec.objective];

  if (spec.scope.length > 0) {
    lines.push("", "## Scope");
    for (const item of spec.scope) {
      lines.push(`- ${item}`);
    }
  }

  if (spec.acceptanceCriteria.length > 0) {
    lines.push("", "## Acceptance Criteria");
    for (const criterion of spec.acceptanceCriteria) {
      lines.push(`- ${criterion}`);
    }
  }

  if (spec.constraints.length > 0) {
    lines.push("", "## Constraints");
    for (const item of spec.constraints) {
      lines.push(`- ${item}`);
    }
  }

  if (spec.outOfScope && spec.outOfScope.length > 0) {
    lines.push("", "## Out of Scope");
    for (const item of spec.outOfScope) {
      lines.push(`- ${item}`);
    }
  }

  lines.push("", "## Exit Signal", "", spec.exitSignal);

  return lines.join("\n");
}

export function createSpecCommand(): Command {
  const parseMaxParallelOption = (value: string): number =>
    parsePositiveInteger(
      value,
      "Expected positive integer after --max-parallel",
      "--max-parallel must be greater than 0",
    );
  const collectAgentOption = (value: string, previous: string[]): string[] => [
    ...previous,
    value,
  ];
  const collectExtraContextOption = (
    value: string,
    previous: string[],
  ): string[] => [...previous, value];

  return new Command("spec")
    .description("Generate a spec from a task description")
    .requiredOption("--description <text>", "Task description")
    .addOption(
      new Option(
        "--agent <agent-id>",
        "Set agents directly (repeatable; order preserved)",
      )
        .default([], "")
        .argParser(collectAgentOption),
    )
    .option("--profile <name>", 'Orchestration profile (default: "default")')
    .addOption(
      new Option("--max-parallel <count>", "Max concurrent agents")
        .argParser(parseMaxParallelOption)
        .hideHelp(),
    )
    .option("--title <text>", "Spec title; agent infers if omitted")
    .addOption(
      new Option(
        "--extra-context <path>",
        "Stage an extra context file into the spec workspace (repeatable)",
      )
        .default([], "")
        .argParser(collectExtraContextOption),
    )
    .allowExcessArguments(false)
    .action(async (options: SpecCommandActionOptions) => {
      const result = await runSpecCommand({
        description: options.description,
        agentIds: options.agent,
        profile: options.profile,
        maxParallel: options.maxParallel,
        title: options.title,
        extraContext: options.extraContext,
      });
      writeCommandOutput({ body: result.body });
    });
}
