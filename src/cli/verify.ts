import { readFile } from "node:fs/promises";

import { Command, Option } from "commander";

import { checkPlatformSupport } from "../agents/runtime/sandbox.js";
import { buildMarkdownPreviewLines } from "../commands/shared/preview.js";
import { executeVerifyCommand } from "../commands/verify/command.js";
import type { VerifyTargetSelection } from "../commands/verify/targets.js";
import { resolveExtraContextFiles } from "../competition/shared/extra-context.js";
import { isBlindedCandidateAlias } from "../domain/verify/blinding/aliases.js";
import {
  type VerificationMethodResultRef,
  type VerificationRecord,
  verificationResultArtifactSchema,
} from "../domain/verify/model/types.js";
import {
  readRubricResultNarrative,
  readRubricResultNextActions,
  readRubricResultPreferred,
  readRubricResultRationale,
} from "../domain/verify/rubric-result.js";
import {
  loadVerificationSelectionPolicyOutput,
  type VerificationSelectionPolicyOutput,
} from "../policy/index.js";
import {
  ensureSandboxDependencies,
  resolveCliContext,
} from "../preflight/index.js";
import {
  createVerifyRenderer,
  formatVerifyElapsed,
  renderVerifyTranscript,
} from "../render/transcripts/verify.js";
import { formatRenderLifecycleDuration } from "../render/utils/duration.js";
import { createStageStartLineEmitter } from "../render/utils/stage-output.js";
import { renderTable } from "../render/utils/table.js";
import { getCheckStatusStyle } from "../status/colors.js";
import { TERMINAL_VERIFICATION_STATUSES } from "../status/index.js";
import { colorize } from "../utils/colors.js";
import { toErrorMessage } from "../utils/errors.js";
import {
  normalizePathForDisplay,
  relativeToRoot,
  resolvePath,
} from "../utils/path.js";
import { parsePositiveInteger } from "../utils/validators.js";
import {
  VORATIQ_MESSAGE_FILE,
  VORATIQ_REDUCTION_FILE,
  VORATIQ_VERIFICATION_FILE,
  VORATIQ_VERIFICATION_SESSIONS_DIR,
} from "../workspace/constants.js";
import { resolveWorkspacePath } from "../workspace/path-resolvers.js";
import { parseVerifyExecutionCommandOptions } from "./contract.js";
import {
  buildVerifyOperatorEnvelope,
  createSilentCliWriter,
  writeOperatorResultEnvelope,
} from "./operator-envelope.js";
import type { CommandOutputWriter } from "./output.js";
import { writeCommandOutput } from "./output.js";

export interface VerifyCommandOptions {
  target: VerifyTargetSelection;
  agentIds?: string[];
  agentOverrideFlag?: string;
  profile?: string;
  maxParallel?: number;
  extraContext?: string[];
  json?: boolean;
  suppressHint?: boolean;
  stdout?: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };
  stderr?: Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };
  writeOutput?: CommandOutputWriter;
}

export interface VerifyCommandResult {
  verificationId: string;
  status: VerificationRecord["status"] | "unresolved";
  target: VerificationRecord["target"];
  body: string;
  exitCode?: number;
  outputPath: string;
  selectedSpecPath?: string;
  selection?: VerificationSelectionPolicyOutput;
  warningMessage?: string;
}

function resolveVerifyManualActionMessage(options: {
  targetKind: VerificationRecord["target"]["kind"];
  status: VerificationRecord["status"];
  selection?: VerificationSelectionPolicyOutput;
  selectedSpecPath?: string;
}): string | undefined {
  const { targetKind, status, selection, selectedSpecPath } = options;
  if (status !== "succeeded") {
    return undefined;
  }

  if (targetKind === "spec" && !selectedSpecPath) {
    return "Verification did not select a spec path; manual review required.";
  }

  if (selection?.decision.state !== "unresolved") {
    return undefined;
  }

  if (targetKind === "run") {
    return "Verification did not produce a resolvable candidate; manual selection required.";
  }

  return "Verification did not produce a resolvable result; manual review required.";
}

