import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve as resolvePath } from "node:path";
import process from "node:process";

import {
  collectProviderArtifacts,
  prepareProviderArtifactCaptureContext,
} from "../agents/launch/chat.js";
import { writeStagedPrompt } from "../agents/launch/prompt.js";
import { resolveAgentProviderForDefinition } from "../agents/launch/provider-state.js";
import {
  clearActiveInteractive,
  finalizeActiveInteractive,
  registerActiveInteractive,
} from "../commands/interactive/lifecycle.js";
import {
  createTeardownController,
  runTeardown,
} from "../competition/shared/teardown.js";
import {
  AgentBinaryAccessError,
  AgentBinaryMissingError,
  AgentDisabledError,
  AgentNotFoundError,
} from "../configs/agents/errors.js";
import { loadAgentById } from "../configs/agents/loader.js";
import { resolveFirstPartyLaunchPrompt } from "../domain/interactive/prompt.js";
import { toErrorMessage } from "../utils/errors.js";
import { isMissing } from "../utils/fs.js";
import { generateSessionId } from "../utils/session-id.js";
import { normalizeInteractiveTerm } from "../utils/terminal.js";
import { resolveVoratiqCliTarget } from "../utils/voratiq-cli-target.js";
import {
  createBundledVoratiqToolDeclaration,
  prepareProviderNativeLaunch,
  resolveFirstPartyMcpStatus,
} from "./providers.js";
import {
  appendInteractiveSessionRecord,
  ensureInteractiveSessionDirectories,
  resolveInteractiveSessionPaths,
  rewriteInteractiveSessionRecord,
  toInteractiveSessionRelativePath,
} from "./records.js";
import type {
  InteractiveLaunchFailure,
  InteractiveLaunchFailureCode,
  InteractiveSessionChatRecord,
  InteractiveSessionRecord,
  PrepareAndSpawnNativeSessionResult,
  PreparedInteractiveSession,
  PrepareNativeSessionOptions,
  PrepareNativeSessionResult,
  SpawnPreparedSessionOptions,
  SpawnPreparedSessionResult,
  ToolAttachmentStatus,
} from "./types.js";

const { X_OK } = fsConstants;

interface ResolvedInteractiveAgentProvider {
  agent: ReturnType<typeof loadAgentById>;
  providerId: string;
}

function isFirstPartyProviderId(
  value: string,
): value is "codex" | "claude" | "gemini" {
  return value === "codex" || value === "claude" || value === "gemini";
}

export type ResolveInteractiveAgentProviderResult =
  | { ok: true; value: ResolvedInteractiveAgentProvider }
  | { ok: false; failure: InteractiveLaunchFailure };

export function resolveInteractiveAgentProvider(options: {
  root: string;
  agentId: string;
}): ResolveInteractiveAgentProviderResult {
  try {
    const agent = loadAgentById(options.agentId, { root: options.root });
    const resolution = resolveAgentProviderForDefinition(agent);
    if (!resolution.ok) {
      return {
        ok: false,
        failure: failure(
          "auth",
          "provider_resolution_failed",
          resolution.message,
        ),
      };
    }
    return {
      ok: true,
      value: {
        agent,
        providerId: agent.provider,
      },
    };
  } catch (error) {
    return {
      ok: false,
      failure: mapAgentResolutionError(error),
    };
  }
}

