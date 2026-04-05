import { resolveAuthProvider } from "../../auth/providers/index.js";
import type { AuthRuntimeContext } from "../../auth/providers/types.js";
import { buildAuthRuntimeContext } from "../../auth/runtime.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import {
  extractProviderErrorMessage,
  ProviderResolutionError,
  stageAgentProviderState,
  type StagedProviderStateContext,
  teardownProviderState,
} from "../launch/provider-state.js";
import {
  AuthProviderStageError,
  MissingAgentProviderError,
  UnknownAuthProviderError,
} from "./errors.js";
import { getRunCommand } from "./launcher.js";
import { checkPlatformSupport } from "./sandbox.js";

export interface StagedAuthContext {
  provider: StagedProviderStateContext["provider"];
  sandboxPath: StagedProviderStateContext["sandboxPath"];
  runtime: StagedProviderStateContext["runtime"];
  agentId: StagedProviderStateContext["agentId"];
}

export interface StageAuthOptions {
  agent: AgentDefinition;
  agentRoot: string;
  root: string;
  runId?: string;
  runtime?: AuthRuntimeContext;
}

export interface StageAuthResult {
  env: Record<string, string>;
  context: StagedAuthContext;
}

export interface AgentProviderPreflightIssue {
  readonly agentId: string;
  readonly message: string;
}

export async function verifyAgentProviders(
  agents: readonly Pick<AgentDefinition, "id" | "provider">[],
): Promise<readonly AgentProviderPreflightIssue[]> {
  if (agents.length === 0) {
    return [];
  }

  // Ensure platform and runtime dependencies are present.
  checkPlatformSupport();
  await getRunCommand();

  const runtime = buildAuthRuntimeContext();

  const issues: AgentProviderPreflightIssue[] = [];
  for (const agent of agents) {
    const providerId = agent.provider?.trim();
    if (!providerId) {
      issues.push({ agentId: agent.id, message: "missing `provider`" });
      continue;
    }

    const provider = resolveAuthProvider(providerId);
    if (!provider) {
      issues.push({
        agentId: agent.id,
        message: `unknown auth provider \`${providerId}\``,
      });
      continue;
    }

    try {
      await provider.verify({ agentId: agent.id, runtime });
    } catch (error) {
      pushIssueLines(issues, agent.id, extractAuthProviderMessage(error));
    }
  }

  return issues;
}

export async function stageAgentAuth(
  options: StageAuthOptions,
): Promise<StageAuthResult> {
  try {
    return await stageAgentProviderState(options);
  } catch (error) {
    if (error instanceof ProviderResolutionError) {
      if (error.code === "missing_provider") {
        throw new MissingAgentProviderError(options.agent.id);
      }
      const providerId = options.agent.provider?.trim() ?? "";
      throw new UnknownAuthProviderError(providerId);
    }
    throw new AuthProviderStageError(extractAuthProviderMessage(error));
  }
}

export async function teardownAuthContext(
  context: StagedAuthContext | undefined,
): Promise<void> {
  await teardownProviderState(context);
}

function extractAuthProviderMessage(error: unknown): string {
  return extractProviderErrorMessage(error);
}

function pushIssueLines(
  issues: AgentProviderPreflightIssue[],
  agentId: string,
  message: string,
): void {
  const lines = message
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    issues.push({ agentId, message: "unknown error" });
    return;
  }
  for (const line of lines) {
    issues.push({ agentId, message: line });
  }
}
