import type { InitCommandResult } from "../../commands/init/types.js";
import { getAgentDefaultsForPreset } from "../../configs/agents/defaults.js";
import type { EvalSlug } from "../../configs/evals/types.js";
import { colorize } from "../../utils/colors.js";
import { renderTable } from "../utils/table.js";
import { renderBlocks, renderTranscript } from "../utils/transcript.js";
import { wrapWords } from "../utils/wrap.js";

const INIT_NOTE_MAX_WIDTH = 79;

export function renderPresetPromptPreface(firstPrompt: boolean): string[] {
  const sections: string[][] = [
    [
      "Which workspace preset would you like?",
      "  [1] Pro (flagship)",
      "  [2] Lite (faster/cheaper)",
      "  [3] Manual (configure yourself)",
    ],
  ];

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

interface RenderInitTranscriptOptions {
  includeConfigurationHeading?: boolean;
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

export function renderInitTranscript(
  {
    preset,
    agentSummary,
    orchestrationSummary,
    environmentSummary,
    evalSummary,
    sandboxSummary,
  }: InitCommandResult,
  options: RenderInitTranscriptOptions = {},
): string {
  const { includeConfigurationHeading = true } = options;
  const sections: string[][] = [];

  if (includeConfigurationHeading) {
    sections.push(["Configuring workspace…"]);
  }
  sections.push(
    buildConfigurationSummaryTable({
      orchestrationPath: orchestrationSummary.configPath,
      agentsPath: agentSummary.configPath,
      environmentPath: environmentSummary.configPath,
      evalsPath: evalSummary.configPath,
      sandboxPath: sandboxSummary.configPath,
    }),
  );
  const conditionalNote = resolveConditionalInitNote({
    preset,
    agentSummary,
  });
  if (conditionalNote) {
    sections.push(
      wrapWords(conditionalNote, INIT_NOTE_MAX_WIDTH).map((line) =>
        colorize(line, "yellow"),
      ),
    );
  }
  sections.push([
    "Configuration docs:",
    "  https://github.com/voratiq/voratiq/tree/main/docs/configs",
  ]);
  sections.push([buildWorkspaceInitializedSection()]);
  sections.push(["Run end-to-end:", '  voratiq auto --description "<task>"']);

  return renderTranscript({ sections });
}

function buildConfigurationSummaryTable(paths: {
  orchestrationPath: string;
  agentsPath: string;
  environmentPath: string;
  evalsPath: string;
  sandboxPath: string;
}): string[] {
  return renderTable({
    columns: [
      { header: "CONFIGURATION", accessor: (row) => row.configuration },
      { header: "FILE", accessor: (row) => row.path },
    ],
    rows: [
      { configuration: "agents", path: paths.agentsPath },
      { configuration: "orchestration", path: paths.orchestrationPath },
      { configuration: "environment", path: paths.environmentPath },
      { configuration: "evals", path: paths.evalsPath },
      { configuration: "sandbox", path: paths.sandboxPath },
    ],
  });
}

function buildWorkspaceInitializedSection(): string {
  return colorize("Voratiq initialized.", "green");
}

interface ConditionalInitNoteOptions {
  preset: InitCommandResult["preset"];
  agentSummary: InitCommandResult["agentSummary"];
}

function resolveConditionalInitNote({
  preset,
  agentSummary,
}: ConditionalInitNoteOptions): string | undefined {
  if (agentSummary.zeroDetections) {
    return "No agent CLIs detected on PATH. Install providers, then update `agents.yaml`.";
  }

  if (preset === "manual") {
    return "Manual preset leaves stages empty. Add agents to `orchestration.yaml`.";
  }

  const presetProviders = new Set(
    getAgentDefaultsForPreset(preset).map(
      (agentDefault) => agentDefault.provider,
    ),
  );
  const detectedProviders = new Set(
    agentSummary.detectedProviders.map((summary) => summary.provider),
  );
  for (const presetProvider of presetProviders) {
    if (!detectedProviders.has(presetProvider)) {
      return "Some providers not found on PATH. Only detected providers were configured. Install missing ones, then update `agents.yaml`.";
    }
  }

  return undefined;
}