export async function prepareNativeInteractiveSession(
  options: PrepareNativeSessionOptions,
): Promise<PrepareNativeSessionResult> {
  const sessionId = options.sessionId ?? generateSessionId();
  const createdAt = new Date().toISOString();
  const paths = resolveInteractiveSessionPaths(options.root, sessionId);
  let agentIdForRecord = options.agentId;
  let recordInitialized = false;
  let toolAttachmentStatus: ToolAttachmentStatus =
    options.launchMode === "first-party"
      ? "not-requested"
      : (options.toolDeclarations?.length ?? 0) > 0
        ? "failed"
        : "not-requested";

  try {
    await ensureInteractiveSessionDirectories({
      sessionRoot: paths.sessionRoot,
      artifactsPath: paths.artifactsPath,
      runtimePath: paths.runtimePath,
    });
  } catch (error) {
    return {
      ok: false,
      sessionId,
      failure: failure(
        "manifest",
        "config_generation_failed",
        `Failed to create interactive session directories: ${toErrorMessage(error)}`,
        error,
      ),
    };
  }

  const fail = async (
    launchFailure: InteractiveLaunchFailure,
  ): Promise<PrepareNativeSessionResult> => {
    try {
      const record = buildBaseRecord({
        sessionId,
        createdAt,
        status: "failed",
        agentId: agentIdForRecord,
        toolAttachmentStatus,
        error: {
          code: launchFailure.code,
          message: launchFailure.message,
        },
      });
      if (!recordInitialized) {
        await appendInteractiveSessionRecord({
          root: options.root,
          record,
        });
      } else {
        await rewriteInteractiveSessionRecord({
          root: options.root,
          sessionId,
          mutate: () => record,
        });
      }
    } catch {
      // Preserve structured failure returns even if record persistence fails.
    }
    return { ok: false, sessionId, failure: launchFailure };
  };

  const resolved = resolveInteractiveAgentProvider({
    root: options.root,
    agentId: options.agentId,
  });
  if (!resolved.ok) {
    return await fail(resolved.failure);
  }

  const { agent, providerId } = resolved.value;
  agentIdForRecord = agent.id;

  let toolDeclarations = options.toolDeclarations ?? [];
  let prompt = options.prompt;
  let firstPartyMcpResolution:
    | Awaited<ReturnType<typeof resolveFirstPartyMcpStatus>>
    | undefined;
  if (options.launchMode === "first-party") {
    const cliTarget = options.voratiqCliTarget ?? resolveVoratiqCliTarget();
    toolDeclarations = [
      createBundledVoratiqToolDeclaration({
        command: cliTarget.command,
        argsPrefix: cliTarget.argsPrefix,
      }),
    ];
    if (isFirstPartyProviderId(providerId)) {
      try {
        firstPartyMcpResolution = await resolveFirstPartyMcpStatus({
          providerId,
          providerBinary: agent.binary,
          root: options.root,
          toolDeclarations,
          promptForMcpInstall: options.promptForMcpInstall,
          mcpCommandRunner: options.mcpCommandRunner,
        });
      } catch (error) {
        return await fail(
          failure(
            "manifest",
            "config_generation_failed",
            `Failed to configure bundled MCP tools: ${toErrorMessage(error)}`,
            error,
          ),
        );
      }
      toolAttachmentStatus = firstPartyMcpResolution.toolAttachmentStatus;
    } else {
      toolAttachmentStatus = "failed";
    }
    prompt = resolveFirstPartyLaunchPrompt(toolAttachmentStatus);
  }

  const cwd = await resolveInteractiveCwd({
    root: options.root,
    cwd: options.cwd,
  });
  if (!cwd.ok) {
    return await fail(cwd.failure);
  }

  let promptPath: string | undefined;
  if (prompt && prompt.trim().length > 0) {
    try {
      promptPath = await writeStagedPrompt({
        runtimePath: paths.runtimePath,
        prompt,
      });
    } catch (error) {
      return await fail(
        failure(
          "manifest",
          "config_generation_failed",
          `Failed to stage prompt text: ${toErrorMessage(error)}`,
          error,
        ),
      );
    }
  }

  let providerLaunch:
    | Awaited<ReturnType<typeof prepareProviderNativeLaunch>>
    | undefined;
  try {
    providerLaunch = await prepareProviderNativeLaunch({
      providerId,
      agent,
      root: options.root,
      toolDeclarations,
      prompt,
      launchMode: options.launchMode,
      firstPartyMcpResolution,
    });
  } catch (error) {
    return await fail(
      failure(
        "manifest",
        "config_generation_failed",
        `Failed to generate provider launch config: ${toErrorMessage(error)}`,
        error,
      ),
    );
  }

  toolAttachmentStatus = providerLaunch.toolAttachmentStatus;
  const invocationEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...providerLaunch.env,
    VORATIQ_INTERACTIVE_SESSION_ID: sessionId,
    VORATIQ_INTERACTIVE_SESSION_ROOT: paths.sessionRoot,
  };

  let artifactCaptureContext:
    | Awaited<ReturnType<typeof prepareProviderArtifactCaptureContext>>
    | undefined;
  if (providerLaunch.artifactCaptureSupported) {
    try {
      artifactCaptureContext = await prepareProviderArtifactCaptureContext({
        providerId,
        sessionRoot: paths.sessionRoot,
        searchEnv: invocationEnv,
      });
    } catch {
      artifactCaptureContext = undefined;
    }
  }

  const binary = await resolveLaunchBinary(agent.binary, invocationEnv);
  if (!binary.ok) {
    return await fail(binary.failure);
  }

  const prepared: PreparedInteractiveSession = {
    sessionId,
    createdAt,
    root: options.root,
    agent,
    providerId,
    sessionRoot: paths.sessionRoot,
    runtimePath: paths.runtimePath,
    artifactsPath: paths.artifactsPath,
    recordPath: paths.recordPath,
    indexPath: paths.indexPath,
    toolAttachmentStatus,
    invocation: {
      command: binary.path,
      args: [...providerLaunch.args],
      env: invocationEnv,
      cwd: cwd.path,
    },
    ...(promptPath ? { promptPath } : {}),
    artifactCaptureSupported: providerLaunch.artifactCaptureSupported,
    ...(artifactCaptureContext ? { artifactCaptureContext } : {}),
  };

  try {
    await appendInteractiveSessionRecord({
      root: prepared.root,
      record: buildBaseRecord({
        sessionId: prepared.sessionId,
        createdAt: prepared.createdAt,
        status: "running",
        agentId: prepared.agent.id,
        toolAttachmentStatus: prepared.toolAttachmentStatus,
      }),
    });
    recordInitialized = true;
  } catch (error) {
    return await fail(
      failure(
        "manifest",
        "config_generation_failed",
        `Failed to persist running session record: ${toErrorMessage(error)}`,
        error,
      ),
    );
  }

  return {
    ok: true,
    prepared,
  };
}

