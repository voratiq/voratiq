import { rm } from "node:fs/promises";

import { resolveAuthProvider } from "../../auth/providers/index.js";
import type {
  AuthProvider,
  AuthRuntimeContext,
} from "../../auth/providers/types.js";
import { buildAuthRuntimeContext } from "../../auth/runtime.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import { toErrorMessage } from "../../utils/errors.js";
import { isFileSystemError } from "../../utils/fs.js";
import {
  AuthProviderStageError,
  AuthProviderVerificationError,
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

export async function verifyAgentProviders(
  agents: readonly AgentDefinition[],
): Promise<void> {
  if (agents.length === 0) {
    return;
  }

  // Ensure platform and runtime dependencies are present.
  checkPlatformSupport();
  await getRunCommand();

  const runtime = buildAuthRuntimeContext();

  for (const agent of agents) {
    const provider = resolveAgentProvider(agent);
    try {
      await provider.verify({
        agentId: agent.id,
        runtime,
      });
    } catch (error) {
      throw new AuthProviderVerificationError(
        extractAuthProviderMessage(error),
      );
    }
  }
}

export async function stageAgentAuth(
  options: StageAuthOptions,
): Promise<StageAuthResult> {
  const { agent, agentRoot, runId, root } = options;
  const provider = resolveAgentProvider(agent);
  const runtime = options.runtime ?? buildAuthRuntimeContext();

  try {
    const stageResult = await provider.stage({
      agentId: agent.id,
      agentRoot,
      runtime,
      runId: runId ?? "runtime",
      root,
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
