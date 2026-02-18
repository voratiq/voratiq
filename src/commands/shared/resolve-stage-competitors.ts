import {
  AgentDisabledError,
  AgentNotFoundError,
} from "../../configs/agents/errors.js";
import { readAgentsConfig } from "../../configs/agents/loader.js";
import { loadAgentById } from "../../configs/agents/loader.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import { loadOrchestrationConfig } from "../../configs/orchestration/loader.js";
import type {
  OrchestrationConfig,
  OrchestrationProfile,
  OrchestrationStageId,
} from "../../configs/orchestration/types.js";
import { HintedError } from "../../utils/errors.js";
import { readUtf8File } from "../../utils/fs.js";
import {
  formatWorkspacePath,
  resolveWorkspacePath,
  VORATIQ_AGENTS_FILE,
  VORATIQ_ORCHESTRATION_FILE,
} from "../../workspace/structure.js";

export interface ResolveStageCompetitorsInput {
  root: string;
  stageId: OrchestrationStageId;
  cliAgentIds?: readonly string[];
  cliOverrideFlag?: string;
  profileName?: string;
  profileFlag?: string;
  enforceSingleCompetitor?: boolean;
  includeDefinitions?: boolean;
}

export interface CompetitionPlan {
  source: "cli" | "orchestration";
  agentIds: readonly string[];
  competitors: readonly AgentDefinition[];
}

export type StageCompetitorResolution = CompetitionPlan;

const ORCHESTRATION_CONFIG_DISPLAY_PATH = formatWorkspacePath(
  VORATIQ_ORCHESTRATION_FILE,
);
const DEFAULT_PROFILE_NAME = "default";

export function resolveStageCompetitors(
  input: ResolveStageCompetitorsInput,
): CompetitionPlan {
  const {
    root,
    stageId,
    cliAgentIds,
    cliOverrideFlag = "--agent",
    profileName,
    profileFlag = "--profile",
    enforceSingleCompetitor = false,
    includeDefinitions = true,
  } = input;

  const normalizedCliAgentIds = normalizeAgentIds(cliAgentIds);
  assertNoDuplicateCliAgentIds(stageId, normalizedCliAgentIds, cliOverrideFlag);
  const source = normalizedCliAgentIds.length > 0 ? "cli" : "orchestration";
  const selectedProfileName =
    profileName === undefined ? DEFAULT_PROFILE_NAME : profileName.trim();
  let selectedProfile: OrchestrationProfile | undefined;

  if (source === "orchestration" || profileName !== undefined) {
    const orchestrationConfig = loadOrchestrationConfig({ root });
    selectedProfile = resolveOrchestrationProfile({
      config: orchestrationConfig,
      stageId,
      profileName: selectedProfileName,
      profileFlag,
    });
  }

  const resolvedAgentIds =
    source === "cli"
      ? normalizedCliAgentIds
      : (selectedProfile?.[stageId].agents.map((agent) => agent.id) ?? []);

  assertResolvedAgentCount({
    stageId,
    agentIds: resolvedAgentIds,
    cliOverrideFlag,
    selectedProfileName,
    enforceSingleCompetitor,
  });

  if (!includeDefinitions) {
    validateResolvedAgentIds({ root, agentIds: resolvedAgentIds });
  }

  const competitors = includeDefinitions
    ? resolvedAgentIds.map((agentId) => loadAgentById(agentId, { root }))
    : [];

  return {
    source,
    agentIds: [...resolvedAgentIds],
    competitors,
  };
}

function resolveOrchestrationProfile(options: {
  config: OrchestrationConfig;
  stageId: OrchestrationStageId;
  profileName: string;
  profileFlag: string;
}): OrchestrationProfile {
  const { config, stageId, profileName, profileFlag } = options;
  const selectedProfile = config.profiles[profileName];
  if (selectedProfile) {
    return selectedProfile;
  }

  const availableProfileNames = Object.keys(config.profiles).sort();
  const availableDisplay =
    availableProfileNames.length > 0
      ? availableProfileNames.join(", ")
      : "(none configured)";
  const fallbackProfile = availableProfileNames[0] ?? DEFAULT_PROFILE_NAME;

  throw new HintedError(`Unknown orchestration profile "${profileName}".`, {
    detailLines: [
      `Requested profile: "${profileName}".`,
      `Available profiles: ${availableDisplay}.`,
      `Config file: ${ORCHESTRATION_CONFIG_DISPLAY_PATH}.`,
    ],
    hintLines: [
      `Use ${profileFlag} <existing-profile> to select one of the configured profiles.`,
      `Update ${ORCHESTRATION_CONFIG_DISPLAY_PATH} to add profile "${profileName}".`,
      `Example: ${buildProfileSelectionExample(stageId, profileFlag, fallbackProfile)}`,
    ],
  });
}