export async function spawnPreparedInteractiveSession(
  prepared: PreparedInteractiveSession,
  options: SpawnPreparedSessionOptions = {},
): Promise<SpawnPreparedSessionResult> {
  const teardown = createTeardownController(
    `interactive session \`${prepared.sessionId}\``,
  );
  teardown.addPath(prepared.runtimePath, "interactive runtime");
  const stdio = options.stdio ?? "inherit";

  if (stdio === "inherit") {
    process.stdout.write("\n");
  }

  const spawnEnv =
    stdio === "inherit"
      ? {
          ...prepared.invocation.env,
          TERM: normalizeInteractiveTerm(prepared.invocation.env),
        }
      : prepared.invocation.env;

  const child = spawn(prepared.invocation.command, prepared.invocation.args, {
    cwd: prepared.invocation.cwd,
    env: spawnEnv,
    stdio,
  });

  const completion = createProcessCompletionPromise(prepared, child);
  registerActiveInteractive({
    root: prepared.root,
    sessionId: prepared.sessionId,
    process: child,
    completion,
    teardown,
  });

  const spawnResult = await waitForSpawn(child);
  if (!spawnResult.ok) {
    const launchFailure = failure(
      "process",
      "process_spawn_failed",
      `Failed to spawn provider process: ${spawnResult.error.message}`,
      spawnResult.error,
    );
    try {
      await rewriteInteractiveSessionRecord({
        root: prepared.root,
        sessionId: prepared.sessionId,
        mutate: () =>
          buildBaseRecord({
            sessionId: prepared.sessionId,
            createdAt: prepared.createdAt,
            status: "failed",
            agentId: prepared.agent.id,
            toolAttachmentStatus: prepared.toolAttachmentStatus,
            error: {
              code: launchFailure.code,
              message: launchFailure.message,
            },
          }),
      });
    } catch {
      // Keep structured spawn failure return when persistence fails.
    } finally {
      clearActiveInteractive(prepared.sessionId);
      await runTeardown(teardown);
    }
    return {
      ok: false,
      sessionId: prepared.sessionId,
      failure: launchFailure,
    };
  }

  return {
    ok: true,
    prepared,
    process: child,
    pid: child.pid ?? -1,
    completion,
  };
}

