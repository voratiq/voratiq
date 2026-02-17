import {
  AgentDisabledError,
  AgentNotFoundError,
} from "../../configs/agents/errors.js";
import { readAgentsConfig } from "../../configs/agents/loader.js";
import { loadAgentById } from "../../configs/agents/loader.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import { loadOrchestrationConfig } from "../../configs/orchestration/loader.js";
import type { OrchestrationStageId } from "../../configs/orchestration/types.js";
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

export function resolveStageCompetitors(
  input: ResolveStageCompetitorsInput,
): CompetitionPlan {
  const {
    root,
    stageId,
    cliAgentIds,
    cliOverrideFlag = "--agent",
    enforceSingleCompetitor = false,
    includeDefinitions = true,
  } = input;

  const normalizedCliAgentIds = normalizeAgentIds(cliAgentIds);
  assertNoDuplicateCliAgentIds(stageId, normalizedCliAgentIds, cliOverrideFlag);
  const source = normalizedCliAgentIds.length > 0 ? "cli" : "orchestration";
  const resolvedAgentIds =
    source === "cli"
      ? normalizedCliAgentIds
      : loadOrchestrationConfig({ root }).profiles.default[stageId].agents.map(
          (agent) => agent.id,
        );

  assertResolvedAgentCount({
    stageId,
    agentIds: resolvedAgentIds,
    cliOverrideFlag,
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
  enforceSingleCompetitor: boolean;
}): void {
  const { stageId, agentIds, cliOverrideFlag, enforceSingleCompetitor } =
    options;
  const stageAgentsPath = `profiles.default.${stageId}.agents`;

  if (agentIds.length === 0) {
    const configInstruction = enforceSingleCompetitor
      ? `Configure exactly one agent under ${stageAgentsPath} in ${ORCHESTRATION_CONFIG_DISPLAY_PATH}.`
      : `Configure at least one agent under ${stageAgentsPath} in ${ORCHESTRATION_CONFIG_DISPLAY_PATH}.`;
    throw new HintedError(`No agent resolved for stage "${stageId}".`, {
      detailLines: [
        "Resolved agents: (none).",
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

  throw new HintedError(`Multiple agents resolved for stage "${stageId}".`, {
    detailLines: [`Multi-agent ${stageId} is not supported.`],
    hintLines: [
      `Provide ${cliOverrideFlag} <id> to run ${stageId} with an explicit agent.`,
      `Configure exactly one agent in \`${ORCHESTRATION_CONFIG_DISPLAY_PATH}\`.`,
    ],
  });
}
