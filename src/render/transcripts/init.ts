import type {
  AgentInitSummary,
  EnvironmentInitSummary,
  EvalInitSummary,
  InitCommandResult,
  SandboxInitSummary,
} from "../../commands/init/types.js";
import type { EvalSlug } from "../../configs/evals/types.js";
import { colorize } from "../../utils/colors.js";
import { renderBlocks, renderTranscript } from "../utils/transcript.js";

export function buildInitializationPrompt(): string {
  return "Initializing Voratiq…";
}

interface AgentPromptRenderOptions {
  agentId: string;
  binaryPath?: string;
  detected: boolean;
  firstPrompt: boolean;
}

export function renderAgentPromptPreface({
  agentId,
  binaryPath,
  detected,
  firstPrompt,
}: AgentPromptRenderOptions): string[] {
  const sections: string[][] = [];
  if (firstPrompt) {
    sections.push(["Configuring agents…"]);
  }

  if (detected && binaryPath) {
    sections.push([`\`${agentId}\` binary detected: \`${binaryPath}\``]);
  } else {
    sections.push([`\`${agentId}\` binary not detected. Keeping disabled.`]);
  }

  return renderBlocks({
    sections,
    leadingBlankLine: firstPrompt,
  });
}

interface EvalCommandPromptRenderOptions {
  commandName: EvalSlug;
  commandText: string;
  firstPrompt: boolean;
}

export function renderEvalCommandPreface({
  commandName,
  commandText,
  firstPrompt,
}: EvalCommandPromptRenderOptions): string[] {
  const sections: string[][] = [];
  if (firstPrompt) {
    sections.push(["Configuring evals…"]);
  }

  sections.push([`\`${commandName}\` command detected: \`${commandText}\``]);

  return renderBlocks({
    sections,
    leadingBlankLine: firstPrompt,
  });
}

export function renderInitTranscript({
  agentSummary,
  environmentSummary,
  evalSummary,
  sandboxSummary,
}: InitCommandResult): string {
  const sections: string[][] = [];

  sections.push(buildAgentsSection(agentSummary));
  sections.push(buildEnvironmentSection(environmentSummary));
  sections.push(buildEvalsSection(evalSummary));
  sections.push(buildSandboxSection(sandboxSummary));
  sections.push([buildWorkspaceInitializedSection()]);

  return renderTranscript({
    sections,
    hint: {
      message: "To begin a run:\n  voratiq run --spec <path>",
    },
  });
}

function buildAgentsSection(summary: AgentInitSummary): string[] {
  const lines: string[] = [];

  if (summary.zeroDetections && summary.enabledAgents.length === 0) {
    lines.push("No agents configured, unable to find agent binaries.");
    lines.push(
      `To modify agent setup manually, edit \`${summary.configPath}\`.`,
    );
    return lines;
  }

  lines.push(`Agents configured (${formatEnabled(summary.enabledAgents)}).`);
  lines.push(`To modify, edit \`${summary.configPath}\`.`);
  return lines;
}

function buildEnvironmentSection(summary: EnvironmentInitSummary): string[] {
  const lines: string[] = [];

  const details =
    summary.detectedEntries.length > 0
      ? summary.detectedEntries.join(", ")
      : "none";

  lines.push(`Environment configured (${details}).`);
  lines.push(`To modify, edit \`${summary.configPath}\`.`);
  return lines;
}

function buildEvalsSection(summary: EvalInitSummary): string[] {
  const lines: string[] = [];

  if (summary.configuredEvals.length === 0) {
    lines.push("No evals configured, unable to detect project tooling yet.");
    lines.push(
      `To modify eval setup manually, edit \`${summary.configPath}\`.`,
    );
    return lines;
  }

  lines.push(`Evals configured (${formatEnabled(summary.configuredEvals)}).`);
  lines.push(`To modify, edit \`${summary.configPath}\`.`);
  return lines;
}

function buildSandboxSection(summary: SandboxInitSummary): string[] {
  return ["Sandbox configured.", `To modify, edit \`${summary.configPath}\`.`];
}

function buildWorkspaceInitializedSection(): string {
  return colorize("Voratiq initialized.", "green");
}

function formatEnabled(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}