export async function prepareAndSpawnNativeInteractiveSession(
  options: PrepareNativeSessionOptions & SpawnPreparedSessionOptions,
): Promise<PrepareAndSpawnNativeSessionResult> {
  const prepared = await prepareNativeInteractiveSession(options);
  if (!prepared.ok) {
    return prepared;
  }
  return await spawnPreparedInteractiveSession(prepared.prepared, options);
}

function createProcessCompletionPromise(
  prepared: PreparedInteractiveSession,
  child: ReturnType<typeof spawn>,
): Promise<InteractiveSessionRecord> {
  return new Promise<InteractiveSessionRecord>((resolve, reject) => {
    let finalized = false;
    let spawned = false;

    const finalize = async (options: {
      exitCode?: number | null;
      signal?: NodeJS.Signals | null;
      spawnError?: Error;
    }): Promise<void> => {
      if (finalized) {
        return;
      }
      finalized = true;

      const runtimeFailureMessage = options.spawnError
        ? `Failed during provider execution: ${options.spawnError.message}`
        : options.signal
          ? `Provider process terminated by signal ${options.signal}`
          : options.exitCode && options.exitCode !== 0
            ? `Provider process exited with code ${options.exitCode}`
            : undefined;
      const status = runtimeFailureMessage ? "failed" : "succeeded";

      const chat = await collectInteractiveArtifactsOnExit(prepared);
      const record = buildBaseRecord({
        sessionId: prepared.sessionId,
        createdAt: prepared.createdAt,
        status,
        agentId: prepared.agent.id,
        toolAttachmentStatus: prepared.toolAttachmentStatus,
        ...(chat ? { chat } : {}),
        ...(runtimeFailureMessage
          ? {
              error: {
                code: "provider_launch_failed" as const,
                message: runtimeFailureMessage,
              },
            }
          : {}),
      });

      try {
        const finalRecord = await rewriteInteractiveSessionRecord({
          root: prepared.root,
          sessionId: prepared.sessionId,
          mutate: (existing) =>
            existing.status === "running" ? record : existing,
        });
        resolve(finalRecord);
      } catch (error) {
        reject(
          error instanceof Error ? error : new Error(toErrorMessage(error)),
        );
      } finally {
        try {
          await finalizeActiveInteractive(prepared.sessionId);
        } catch (error) {
          console.error(
            `[voratiq] Failed to finalize interactive lifecycle for ${prepared.sessionId}: ${toErrorMessage(error)}`,
          );
        }
      }
    };

    child.once("spawn", () => {
      spawned = true;
    });
    child.once("error", (error) => {
      if (!spawned) {
        return;
      }
      void finalize({ spawnError: error });
    });
    child.once("exit", (exitCode, signal) => {
      spawned = true;
      void finalize({ exitCode, signal });
    });
  });
}

async function collectInteractiveArtifactsOnExit(
  prepared: PreparedInteractiveSession,
): Promise<InteractiveSessionChatRecord | undefined> {
  if (!prepared.artifactCaptureSupported) {
    return { captured: false };
  }

  const captured = await collectProviderArtifacts({
    providerId: prepared.providerId,
    sessionRoot: prepared.sessionRoot,
    captureContext: prepared.artifactCaptureContext,
  });

  if (captured.captured) {
    return {
      captured: true,
      format: captured.format,
      artifactPath: toInteractiveSessionRelativePath(
        prepared.root,
        captured.artifactPath,
      ),
    };
  }
  return {
    captured: false,
    ...(captured.error !== undefined
      ? { errorMessage: toErrorMessage(captured.error) }
      : {}),
  };
}

async function resolveInteractiveCwd(options: {
  root: string;
  cwd?: string;
}): Promise<
  { ok: true; path: string } | { ok: false; failure: InteractiveLaunchFailure }
