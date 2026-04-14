import process from "node:process";

import { CliError } from "../../cli/errors.js";
import {
  type CommandOutputWriter,
  writeCommandOutput,
} from "../../cli/output.js";
import type { AgentCatalogDiagnostics } from "../../configs/agents/loader.js";
import { loadAgentCatalogDiagnostics } from "../../configs/agents/loader.js";
import type { AgentConfigEntry } from "../../configs/agents/types.js";
import {
  type PreparedInteractiveSession,
  prepareNativeInteractiveSession,
  type PrepareNativeSessionResult,
  spawnPreparedInteractiveSession,
  type SpawnPreparedSessionResult,
} from "../../interactive/index.js";
import { resolveCliContext } from "../../preflight/index.js";
import {
  renderRootLauncherInvalidSelection,
  renderRootLauncherLaunchStart,
  renderRootLauncherMcpInstallStart,
  renderRootLauncherMcpInstallSuccess,
  renderRootLauncherSelectionScreen,
  renderRootLauncherSingleAgentScreen,
} from "../../render/transcripts/root-launcher.js";
import { renderWorkspaceAutoInitializedNotice } from "../../render/transcripts/shared.js";
import type { VoratiqCliTarget } from "../../utils/voratiq-cli-target.js";
import { createEntrypointVoratiqCliTarget } from "../../utils/voratiq-cli-target.js";

export interface RootLauncherPromptOptions {
  message: string;
}

export interface RootLauncherConfirmOptions {
  message: string;
  defaultValue?: boolean;
  prefaceLines?: readonly string[];
}

export interface RootLauncherWorkflow {
  prompt(options: RootLauncherPromptOptions): Promise<string>;
  confirm(options: RootLauncherConfirmOptions): Promise<boolean>;
  close(): void;
}

export interface RootLauncherWorkflowFactoryOptions {
  onUnavailable: () => never;
}

export interface RootLauncherCommandOptions {
  resolveContext?: typeof resolveCliContext;
  loadDiagnostics?: typeof loadAgentCatalogDiagnostics;
  createWorkflow?: (
    options: RootLauncherWorkflowFactoryOptions,
  ) => RootLauncherWorkflow;
  prepareSession?: (
    options: Parameters<typeof prepareNativeInteractiveSession>[0],
  ) => ReturnType<typeof prepareNativeInteractiveSession>;
  spawnSession?: (
    prepared: Parameters<typeof spawnPreparedInteractiveSession>[0],
    options: Parameters<typeof spawnPreparedInteractiveSession>[1],
  ) => ReturnType<typeof spawnPreparedInteractiveSession>;
  selfCliTarget?: VoratiqCliTarget;
  writeOutput?: CommandOutputWriter;
}

interface LaunchableAgent {
  entry: AgentConfigEntry;
}

interface UnavailableAgent {
  entry: AgentConfigEntry;
  reasons: readonly string[];
}

interface LauncherAvailability {
  launchable: readonly LaunchableAgent[];
  unavailable: readonly UnavailableAgent[];
}

interface RootLauncherSetupResult {
  root: string;
  availability: LauncherAvailability;
}

interface RootLauncherPromptResult {
  selected: LaunchableAgent;
}

interface StartedFirstPartySession {
  selected: LaunchableAgent;
  launchResult: SpawnPreparedSessionResult;
}

export async function runRootLauncherCommand(
  options: RootLauncherCommandOptions,
): Promise<void> {
  const {
    resolveContext = resolveCliContext,
    loadDiagnostics = loadAgentCatalogDiagnostics,
    createWorkflow,
    prepareSession = prepareNativeInteractiveSession,
    spawnSession = spawnPreparedInteractiveSession,
    selfCliTarget = createEntrypointVoratiqCliTarget({
      cliEntrypoint: process.argv[1],
    }),
    writeOutput = writeCommandOutput,
  } = options;
  const createRootLauncherWorkflow =
    createWorkflow ??
    (() => {
      throw new Error("Missing root launcher workflow factory.");
    });

  const setup = await setupRootLauncher({
    resolveContext,
    loadDiagnostics,
    writeOutput,
  });

  const workflow = createRootLauncherWorkflow({
    onUnavailable: () => {
      throw new CliError(
        "An interactive terminal is required to launch a native agent session.",
        [],
        [
          "Run `voratiq` from an interactive terminal, or use an explicit subcommand instead.",
        ],
      );
    },
  });

  let workflowClosed = false;
  const closeWorkflow = () => {
    if (!workflowClosed) {
      workflow.close();
      workflowClosed = true;
    }
  };

  try {
    const promptResult = await promptForLaunchPlan({
      availability: setup.availability,
      prompt: (promptOptions) => workflow.prompt(promptOptions),
      writeOutput,
    });
    const qaInitialPrompt = resolveQaInitialPrompt();

    let acceptedMcpInstallPrompt = false;
    const prepared = await prepareFirstPartyInteractiveSession({
      root: setup.root,
      selected: promptResult.selected,
      prepareSession,
      selfCliTarget,
      prompt: qaInitialPrompt,
      promptForMcpInstall: async (promptOptions) => {
        const accepted = await workflow.confirm({
          message: promptOptions.message,
          defaultValue: promptOptions.defaultValue,
          prefaceLines: ["", ...(promptOptions.prefaceLines ?? [])],
        });
        if (accepted) {
          acceptedMcpInstallPrompt = true;
          writeLauncherNotice(writeOutput, renderRootLauncherMcpInstallStart());
        }
        return accepted;
      },
    });
    if (!prepared.ok) {
      throw new CliError(
        `Failed to launch ${formatAgentLabel(promptResult.selected.entry)}.`,
        [prepared.failure.message],
      );
    }
    if (acceptedMcpInstallPrompt) {
      writeLauncherNotice(writeOutput, renderRootLauncherMcpInstallSuccess());
    }

    closeWorkflow();
    const started = await launchFirstPartyInteractiveSession({
      selected: promptResult.selected,
      prepared: prepared.prepared,
      spawnSession,
      writeOutput,
    });
    await finalizeLaunchResult(started.selected, started.launchResult);
  } finally {
    closeWorkflow();
  }
}