function normalizeAgentIds(agentIds: readonly string[] | undefined): string[] {
  if (!agentIds || agentIds.length === 0) {
    return [];
  }

  return agentIds
    .map((agentId) => agentId.trim())
    .filter((agentId) => agentId.length > 0);
}

function assertNoDuplicateCliAgentIds(
  stageId: OrchestrationStageId,
  cliAgentIds: readonly string[],
  cliOverrideFlag: string,
): void {
  if (cliAgentIds.length < 2) {
    return;
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const agentId of cliAgentIds) {
    if (seen.has(agentId)) {
      duplicates.add(agentId);
      continue;
    }
    seen.add(agentId);
  }

  if (duplicates.size === 0) {
    return;
  }

  const duplicateList = Array.from(duplicates).join(", ");
  throw new HintedError(
    `Duplicate ${cliOverrideFlag} values are not allowed for stage "${stageId}".`,
    {
      detailLines: [`Duplicate agent ids: ${duplicateList}.`],
      hintLines: [
        `Pass each ${cliOverrideFlag} id at most once, preserving your intended order.`,
      ],
    },
  );
}

function validateResolvedAgentIds(options: {
  root: string;
  agentIds: readonly string[];
}): void {
  const { root, agentIds } = options;
  const agentsPath = resolveWorkspacePath(root, VORATIQ_AGENTS_FILE);
  const config = readAgentsConfig(readUtf8File(agentsPath, "utf8"));
  const entriesById = new Map(config.agents.map((entry) => [entry.id, entry]));
  const enabledAgentIds = config.agents
    .filter((entry) => entry.enabled !== false)
    .map((entry) => entry.id);

  for (const agentId of agentIds) {
    const entry = entriesById.get(agentId);
    if (!entry) {
      throw new AgentNotFoundError(agentId, enabledAgentIds);
    }
    if (entry.enabled === false) {
      throw new AgentDisabledError(agentId);
    }
  }
}

function assertResolvedAgentCount(options: {
  stageId: OrchestrationStageId;
  agentIds: readonly string[];
  cliOverrideFlag: string;
  selectedProfileName: string;
  enforceSingleCompetitor: boolean;
}): void {
  const {
    stageId,
    agentIds,
    cliOverrideFlag,
    selectedProfileName,
    enforceSingleCompetitor,
  } = options;
  const stageAgentsPath = `profiles.${selectedProfileName}.${stageId}.agents`;

  if (agentIds.length === 0) {
    const configInstruction = enforceSingleCompetitor
      ? `Configure exactly one agent under ${stageAgentsPath} in ${ORCHESTRATION_CONFIG_DISPLAY_PATH}.`
      : `Configure at least one agent under ${stageAgentsPath} in ${ORCHESTRATION_CONFIG_DISPLAY_PATH}.`;
    throw new HintedError(`No agent found for stage "${stageId}".`, {
      detailLines: [
        "Agents: (none).",
        `Checked ${stageAgentsPath} in ${ORCHESTRATION_CONFIG_DISPLAY_PATH}.`,
      ],
      hintLines: [
        `Provide ${cliOverrideFlag} <id> to run ${stageId} with an explicit agent.`,
        configInstruction,
      ],
    });
  }

  if (!enforceSingleCompetitor || agentIds.length === 1) {
    return;
  }

  throw new HintedError(`Multiple agents found for stage "${stageId}".`, {
    detailLines: [`Multi-agent ${stageId} is not supported.`],
    hintLines: [
      `Provide ${cliOverrideFlag} <id> to run ${stageId} with an explicit agent.`,
      `Configure exactly one agent under ${stageAgentsPath} in ${ORCHESTRATION_CONFIG_DISPLAY_PATH}.`,
    ],
  });
}

function buildProfileSelectionExample(
  stageId: OrchestrationStageId,
  profileFlag: string,
  profileName: string,
): string {
  const escapedProfile = JSON.stringify(profileName);
  switch (stageId) {
    case "run":
      return `voratiq run --spec <path> ${profileFlag} ${escapedProfile}`;
    case "review":
      return `voratiq review --run <run-id> ${profileFlag} ${escapedProfile}`;
    case "spec":
      return `voratiq spec --description <text> ${profileFlag} ${escapedProfile}`;
  }
}
