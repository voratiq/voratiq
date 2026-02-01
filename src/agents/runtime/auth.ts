import { rm } from "node:fs/promises";

import { resolveAuthProvider } from "../../auth/providers/index.js";
import type {
  AuthProvider,
  AuthRuntimeContext,
} from "../../auth/providers/types.js";
import { buildAuthRuntimeContext } from "../../auth/runtime.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import { loadRepoSettings } from "../../configs/settings/loader.js";
import { toErrorMessage } from "../../utils/errors.js";
import { isFileSystemError } from "../../utils/fs.js";
import {
  AuthProviderStageError,
  MissingAgentProviderError,
  UnknownAuthProviderError,
} from "./errors.js";
import { getRunCommand } from "./launcher.js";
import { checkPlatformSupport } from "./sandbox.js";

export interface StagedAuthContext {
  provider: AuthProvider;
  sandboxPath: string;
  runtime: AuthRuntimeContext;
  agentId: string;
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
      issues.push({ agentId: agent.id, message: "missing provider" });
      continue;
    }

    const provider = resolveAuthProvider(providerId);
    if (!provider) {
      issues.push({
        agentId: agent.id,
        message: `unknown auth provider "${providerId}"`,
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
  const { agent, agentRoot, runId, root } = options;
  const provider = resolveAgentProvider(agent);
  const runtime = options.runtime ?? buildAuthRuntimeContext();

  const includeConfigToml = shouldIncludeCodexConfigToml(root);

  try {
    const stageResult = await provider.stage({
      agentId: agent.id,
      agentRoot,
      runtime,
      runId: runId ?? "runtime",
      root,
      includeConfigToml,
    });
    return {
      env: stageResult.env,
      context: {
        provider,
        sandboxPath: stageResult.sandboxPath,
        runtime,
        agentId: agent.id,
      },
    };
  } catch (error) {
    throw new AuthProviderStageError(extractAuthProviderMessage(error));
  }
}

export async function teardownAuthContext(
  context: StagedAuthContext | undefined,
): Promise<void> {
  if (!context) {
    return;
  }

  if (tornDownContexts.has(context)) {
    return;
  }

  tornDownContexts.add(context);

  try {
    if (context.provider.teardown) {
      try {
        await context.provider.teardown({
          sandboxPath: context.sandboxPath,
        });
      } catch (error) {
        if (!isIgnorableTeardownError(error)) {
          throw error;
        }
      }
    }

    await rm(context.sandboxPath, { recursive: true, force: true });
  } catch (error) {
    tornDownContexts.delete(context);
    throw error;
  }
}

const tornDownContexts = new WeakSet<StagedAuthContext>();

function shouldIncludeCodexConfigToml(root: string): boolean {
  const settings = loadRepoSettings({ root });
  return settings.codex.globalConfigPolicy !== "ignore";
}

function isIgnorableTeardownError(error: unknown): boolean {
  if (!isFileSystemError(error)) {
    return false;
  }
  return error.code === "ENOENT";
}

function resolveAgentProvider(agent: AgentDefinition): AuthProvider {
  const providerId = agent.provider;
  if (!providerId) {
    throw new MissingAgentProviderError(agent.id);
  }
  const provider = resolveAuthProvider(providerId);
  if (!provider) {
    throw new UnknownAuthProviderError(providerId);
  }
  return provider;
}

function extractAuthProviderMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return toErrorMessage(error);
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
