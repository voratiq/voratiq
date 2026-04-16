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
  VORATIQ_AGENTS_FILE,
  VORATIQ_ORCHESTRATION_FILE,
} from "../../workspace/constants.js";
import { resolveWorkspacePath } from "../../workspace/path-resolvers.js";

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

const ORCHESTRATION_CONFIG_DISPLAY_PATH = VORATIQ_ORCHESTRATION_FILE;
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
      profileName: selectedProfileName,
      profileFlag,
    });
  }

  const resolvedAgentIds =
    source === "cli"
      ? normalizedCliAgentIds
      : getProfileAgentIds(selectedProfile, stageId);

  assertResolvedAgentCount({
    stageId,
    agentIds: resolvedAgentIds,
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
  profileName: string;
  profileFlag: string;
}): OrchestrationProfile {
  const { config, profileName, profileFlag } = options;
  const selectedProfile = config.profiles[profileName];
  if (selectedProfile) {
    return selectedProfile;
  }

  const availableProfileNames = Object.keys(config.profiles).sort();
  const availableDisplay = availableProfileNames.map((name) => `\`${name}\``);

  throw new HintedError(`Unknown orchestration profile \`${profileName}\`.`, {
    detailLines:
      availableDisplay.length > 0
        ? [`Available profiles: ${availableDisplay.join(", ")}.`]
        : [],
    hintLines: [
      `Review \`${profileFlag}\` and update \`${ORCHESTRATION_CONFIG_DISPLAY_PATH}\` if needed.`,
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

  const duplicateList = Array.from(duplicates)
    .sort((left, right) => left.localeCompare(right))
    .map((agentId) => `\`${agentId}\``)
    .join(", ");
  throw new HintedError(duplicateAgentHeadline(stageId, cliOverrideFlag), {
    detailLines: [`Duplicate agent ids: ${duplicateList}.`],
    hintLines: [`Pass each \`${cliOverrideFlag}\` value once.`],
  });
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
  selectedProfileName: string;
  enforceSingleCompetitor: boolean;
}): void {
  const { stageId, agentIds, selectedProfileName, enforceSingleCompetitor } =
    options;
  const stageAgentsPath = profileAgentPath(selectedProfileName, stageId);

  if (agentIds.length === 0) {
    const configInstruction = enforceSingleCompetitor
      ? `Configure exactly one agent under \`${stageAgentsPath}\` in \`${ORCHESTRATION_CONFIG_DISPLAY_PATH}\`.`
      : `Configure at least one agent under \`${stageAgentsPath}\` in \`${ORCHESTRATION_CONFIG_DISPLAY_PATH}\`.`;
    const overrideInstruction =
      enforceSingleCompetitor || stageId === "reduce"
        ? []
        : ["Or pass one or more `--agent` overrides."];
    throw new HintedError(missingAgentsHeadline(stageId), {
      detailLines:
        stageId === "reduce"
          ? []
          : [
              `Checked \`${stageAgentsPath}\` in \`${ORCHESTRATION_CONFIG_DISPLAY_PATH}\`.`,
            ],
      hintLines:
        stageId === "reduce"
          ? [configInstruction, "Or pass one or more `--agent` overrides."]
          : [configInstruction, ...overrideInstruction],
    });
  }

  if (!enforceSingleCompetitor || agentIds.length === 1) {
    return;
  }

  throw new HintedError(multipleAgentsHeadline(stageId), {
    detailLines: [`This command supports one agent for ${stageNoun(stageId)}.`],
    hintLines: [
      `Configure exactly one agent under \`${stageAgentsPath}\` in \`${ORCHESTRATION_CONFIG_DISPLAY_PATH}\`.`,
    ],
  });
}

function getProfileAgentIds(
  profile: OrchestrationProfile | undefined,
  stageId: OrchestrationStageId,
): string[] {
  if (!profile) {
    return [];
  }

  return profile[stageId].agents.map((agent) => agent.id);
}

function profileAgentPath(
  profileName: string,
  stageId: OrchestrationStageId,
): string {
  return `profiles.${profileName}.${stageId}.agents`;
}

function stageNoun(stageId: OrchestrationStageId): string {
  return stageId === "reduce" ? "reduce" : `stage \`${stageId}\``;
}

function duplicateAgentHeadline(
  stageId: OrchestrationStageId,
  cliOverrideFlag: string,
): string {
  return stageId === "reduce"
    ? `Duplicate \`${cliOverrideFlag}\` values for reduce.`
    : `Duplicate \`${cliOverrideFlag}\` values for stage \`${stageId}\`.`;
}

function missingAgentsHeadline(stageId: OrchestrationStageId): string {
  return stageId === "reduce"
    ? "No reducer agents configured."
    : `No agents configured for stage \`${stageId}\`.`;
}

function multipleAgentsHeadline(stageId: OrchestrationStageId): string {
  return stageId === "reduce"
    ? "Multiple agents configured for reduce."
    : `Multiple agents configured for stage \`${stageId}\`.`;
}
