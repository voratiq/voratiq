import { executeCompetitionWithAdapter } from "../../competition/command-adapter.js";
import type { ResolvedExtraContextFile } from "../../competition/shared/extra-context.js";
import { createTeardownController } from "../../competition/shared/teardown.js";
import { AgentNotFoundError } from "../../configs/agents/errors.js";
import {
  createSpecCompetitionAdapter,
  type SpecCompetitionExecution,
} from "../../domain/spec/competition/adapter.js";
import { createSpecRecordMutators } from "../../domain/spec/model/mutators.js";
import {
  deriveSpecStatusFromAgents,
  type SpecAgentEntry,
  type SpecRecord,
} from "../../domain/spec/model/types.js";
import {
  appendSpecRecord,
  flushSpecRecordBuffer,
} from "../../domain/spec/persistence/adapter.js";
import { buildPersistedExtraContextFields } from "../../extra-context/contract.js";
import { loadOperatorEnvironment } from "../../preflight/environment.js";
import { prepareConfiguredOperatorReadiness } from "../../preflight/operator.js";
import type { SpecProgressRenderer } from "../../render/transcripts/spec.js";
import { toErrorMessage } from "../../utils/errors.js";
import { getHeadRevision } from "../../utils/git.js";
import { emitSwarmSessionAcknowledgement } from "../../utils/swarm-session-ack.js";
import { resolveEffectiveMaxParallel } from "../shared/max-parallel.js";
import { resolveStageCompetitors } from "../shared/resolve-stage-competitors.js";
import { generateSessionId } from "../shared/session-id.js";
import {
  SpecAgentNotFoundError,
  SpecGenerationFailedError,
  SpecPreflightError,
} from "./errors.js";
import { finalizeActiveSpec, registerActiveSpec } from "./lifecycle.js";

export interface ExecuteSpecCommandInput {
  root: string;
  specsFilePath: string;
  description: string;
  agentIds?: readonly string[];
  profileName?: string;
  maxParallel?: number;
  title?: string;
  extraContextFiles?: readonly ResolvedExtraContextFile[];
  onStatus?: (message: string) => void;
  renderer?: SpecProgressRenderer;
}

export interface ExecuteSpecCommandResult {
  sessionId: string;
  status: string;
  record: SpecRecord;
  agents: readonly SpecAgentEntry[];
}