async function setupRootLauncher(options: {
  resolveContext: typeof resolveCliContext;
  loadDiagnostics: typeof loadAgentCatalogDiagnostics;
  writeOutput: CommandOutputWriter;
}): Promise<RootLauncherSetupResult> {
  const { resolveContext, loadDiagnostics, writeOutput } = options;
  const context = await resolveContext({
    requireWorkspace: true,
    workspaceAutoInitMode: "when-missing",
  });

  if (context.workspaceAutoInitialized) {
    writeLauncherNotice(writeOutput, renderWorkspaceAutoInitializedNotice(), {
      leadingNewline: true,
    });
  }

  const diagnostics = loadDiagnostics({ root: context.root });
  assertEnabledAgents(diagnostics);

  const availability = buildLauncherAvailability(diagnostics);
  if (availability.launchable.length === 0) {
    throw buildNoLaunchableAgentsError(availability.unavailable);
  }

  return {
    root: context.root,
    availability,
  };
}

function assertEnabledAgents(diagnostics: AgentCatalogDiagnostics): void {
  if (diagnostics.enabledAgents.length > 0) {
    return;
  }

  throw new CliError(
    "No enabled agents found.",
    [],
    ["Run `voratiq doctor --fix` to repair workspace setup."],
  );
}

function buildLauncherAvailability(
  diagnostics: AgentCatalogDiagnostics,
): LauncherAvailability {
  const issuesByAgentId = new Map<string, string[]>();
  for (const issue of diagnostics.issues) {
    const current = issuesByAgentId.get(issue.agentId) ?? [];
    current.push(issue.message);
    issuesByAgentId.set(issue.agentId, current);
  }

  const resolvableAgentIds = new Set(
    diagnostics.catalog.map((agent) => agent.id),
  );
  const launchable: LaunchableAgent[] = [];
  const unavailable: UnavailableAgent[] = [];

  for (const entry of diagnostics.enabledAgents) {
    const reasons = issuesByAgentId.get(entry.id) ?? [];

    if (reasons.length === 0 && resolvableAgentIds.has(entry.id)) {
      launchable.push({ entry });
      continue;
    }

    unavailable.push({
      entry,
      reasons:
        reasons.length > 0
          ? reasons
          : ["agent definition could not be resolved"],
    });
  }

  return { launchable, unavailable };
}

async function promptForLaunchPlan(options: {
  availability: LauncherAvailability;
  prompt: RootLauncherWorkflow["prompt"];
  writeOutput: CommandOutputWriter;
}): Promise<RootLauncherPromptResult> {
  const { availability, prompt, writeOutput } = options;
  const selected =
    availability.launchable.length === 1
      ? availability.launchable[0]
      : await promptForAgentSelection({
          launchable: availability.launchable,
          unavailable: availability.unavailable,
          prompt: (promptOptions) => prompt(promptOptions),
          writeOutput,
        });

  if (availability.launchable.length === 1) {
    writeLauncherScreen(
      writeOutput,
      renderRootLauncherSingleAgentScreen({
        selected: formatAgentLabel(selected.entry),
        unavailable: availability.unavailable.map((agent) => ({
          label: formatAgentLabel(agent.entry),
          reasons: agent.reasons,
        })),
      }),
    );
  }
  return { selected };
}

