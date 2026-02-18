import type { InitCommandResult } from "../../commands/init/types.js";
import { getAgentDefaultsForPreset } from "../../configs/agents/defaults.js";
import type { EvalSlug } from "../../configs/evals/types.js";
import { colorize } from "../../utils/colors.js";
import { renderTable } from "../utils/table.js";
import { renderBlocks, renderTranscript } from "../utils/transcript.js";
import { wrapWords } from "../utils/wrap.js";

const INIT_NOTE_MAX_WIDTH = 79;

export function buildInitializationPrompt(): string {
  return "Initializing Voratiq…";
}

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
    "To learn more about configuration:",
    "  https://github.com/voratiq/voratiq/tree/main/docs/configs",
  ]);
  sections.push([buildWorkspaceInitializedSection()]);
  sections.push([
    "To generate a spec:",
    '  voratiq spec --description "<what you want to build>" --agent <agent-id>',
  ]);

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
    return "No supported agent CLIs were detected, so no agents were added to the run stage. Verify provider CLI installs/PATH. Then update .voratiq/agents.yaml and .voratiq/orchestration.yaml.";
  }

  if (preset === "manual") {
    return "Manual preset creates empty orchestration stages. Decide what should run, then update .voratiq/orchestration.yaml.";
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
      return "Some preset providers were not detected, so only detected providers were added to the run stage. Verify installs/PATH for missing providers. Then update .voratiq/agents.yaml and .voratiq/orchestration.yaml.";
    }
  }

  return undefined;
}
