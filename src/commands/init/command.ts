import { writeCommandPreface } from "../../cli/output.js";
import { buildInitializationPrompt } from "../../render/transcripts/init.js";
import {
  normalizeConfigText,
  readConfigSnapshot,
  writeConfigIfChanged,
} from "../../utils/yaml.js";
import { createWorkspace } from "../../workspace/setup.js";
import {
  formatWorkspacePath,
  resolveWorkspacePath,
  VORATIQ_AGENTS_FILE,
  VORATIQ_SANDBOX_FILE,
} from "../../workspace/structure.js";
import {
  type AgentPreset,
  listAgentPresetTemplates,
} from "../../workspace/templates.js";
import type { CreateWorkspaceResult } from "../../workspace/types.js";
import { configureAgents } from "./agents.js";
import { configureEnvironment } from "./environment.js";
import { configureEvals } from "./evals.js";
import type {
  InitCommandInput,
  InitCommandResult,
  SandboxInitSummary,
} from "./types.js";

export async function executeInitCommand(
  input: InitCommandInput,
): Promise<InitCommandResult> {
  const { root, preset, interactive, confirm, prompt } = input;

  const workspaceResult = await createWorkspace(root);
  await applyAgentPresetTemplate(root, preset);

  const initializationPrompt = buildInitializationPrompt();
  writeCommandPreface(initializationPrompt);

  const agentSummary = await configureAgents(root, preset, {
    interactive,
    confirm,
  });

  const environmentSummary = await configureEnvironment(root, {
    interactive,
    confirm,
    prompt,
  });

  const evalSummary = await configureEvals(
    root,
    {
      interactive,
      confirm,
    },
    environmentSummary.config,
  );

  const sandboxSummary = buildSandboxSummary(workspaceResult);

  return {
    workspaceResult,
    agentSummary,
    environmentSummary,
    evalSummary,
    sandboxSummary,
  };
}

function buildSandboxSummary(
  workspaceResult: CreateWorkspaceResult,
): SandboxInitSummary {
  const configPath = formatWorkspacePath(VORATIQ_SANDBOX_FILE);
  const normalizedCreated = workspaceResult.createdFiles.map((file) =>
    file.replace(/\\/g, "/"),
  );
  const configCreated = normalizedCreated.includes(configPath);
  return { configPath, configCreated };
}

async function applyAgentPresetTemplate(
  root: string,
  preset: AgentPreset,
): Promise<void> {
  const filePath = resolveWorkspacePath(root, VORATIQ_AGENTS_FILE);
  const snapshot = await readConfigSnapshot(filePath);
  const knownTemplates = listAgentPresetTemplates();
  const knownNormalized = new Set(
    knownTemplates.map((descriptor) =>
      normalizeConfigText(descriptor.template),
    ),
  );
  const canApply = !snapshot.exists || knownNormalized.has(snapshot.normalized);
  if (!canApply) {
    return;
  }

  const selected = knownTemplates.find(
    (descriptor) => descriptor.preset === preset,
  );
  if (!selected) {
    return;
  }

  const baseline = snapshot.exists ? snapshot.normalized : "__missing__";
  await writeConfigIfChanged(filePath, selected.template, baseline);
}
