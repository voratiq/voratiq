import { readFile } from "node:fs/promises";

import { Command, Option } from "commander";

import { checkPlatformSupport } from "../agents/runtime/sandbox.js";
import { executeMessageCommand } from "../commands/message/command.js";
import { buildMarkdownPreviewLines } from "../commands/shared/preview.js";
import { resolveExtraContextFiles } from "../competition/shared/extra-context.js";
import { resolveInteractiveSessionEnvLineage } from "../domain/interactive/session-env.js";
import {
  ensureSandboxDependencies,
  resolveCliContext,
} from "../preflight/index.js";
import {
  createMessageRenderer,
  formatMessageElapsed,
  formatMessageRecipientDuration,
  renderMessageTranscript,
} from "../render/transcripts/message.js";
import { renderWorkspaceAutoInitializedNotice } from "../render/transcripts/shared.js";
import { createStageStartLineEmitter } from "../render/utils/stage-output.js";
import { resolvePath } from "../utils/path.js";
import { VORATIQ_MESSAGE_FILE } from "../workspace/constants.js";
import { resolveWorkspacePath } from "../workspace/path-resolvers.js";
import { parseMessageExecutionCommandOptions } from "./contract.js";
import {
  buildMessageOperatorEnvelope,
  createSilentCliWriter,
  writeOperatorResultEnvelope,
} from "./operator-envelope.js";
import {
  collectRepeatedStringOption,
  parseMaxParallelOption,
} from "./option-parsers.js";
import { type CommandOutputWriter, writeCommandOutput } from "./output.js";
import { promptForRepositoryLinkIfNeeded } from "./repository-link.js";

export interface MessageCommandOptions {
  prompt: string;
  agentIds?: string[];
  profile?: string;
  maxParallel?: number;
  extraContext?: string[];
  json?: boolean;
  stdout?: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };
  stderr?: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };
  writeOutput?: CommandOutputWriter;
}

export interface MessageCommandResult {
  body: string;
  sessionId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "aborted";
  outputArtifacts: ReadonlyArray<{
    agentId: string;
    outputPath?: string;
  }>;
}

export async function runMessageCommand(
  options: MessageCommandOptions,
): Promise<MessageCommandResult> {
  const {
    prompt,
    agentIds,
    profile,
    maxParallel,
    extraContext,
    json = false,
    stdout,
    stderr,
    writeOutput,
  } = options;
  const effectiveWriteOutput = json
    ? undefined
    : (writeOutput ?? writeCommandOutput);
  const rendererStdout = json ? createSilentCliWriter() : stdout;
  const rendererStderr = json ? createSilentCliWriter() : stderr;
  const isTty = json ? false : (stdout?.isTTY ?? process.stdout.isTTY);

  const { root, workspacePaths, workspaceAutoInitialized } =
    await resolveCliContext({
      workspaceAutoInitMode: "when-missing",
    });
  await promptForRepositoryLinkIfNeeded({ root, json });

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
    startLine.emit("Messaging…");
  }

  const renderer = createMessageRenderer({
    stdout: rendererStdout,
    stderr: rendererStderr,
  });

  const envLineage = await resolveInteractiveSessionEnvLineage({
    root,
    envValue: process.env.VORATIQ_INTERACTIVE_SESSION_ID,
  });

  const execution = await executeMessageCommand({
    root,
    messagesFilePath:
      workspacePaths.messagesFile ??
      resolveWorkspacePath(root, VORATIQ_MESSAGE_FILE),
    prompt,
    agentIds,
    profileName: profile,
    maxParallel,
    extraContextFiles,
    target:
      envLineage.kind === "trusted"
        ? {
            kind: "interactive",
            sessionId: envLineage.sessionId,
          }
        : undefined,
    renderer,
  });

  const body = renderMessageTranscript({
    messageId: execution.messageId,
    createdAt: execution.record.createdAt,
    elapsed:
      formatMessageElapsed({
        status: execution.record.status,
        startedAt: execution.record.startedAt,
        completedAt: execution.record.completedAt,
      }) ?? "—",
    workspacePath: `.voratiq/message/sessions/${execution.messageId}`,
    status: execution.record.status,
    recipients: await Promise.all(
      execution.recipients.map(async (recipient) => ({
        agentId: recipient.agentId,
        status: recipient.status,
        duration:
          formatMessageRecipientDuration({
            status: recipient.status,
            startedAt: recipient.startedAt,
            completedAt: recipient.completedAt,
          }) ?? "—",
        outputPath: recipient.outputPath,
        previewLines:
          recipient.status === "succeeded" && recipient.outputPath
            ? buildMarkdownPreviewLines(
                await readFile(resolvePath(root, recipient.outputPath), "utf8"),
              )
            : undefined,
        errorLine: recipient.error ?? undefined,
      })),
    ),
    isTty,
    includeSummarySection: !isTty,
  });

  return {
    body,
    sessionId: execution.messageId,
    status: execution.record.status,
    outputArtifacts: execution.recipients.map((recipient) => ({
      agentId: recipient.agentId,
      outputPath: recipient.outputPath,
    })),
  };
}

interface MessageCommandActionOptions {
  prompt: string;
  agent?: string[];
  profile?: string;
  maxParallel?: number;
  extraContext?: string[];
  json?: boolean;
}

export function createMessageCommand(): Command {
  return new Command("message")
    .description("Send an isolated prompt to one or more agents")
    .requiredOption("--prompt <text>", "Prompt to send")
    .addOption(
      new Option(
        "--agent <agent-id>",
        "Set recipient agents directly (repeatable; order preserved)",
      )
        .default([], "")
        .argParser(collectRepeatedStringOption),
    )
    .option("--profile <name>", 'Orchestration profile (default: "default")')
    .option(
      "--max-parallel <count>",
      "Max concurrent recipients (default: all)",
      parseMaxParallelOption,
    )
    .addOption(
      new Option(
        "--extra-context <path>",
        "Stage an extra context file into each recipient workspace (repeatable)",
      )
        .default([], "")
        .argParser(collectRepeatedStringOption),
    )
    .option("--json", "Emit a machine-readable result envelope")
    .allowExcessArguments(false)
    .action(async (options: MessageCommandActionOptions, command: Command) => {
      const input = parseMessageExecutionCommandOptions(options, command);
      const result = await runMessageCommand({
        prompt: input.prompt,
        agentIds: input.agentIds,
        profile: input.profile,
        maxParallel: input.maxParallel,
        extraContext: input.extraContext,
        json: Boolean(options.json),
      });

      if (options.json) {
        writeOperatorResultEnvelope(
          buildMessageOperatorEnvelope({
            sessionId: result.sessionId,
            status: result.status,
            outputArtifacts: result.outputArtifacts,
          }),
          result.status === "succeeded" ? 0 : 1,
        );
        return;
      }

      writeCommandOutput({
        body: result.body,
        exitCode: result.status === "succeeded" ? 0 : 1,
      });
    });
}
