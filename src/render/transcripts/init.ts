import type { InitCommandResult } from "../../commands/init/types.js";
import { getAgentDefaultsForPreset } from "../../configs/agents/defaults.js";
import { colorize } from "../../utils/colors.js";
import {
  formatWorkspacePath,
  VORATIQ_VERIFICATION_CONFIG_FILE,
} from "../../workspace/structure.js";
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

interface RenderInitTranscriptOptions {
  includeConfigurationHeading?: boolean;
}

export function renderInitTranscript(
  {
    mode,
    syncRecommended,
    preset,
    agentSummary,
    orchestrationSummary,
    environmentSummary,
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
      verificationPath: formatWorkspacePath(VORATIQ_VERIFICATION_CONFIG_FILE),
      environmentPath: environmentSummary.configPath,
      sandboxPath: sandboxSummary.configPath,
    }),
  );
  const conditionalNote = resolveConditionalInitNote({
    mode,
    syncRecommended,
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
  verificationPath: string;
  environmentPath: string;
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
      { configuration: "verification", path: paths.verificationPath },
      { configuration: "environment", path: paths.environmentPath },
      { configuration: "sandbox", path: paths.sandboxPath },
    ],
  });
}

function buildWorkspaceInitializedSection(): string {
  return colorize("Voratiq initialized.", "green");
}

interface ConditionalInitNoteOptions {
  mode: InitCommandResult["mode"];
  syncRecommended: boolean;
  preset: InitCommandResult["preset"];
  agentSummary: InitCommandResult["agentSummary"];
}

function resolveConditionalInitNote({
  mode,
  syncRecommended,
  preset,
  agentSummary,
}: ConditionalInitNoteOptions): string | undefined {
  if (mode === "repair" || syncRecommended) {
    return "Workspace already exists. `voratiq init` repaired missing structure only. Run `voratiq sync` to rescan providers and reconcile managed config.";
  }

  if (agentSummary.zeroDetections) {
    return "No agent CLIs detected on PATH. Install providers, then run `voratiq sync`.";
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
      return "Some providers not found on PATH. Only detected providers were configured. Install missing ones, then run `voratiq sync`.";
    }
  }

  return undefined;
}