export async function runVerifyCommand(
  options: VerifyCommandOptions,
): Promise<VerifyCommandResult> {
  const {
    target,
    agentIds,
    agentOverrideFlag,
    profile,
    maxParallel,
    extraContext,
    json = false,
    suppressHint,
    stdout,
    stderr,
    writeOutput,
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
    startLine.emit("Verifying…");
  }

  const renderer = createVerifyRenderer({
    stdout: rendererStdout,
    stderr: rendererStderr,
  });
  const isTty = json ? false : (stdout?.isTTY ?? process.stdout.isTTY);

  const execution = await executeVerifyCommand({
    root,
    specsFilePath: workspacePaths.specsFile,
    runsFilePath: workspacePaths.runsFile,
    reductionsFilePath:
      workspacePaths.reductionsFile ??
      resolveWorkspacePath(root, VORATIQ_REDUCTION_FILE),
    messagesFilePath:
      workspacePaths.messagesFile ??
      resolveWorkspacePath(root, VORATIQ_MESSAGE_FILE),
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

  const methodBlocks = await Promise.all(
    execution.record.methods.map(async (method) => {
      const bodyLines = await buildMethodBodyLines({
        root,
        aliasMap: execution.record.blinded?.aliasMap,
        method,
        isTty,
      });

      return {
        verifierLabel: formatMethodVerifierLabel(method),
        agentLabel: formatMethodAgentLabel(method),
        status: method.status,
        duration: formatMethodDuration(method),
        artifactPath: method.artifactPath,
        bodyLines,
        errorLine: method.error ?? undefined,
      };
    }),
  );

  let selectionPolicyWarning: string | undefined;
  const selection = await loadVerificationSelectionPolicyOutput({
    root,
    record: execution.record,
  }).catch((error: unknown) => {
    selectionPolicyWarning = [
      "Warning: failed to load verification selection policy output; apply hint unavailable.",
      toErrorMessage(error),
    ].join("\n");
    return undefined;
  });
  const selectionWarnings = (selection?.warnings ?? []).map(
    (warning) => `Warning: ${warning}`,
  );
  const selectedSpecPath =
    execution.record.target.kind === "spec" &&
    typeof execution.record.target.specPath === "string"
      ? execution.record.target.specPath
      : undefined;
  const manualActionMessage = resolveVerifyManualActionMessage({
    targetKind: execution.record.target.kind,
    status: execution.record.status,
    selection,
    selectedSpecPath,
  });
  const warningMessage = [
    ...selectionWarnings,
    ...(selectionPolicyWarning ? [selectionPolicyWarning] : []),
    ...(manualActionMessage ? [manualActionMessage] : []),
  ].join("\n");
  const displayStatus =
    selection?.decision.state === "unresolved"
      ? "unresolved"
      : execution.record.status;
  if (displayStatus === "unresolved" && !json) {
    renderer.complete("unresolved", {
      startedAt: execution.record.startedAt,
      completedAt: execution.record.completedAt,
    });
  }
  const recommendedRunAgent =
    execution.record.target.kind === "run" &&
    selection !== undefined &&
    selection.decision.state === "resolvable"
      ? selection.decision.selectedCanonicalAgentId
      : undefined;

  const hintMessage =
    suppressHint ||
    selectionPolicyWarning ||
    execution.record.target.kind !== "run" ||
    execution.record.status !== "succeeded" ||
    selection?.decision.state !== "resolvable"
      ? undefined
      : `To apply a solution:\n  voratiq apply --run ${execution.record.target.sessionId} --agent ${recommendedRunAgent}`;

  const outputPath = normalizePathForDisplay(
    relativeToRoot(
      root,
      resolveWorkspacePath(
        root,
        VORATIQ_VERIFICATION_SESSIONS_DIR,
        execution.verificationId,
      ),
    ),
  );

  const body = renderVerifyTranscript({
    verificationId: execution.verificationId,
    createdAt: execution.record.createdAt,
    elapsed:
      formatVerifyElapsed({
        status: execution.record.status,
        startedAt: execution.record.startedAt,
        completedAt: execution.record.completedAt,
      }) ?? "—",
    workspacePath: normalizePathForDisplay(
      relativeToRoot(
        root,
        resolveWorkspacePath(
          root,
          VORATIQ_VERIFICATION_SESSIONS_DIR,
          execution.verificationId,
        ),
      ),
    ),
    target: execution.record.target,
    status: displayStatus,
    methods: methodBlocks,
    suppressHint,
    ...(warningMessage ? { warningMessage } : {}),
    hintMessage,
    isTty,
    includeSummarySection: !isTty,
  });

  return {
    verificationId: execution.verificationId,
    status: displayStatus,
    target: execution.record.target,
    body,
    exitCode:
      execution.record.status === "succeeded" &&
      selection?.decision.state !== "unresolved" &&
      !(
        execution.record.target.kind === "spec" &&
        typeof selectedSpecPath !== "string"
      )
        ? 0
        : 1,
    outputPath,
    ...(selectedSpecPath ? { selectedSpecPath } : {}),
    selection,
    ...(warningMessage ? { warningMessage } : {}),
  };
}

interface VerifyCommandActionOptions {
  spec?: string;
  run?: string;
  reduce?: string;
  message?: string;
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

export function createVerifyCommand(): Command {
  return new Command("verify")
    .description("Verify a recorded spec, run, reduction, or message session")
    .addOption(new Option("--spec <spec-id>", "Spec to verify"))
    .addOption(new Option("--run <run-id>", "Run to verify"))
    .addOption(new Option("--reduce <reduce-id>", "Reduction to verify"))
    .addOption(
      new Option("--message <message-id>", "Message session to verify"),
    )
    .addOption(
      new Option(
        "--agent <agent-id>",
        "Set verifiers directly (repeatable; order preserved)",
      )
        .default([], "")
        .argParser(collectAgentOption),
    )
    .option("--profile <name>", 'Orchestration profile (default: "default")')
    .option(
      "--max-parallel <count>",
      "Max concurrent verifiers (default: all)",
      parseMaxParallelOption,
    )
    .addOption(
      new Option(
        "--extra-context <path>",
        "Stage an extra context file into each verifier workspace (repeatable)",
      )
        .default([], "")
        .argParser(collectExtraContextOption),
    )
    .option("--json", "Emit a machine-readable result envelope")
    .allowExcessArguments(false)
    .action(async (options: VerifyCommandActionOptions, command: Command) => {
      const input = parseVerifyExecutionCommandOptions(options, command);
      const result = await runVerifyCommand({
        target: input.target,
        agentIds: input.agentIds,
        profile: input.profile,
        maxParallel: input.maxParallel,
        extraContext: input.extraContext,
        json: Boolean(options.json),
      });

      if (options.json) {
        writeOperatorResultEnvelope(
          buildVerifyOperatorEnvelope({
            verificationId: result.verificationId,
            target: result.target,
            outputPath: result.outputPath,
            status: result.status,
            selection: result.selection?.decision,
            selectedSpecPath: result.selectedSpecPath,
            warningMessage: result.warningMessage,
          }),
          result.exitCode,
        );
        return;
      }
      writeCommandOutput({ body: result.body, exitCode: result.exitCode });
    });
}

function formatMethodDuration(method: VerificationMethodResultRef): string {
  return (
    formatRenderLifecycleDuration({
      lifecycle: {
        status: method.status,
        startedAt: method.startedAt,
        completedAt: method.completedAt,
      },
      terminalStatuses: TERMINAL_VERIFICATION_STATUSES,
    }) ?? "—"
  );
}

function formatMethodVerifierLabel(
  method: VerificationMethodResultRef,
): string {
  if (method.method === "programmatic") {
    return "programmatic";
  }

  return method.template ?? "rubric";
}

function formatMethodAgentLabel(
  method: VerificationMethodResultRef,
): string | undefined {
  if (method.method === "programmatic") {
    return undefined;
  }

  return method.verifierId;
}

async function buildMethodBodyLines(options: {
  root: string;
  aliasMap?: Record<string, string>;
  method: VerificationMethodResultRef;
  isTty?: boolean;
}): Promise<string[] | undefined> {
  const { root, aliasMap, method, isTty } = options;
  if (!method.artifactPath) {
    return undefined;
  }

  try {
    const raw = await readFile(resolvePath(root, method.artifactPath), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const validation = verificationResultArtifactSchema.safeParse(parsed);
    if (!validation.success) {
      return undefined;
    }

    const artifact = validation.data;
    if (artifact.method === "programmatic") {
      if (artifact.scope === "run") {
        return renderTable({
          columns: [
            {
              header: "AGENT",
              accessor: (row: (typeof artifact.candidates)[number]) =>
                row.candidateId,
            },
            {
              header: "CHECKS",
              accessor: (row: (typeof artifact.candidates)[number]) =>
                row.results
                  .map((result) =>
                    isTty
                      ? colorize(
                          result.slug,
                          getCheckStatusStyle(result.status).cli,
                        )
                      : result.slug,
                  )
                  .join(" "),
            },
          ],
          rows: [...artifact.candidates],
        });
      }
      return [`Results: ${artifact.results.length}`];
    }

    const lines: string[] = [];
    const preferred = readRubricResultPreferred(artifact.result);
    const rationale = readRubricResultRationale(artifact.result);
    const nextActions = readRubricResultNextActions(artifact.result);

    if (preferred) {
      lines.push(`**Preferred**: ${deblindText(preferred, aliasMap)}`);
    }

    if (rationale) {
      lines.push(`**Rationale**: ${deblindText(rationale, aliasMap)}`);
    }

    if (nextActions && nextActions.length > 0) {
      lines.push("**Next Actions**:");
      lines.push(...nextActions.map((action) => deblindText(action, aliasMap)));
    }

    if (lines.length > 0) {
      return buildMarkdownPreviewLines(lines.join("\n"));
    }

    if (lines.length === 0) {
      const narrative = readRubricResultNarrative(artifact.result);
      if (narrative) {
        lines.push(deblindText(narrative, aliasMap));
      }
    }

    return lines.length > 0 ? lines : undefined;
  } catch {
    return undefined;
  }
}

function deblindText(value: string, aliasMap?: Record<string, string>): string {
  if (!aliasMap) {
    return value;
  }

  let result = value;
  for (const [alias, canonicalId] of Object.entries(aliasMap).sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    result = result.split(alias).join(canonicalId);
  }

  return result.replace(/v_[a-z0-9]{10,16}/gu, (selector) =>
    isBlindedCandidateAlias(selector)
      ? `[unknown blinded alias: ${selector}]`
      : selector,
  );
}
