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

export interface StagedProviderStateContext {
  provider: AuthProvider;
  sandboxPath: string;
  runtime: AuthRuntimeContext;
  agentId: string;
}

export interface StageProviderStateOptions {
  agent: AgentDefinition;
  agentRoot: string;
  root: string;
  runId?: string;
  runtime?: AuthRuntimeContext;
  includeConfigToml?: boolean;
}

export interface StageProviderStateResult {
  env: Record<string, string>;
  context: StagedProviderStateContext;
}

export type AgentProviderResolutionCode =
  | "missing_provider"
  | "unknown_provider";

export interface AgentProviderResolutionFailure {
  ok: false;
  code: AgentProviderResolutionCode;
  message: string;
}

export interface AgentProviderResolutionSuccess {
  ok: true;
  provider: AuthProvider;
}

export type AgentProviderResolutionResult =
  | AgentProviderResolutionFailure
  | AgentProviderResolutionSuccess;

export function resolveAgentProviderForDefinition(
  agent: Pick<AgentDefinition, "id" | "provider">,
): AgentProviderResolutionResult {
  const providerId = agent.provider?.trim();
  if (!providerId) {
    return {
      ok: false,
      code: "missing_provider",
      message: `Agent \`${agent.id}\` is missing a provider.`,
    };
  }

  const provider = resolveAuthProvider(providerId);
  if (!provider) {
    return {
      ok: false,
      code: "unknown_provider",
      message: `Unknown auth provider \`${providerId}\`.`,
    };
  }

  return { ok: true, provider };
}

export async function stageAgentProviderState(
  options: StageProviderStateOptions,
): Promise<StageProviderStateResult> {
  const runtime = options.runtime ?? buildAuthRuntimeContext();
  const resolution = resolveAgentProviderForDefinition(options.agent);
  if (!resolution.ok) {
    throw new ProviderResolutionError(resolution.code, resolution.message);
  }

  const includeConfigToml =
    options.includeConfigToml ?? shouldIncludeCodexConfigToml(options.root);

  const stageResult = await resolution.provider.stage({
    agentId: options.agent.id,
    agentRoot: options.agentRoot,
    runtime,
    runId: options.runId ?? "runtime",
    root: options.root,
    includeConfigToml,
  });

  return {
    env: stageResult.env,
    context: {
      provider: resolution.provider,
      sandboxPath: stageResult.sandboxPath,
      runtime,
      agentId: options.agent.id,
    },
  };
}

export async function teardownProviderState(
  context: StagedProviderStateContext | undefined,
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

export function extractProviderErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return toErrorMessage(error);
}

const tornDownContexts = new WeakSet<StagedProviderStateContext>();

function shouldIncludeCodexConfigToml(root: string): boolean {
  const settings = loadRepoSettings({ root });
  return settings.bounded.codex.globalConfigPolicy !== "ignore";
}

function isIgnorableTeardownError(error: unknown): boolean {
  if (!isFileSystemError(error)) {
    return false;
  }
  return error.code === "ENOENT";
}

export class ProviderResolutionError extends Error {
  constructor(
    public readonly code: AgentProviderResolutionCode,
    message: string,
  ) {
    super(message);
    this.name = "ProviderResolutionError";
  }
}