> {
  const target =
    options.cwd === undefined
      ? options.root
      : isAbsolute(options.cwd)
        ? options.cwd
        : resolvePath(options.root, options.cwd);
  try {
    const details = await stat(target);
    if (!details.isDirectory()) {
      return {
        ok: false,
        failure: failure(
          "manifest",
          "config_generation_failed",
          `Launch working directory is not a directory: ${target}`,
        ),
      };
    }
    return { ok: true, path: target };
  } catch (error) {
    const message = isMissing(error)
      ? `Launch working directory does not exist: ${target}`
      : `Failed to inspect launch working directory \`${target}\`: ${toErrorMessage(error)}`;
    return {
      ok: false,
      failure: failure("manifest", "config_generation_failed", message, error),
    };
  }
}

async function resolveLaunchBinary(
  binary: string,
  env: NodeJS.ProcessEnv,
): Promise<
  { ok: true; path: string } | { ok: false; failure: InteractiveLaunchFailure }
> {
  const candidate = binary.trim();
  if (!candidate) {
    return {
      ok: false,
      failure: failure(
        "process",
        "binary_resolution_failed",
        "Agent binary path is empty.",
      ),
    };
  }

  if (candidate.includes("/") || isAbsolute(candidate)) {
    try {
      await access(candidate, X_OK);
      return { ok: true, path: candidate };
    } catch (error) {
      return {
        ok: false,
        failure: failure(
          "process",
          "binary_resolution_failed",
          `Provider binary is not executable: ${candidate}`,
          error,
        ),
      };
    }
  }

  const pathEntries = (env.PATH ?? process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => entry.length > 0);
  for (const entry of pathEntries) {
    const path = join(entry, candidate);
    try {
      await access(path, X_OK);
      return { ok: true, path };
    } catch {
      continue;
    }
  }

  return {
    ok: false,
    failure: failure(
      "process",
      "binary_resolution_failed",
      `Provider binary \`${candidate}\` was not found on PATH.`,
    ),
  };
}

function waitForSpawn(
  child: ReturnType<typeof spawn>,
): Promise<{ ok: true } | { ok: false; error: Error }> {
  return new Promise((resolve) => {
    let settled = false;
    child.once("spawn", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ ok: true });
    });
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ ok: false, error });
    });
  });
}

function mapAgentResolutionError(error: unknown): InteractiveLaunchFailure {
  if (error instanceof AgentBinaryMissingError) {
    return failure(
      "process",
      "binary_resolution_failed",
      `Agent \`${error.agentId}\` is missing a binary path.`,
      error,
    );
  }

  if (error instanceof AgentBinaryAccessError) {
    return failure(
      "process",
      "binary_resolution_failed",
      `Agent binary \`${error.binaryPath}\` is not executable (${error.detail}).`,
      error,
    );
  }

  if (
    error instanceof AgentNotFoundError ||
    error instanceof AgentDisabledError
  ) {
    return failure("auth", "provider_resolution_failed", error.message, error);
  }

  return failure(
    "auth",
    "provider_resolution_failed",
    toErrorMessage(error),
    error,
  );
}

function failure(
  kind: InteractiveLaunchFailure["kind"],
  code: InteractiveLaunchFailureCode,
  message: string,
  cause?: unknown,
): InteractiveLaunchFailure {
  return {
    kind,
    code,
    message,
    ...(cause !== undefined ? { cause } : {}),
  };
}

function buildBaseRecord(options: {
  sessionId: string;
  createdAt: string;
  status: InteractiveSessionRecord["status"];
  agentId: string;
  toolAttachmentStatus: ToolAttachmentStatus;
  chat?: InteractiveSessionRecord["chat"];
  error?: InteractiveSessionRecord["error"];
}): InteractiveSessionRecord {
  const {
    sessionId,
    createdAt,
    status,
    agentId,
    toolAttachmentStatus,
    chat,
    error,
  } = options;
  return {
    sessionId,
    createdAt,
    status,
    agentId,
    toolAttachmentStatus,
    ...(chat ? { chat } : {}),
    ...(error ? { error } : {}),
  };
}