export async function executeSpecCommand(
  input: ExecuteSpecCommandInput,
): Promise<ExecuteSpecCommandResult> {
  const {
    root,
    specsFilePath,
    description,
    agentIds: cliAgentIds,
    profileName,
    maxParallel: requestedMaxParallel,
    title: providedTitle,
    extraContextFiles = [],
    onStatus,
    renderer,
  } = input;

  let resolvedAgentIds: readonly string[];
  try {
    const normalizedCliIds =
      cliAgentIds && cliAgentIds.length > 0 ? [...cliAgentIds] : undefined;
    const resolution = resolveStageCompetitors({
      root,
      stageId: "spec",
      cliAgentIds: normalizedCliIds,
      profileName,
      includeDefinitions: false,
    });
    resolvedAgentIds = resolution.agentIds;
    if (resolvedAgentIds.length === 0) {
      throw new SpecGenerationFailedError(["Spec agent resolution failed."]);
    }
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      throw new SpecAgentNotFoundError(error.agentId);
    }
    throw error;
  }
  const preflight = await prepareConfiguredOperatorReadiness({
    root,
    resolvedAgentIds,
    includeEnvironment: false,
  });
  if (preflight.issues.length > 0) {
    throw new SpecPreflightError(
      preflight.issues,
      preflight.preProviderIssueCount,
    );
  }
  const competitors = preflight.agents;
  const environment = loadOperatorEnvironment({ root });
  const effectiveMaxParallel = resolveEffectiveMaxParallel({
    competitorCount: competitors.length,
    requestedMaxParallel,
  });

  const specTitle =
    providedTitle && providedTitle.trim().length > 0
      ? providedTitle.trim()
      : undefined;

  const baseRevisionSha = await getHeadRevision(root);
  const sessionId = generateSessionId();
  const startedAt = new Date().toISOString();
  const createdAt = startedAt;

  const initialAgents: SpecAgentEntry[] = competitors.map((agent) => ({
    agentId: agent.id,
    status: "queued" as const,
  }));

  const record: SpecRecord = {
    sessionId,
    createdAt,
    startedAt,
    status: "running",
    baseRevisionSha,
    description,
    agents: initialAgents,
    ...buildPersistedExtraContextFields(extraContextFiles),
  };

  const teardown = createTeardownController(`spec \`${sessionId}\``);
  registerActiveSpec({
    root,
    specsFilePath,
    specId: sessionId,
    initialRecord: record,
    teardown,
  });

  try {
    await appendSpecRecord({
      root,
      specsFilePath,
      record,
    });
    await emitSwarmSessionAcknowledgement({
      operator: "spec",
      sessionId,
      status: "running",
    });
    const mutators = createSpecRecordMutators({
      root,
      specsFilePath,
      sessionId,
    });
    let currentAgents: SpecAgentEntry[] = [...initialAgents];

    onStatus?.("Generating specification…");
    renderer?.begin({
      sessionId,
      createdAt,
      startedAt,
      workspacePath: `.voratiq/spec/sessions/${sessionId}`,
      status: "running",
    });

    let executionResults: SpecCompetitionExecution[];

    try {
      const baseAdapter = createSpecCompetitionAdapter({
        root,
        sessionId,
        description,
        specTitle,
        environment,
        extraContextFiles,
        teardown,
      });
      executionResults = await executeCompetitionWithAdapter({
        candidates: [...competitors],
        maxParallel: effectiveMaxParallel,
        adapter: {
          ...baseAdapter,
          onPreparationFailure: async (result) => {
            const updatedRecord = await mutators.recordAgentSnapshot({
              agentId: result.agentId,
              status: "failed",
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              tokenUsage: result.tokenUsage,
              error: result.error ?? null,
            });
            currentAgents = [...updatedRecord.agents];
            const failedAgent = currentAgents.find(
              (agent) => agent.agentId === result.agentId,
            );
            renderer?.update({
              agentId: result.agentId,
              status: "failed",
              startedAt: failedAgent?.startedAt,
              completedAt: failedAgent?.completedAt,
              tokenUsage: result.tokenUsage,
              tokenUsageResult: result.tokenUsageResult,
            });
          },
          onCandidateRunning: async (prepared, index) => {
            await baseAdapter.onCandidateRunning?.(prepared, index);
            const updatedRecord = await mutators.recordAgentRunning({
              agentId: prepared.candidate.id,
            });
            currentAgents = [...updatedRecord.agents];
            const runningAgent = currentAgents.find(
              (agent) => agent.agentId === prepared.candidate.id,
            );
            renderer?.update({
              agentId: prepared.candidate.id,
              status: "running",
              startedAt: runningAgent?.startedAt,
            });
          },
          onCandidateCompleted: async (_prepared, result) => {
            const updatedRecord = await mutators.recordAgentSnapshot(
              toSpecAgentEntry(result),
            );
            currentAgents = [...updatedRecord.agents];
            const completedAgent = currentAgents.find(
              (agent) => agent.agentId === result.agentId,
            );
            renderer?.update({
              agentId: result.agentId,
              status: completedAgent?.status ?? result.status,
              startedAt: completedAgent?.startedAt,
              completedAt: completedAgent?.completedAt,
              tokenUsage: result.tokenUsage,
              tokenUsageResult: result.tokenUsageResult,
            });
          },
        },
      });
    } catch (error) {
      const detail = toErrorMessage(error);
      await mutators.completeSpec({
        status: "failed",
        error: detail,
      });
      renderer?.complete("failed");
      await flushSpecRecordBuffer({ specsFilePath, sessionId });
      throw new SpecGenerationFailedError([detail]);
    }

    const agentEntries = currentAgents.some(
      (agent) => agent.status === "succeeded" || agent.status === "failed",
    )
      ? currentAgents
      : mapExecutionResultsToSpecAgents(executionResults, startedAt);

    const sessionStatus = deriveSpecStatusFromAgents(
      agentEntries.map((a) => a.status),
    );

    const latestRecord = await mutators.completeSpec({
      status: sessionStatus,
      agents: agentEntries,
      error:
        sessionStatus === "failed"
          ? collectAgentErrors(agentEntries)
          : undefined,
    });

    await flushSpecRecordBuffer({ specsFilePath, sessionId });
    renderer?.complete(latestRecord.status, {
      startedAt: latestRecord.startedAt,
      completedAt: latestRecord.completedAt,
    });

    if (sessionStatus === "failed") {
      const errorDetails = agentEntries
        .filter((a) => a.error)
        .map((a) => `${a.agentId}: ${a.error}`);
      throw new SpecGenerationFailedError(
        errorDetails.length > 0
          ? errorDetails
          : ["All agents failed to generate a specification."],
      );
    }

    return {
      sessionId,
      status: latestRecord.status,
      record: latestRecord,
      agents: latestRecord.agents,
    };
  } finally {
    await finalizeActiveSpec(sessionId);
  }
}

function collectAgentErrors(agents: readonly SpecAgentEntry[]): string | null {
  const errors = agents
    .filter((a) => a.error)
    .map((a) => `${a.agentId}: ${a.error}`);
  return errors.length > 0 ? errors.join("; ") : null;
}

function mapExecutionResultsToSpecAgents(
  executionResults: readonly SpecCompetitionExecution[],
  startedAt: string,
): SpecAgentEntry[] {
  return executionResults.map((result): SpecAgentEntry => {
    const completedAt = new Date().toISOString();
    const base: Pick<SpecAgentEntry, "agentId" | "startedAt" | "completedAt"> =
      {
        agentId: result.agentId,
        startedAt,
        completedAt,
      };
    if (result.status === "succeeded") {
      return {
        ...base,
        status: "succeeded",
        outputPath: result.outputPath,
        dataPath: result.dataPath,
        contentHash: result.contentHash,
        tokenUsage: result.tokenUsage,
      };
    }
    return {
      ...base,
      status: "failed",
      tokenUsage: result.tokenUsage,
      error: result.error ?? null,
    };
  });
}

function toSpecAgentEntry(result: SpecCompetitionExecution): SpecAgentEntry {
  const completedAt = new Date().toISOString();
  if (result.status === "succeeded") {
    return {
      agentId: result.agentId,
      status: "succeeded",
      completedAt,
      outputPath: result.outputPath,
      dataPath: result.dataPath,
      contentHash: result.contentHash,
      tokenUsage: result.tokenUsage,
      error: null,
    };
  }

  return {
    agentId: result.agentId,
    status: "failed",
    completedAt,
    tokenUsage: result.tokenUsage,
    error: result.error ?? null,
  };
}