async function promptForAgentSelection(options: {
  launchable: readonly LaunchableAgent[];
  unavailable: readonly UnavailableAgent[];
  prompt: RootLauncherWorkflow["prompt"];
  writeOutput: CommandOutputWriter;
}): Promise<LaunchableAgent> {
  const { launchable, unavailable, prompt, writeOutput } = options;
  writeLauncherScreen(
    writeOutput,
    renderRootLauncherSelectionScreen({
      launchable: launchable.map((agent) => ({
        label: formatAgentLabel(agent.entry),
      })),
      unavailable: unavailable.map((agent) => ({
        label: formatAgentLabel(agent.entry),
        reasons: agent.reasons,
      })),
    }),
  );

  for (;;) {
    const response = await prompt({ message: `[1-${launchable.length}]` });
    const parsed = Number.parseInt(response.trim(), 10);
    if (
      Number.isInteger(parsed) &&
      parsed >= 1 &&
      parsed <= launchable.length
    ) {
      return launchable[parsed - 1];
    }

    writeLauncherNotice(
      writeOutput,
      renderRootLauncherInvalidSelection(launchable.length),
    );
  }
}

async function prepareFirstPartyInteractiveSession(options: {
  root: string;
  selected: LaunchableAgent;
  prepareSession: (
    options: Parameters<typeof prepareNativeInteractiveSession>[0],
  ) => ReturnType<typeof prepareNativeInteractiveSession>;
  selfCliTarget?: VoratiqCliTarget;
  prompt?: string;
  promptForMcpInstall: RootLauncherWorkflow["confirm"];
}): Promise<PrepareNativeSessionResult> {
  const {
    root,
    selected,
    prepareSession,
    selfCliTarget,
    prompt,
    promptForMcpInstall,
  } = options;

  return await prepareSession({
    root,
    cwd: root,
    agentId: selected.entry.id,
    launchMode: "first-party",
    prompt,
    ...(selfCliTarget ? { voratiqCliTarget: selfCliTarget } : {}),
    promptForMcpInstall: async (promptOptions) =>
      await promptForMcpInstall({
        message: promptOptions.message,
        defaultValue: promptOptions.defaultValue,
        prefaceLines: promptOptions.prefaceLines,
      }),
  });
}

async function launchFirstPartyInteractiveSession(options: {
  selected: LaunchableAgent;
  prepared: PreparedInteractiveSession;
  spawnSession: (
    prepared: Parameters<typeof spawnPreparedInteractiveSession>[0],
    options: Parameters<typeof spawnPreparedInteractiveSession>[1],
  ) => ReturnType<typeof spawnPreparedInteractiveSession>;
  writeOutput: CommandOutputWriter;
}): Promise<StartedFirstPartySession> {
  const { selected, prepared, spawnSession, writeOutput } = options;
  writeLauncherNotice(
    writeOutput,
    renderRootLauncherLaunchStart(formatAgentLabel(selected.entry)),
    {
      leadingNewline: true,
    },
  );
  const launchResult = await spawnSession(prepared, { stdio: "inherit" });
  return { selected, launchResult };
}

function writeLauncherNotice(
  writeOutput: CommandOutputWriter,
  message: string,
  options: {
    leadingNewline?: boolean;
  } = {},
): void {
  writeOutput({
    alerts: [{ severity: "info", message: message.trimEnd() }],
    leadingNewline: options.leadingNewline ?? false,
  });
}

function writeLauncherScreen(
  writeOutput: CommandOutputWriter,
  message: string,
): void {
  writeOutput({
    body: message.trimEnd(),
    leadingNewline: false,
  });
}

async function finalizeLaunchResult(
  selected: LaunchableAgent,
  launchResult: SpawnPreparedSessionResult,
): Promise<void> {
  if (!launchResult.ok) {
    throw new CliError(
      `Failed to launch ${formatAgentLabel(selected.entry)}.`,
      [launchResult.failure.message],
    );
  }

  const completedRecord = await launchResult.completion;
  if (completedRecord.status === "failed") {
    process.exitCode = 1;
  }
}

function buildNoLaunchableAgentsError(
  unavailable: readonly UnavailableAgent[],
): CliError {
  const detailLines = [
    "Enabled agents with blocking issues:",
    ...unavailable.map(
      (agent) =>
        `  - ${formatAgentLabel(agent.entry)}: ${agent.reasons.join("; ")}`,
    ),
  ];

  return new CliError("No enabled agents can be launched.", detailLines, [
    "Fix the blocking agent configuration in `.voratiq/agents.yaml`, then retry.",
  ]);
}

function formatAgentLabel(
  agent: Pick<AgentConfigEntry, "id" | "provider" | "model">,
): string {
  return `${agent.id} (${agent.provider} / ${agent.model})`;
}

function resolveQaInitialPrompt(): string | undefined {
  const prompt = process.env.VORATIQ_QA_INITIAL_PROMPT?.trim();
  return prompt && prompt.length > 0 ? prompt : undefined;
}
