import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { loadSandboxProviderConfig } from "../../configs/sandbox/loader.js";
import type { DenialBackoffConfig } from "../../configs/sandbox/types.js";
import { toErrorMessage } from "../../utils/errors.js";
import { stageAgentAuth } from "./auth.js";
import { captureAgentChatArtifacts } from "./chat.js";
import {
  AgentRuntimeError,
  AgentRuntimeProcessError,
  AgentRuntimeSandboxError,
} from "./errors.js";
import { configureSandboxSettings, runAgentProcess } from "./launcher.js";
import { writeAgentManifest } from "./manifest.js";
import {
  registerStagedAuthContext,
  teardownRegisteredAuthContext,
} from "./registry.js";
import { DEFAULT_DENIAL_BACKOFF } from "./sandbox.js";
import type {
  AgentRuntimeHarnessInput,
  AgentRuntimeHarnessResult,
} from "./types.js";

const PROMPT_TMP_PREFIX = "prompt.ephemeral";

export async function runSandboxedAgent(
  input: AgentRuntimeHarnessInput,
): Promise<AgentRuntimeHarnessResult> {
  const {
    root,
    agent,
    prompt,
    environment,
    paths,
    sessionId,
    sandboxProviderId,
    sandboxPolicyOverrides,
    extraWriteProtectedPaths,
    extraReadProtectedPaths,
    captureChat = true,
    teardownAuthOnExit = true,
    onWatchdogTrigger,
  } = input;

  const providerId = sandboxProviderId ?? agent.provider ?? "";
  if (!providerId) {
    throw new AgentRuntimeSandboxError(`Agent "${agent.id}" missing provider.`);
  }

  await mkdir(dirname(paths.runtimeManifestPath), { recursive: true });
  await mkdir(dirname(paths.sandboxSettingsPath), { recursive: true });
  await mkdir(dirname(paths.stdoutPath), { recursive: true });
  await mkdir(dirname(paths.stderrPath), { recursive: true });

  const promptPath = await writeEphemeralPrompt({
    runtimePath: paths.runtimePath,
    prompt,
  });

  let authContext:
    | Awaited<ReturnType<typeof stageAgentAuth>>["context"]
    | undefined;

  try {
    const staged = await stageAgentAuth({
      agent,
      agentRoot: paths.agentRoot,
      root,
      runId: sessionId,
    });
    authContext = staged.context;
    if (sessionId) {
      registerStagedAuthContext(sessionId, authContext);
    }

    const manifestEnv = await writeAgentManifest({
      agent,
      runtimeManifestPath: paths.runtimeManifestPath,
      promptPath,
      workspacePath: paths.workspacePath,
      env: staged.env,
      environment,
    });

    const denialBackoff = resolveDenialBackoff({
      root,
      providerId,
      override: input.denialBackoff,
    });

    const { sandboxSettings } = await configureSandboxSettings({
      sandboxHomePath: paths.sandboxHomePath,
      workspacePath: paths.workspacePath,
      providerId,
      root,
      sandboxSettingsPath: paths.sandboxSettingsPath,
      runtimePath: paths.runtimePath,
      artifactsPath: paths.artifactsPath,
      policyOverrides: sandboxPolicyOverrides,
      extraWriteProtectedPaths,
      extraReadProtectedPaths,
    });

    const processResult = await runAgentProcess({
      runtimeManifestPath: paths.runtimeManifestPath,
      agentRoot: paths.agentRoot,
      stdoutPath: paths.stdoutPath,
      stderrPath: paths.stderrPath,
      sandboxSettingsPath: paths.sandboxSettingsPath,
      providerId,
      denialBackoff,
      onWatchdogTrigger,
    });

    const chat = captureChat
      ? await captureAgentChatArtifacts({
          providerId: agent.provider,
          agentRoot: paths.agentRoot,
        })
      : undefined;

    return {
      exitCode: processResult.exitCode,
      errorMessage: processResult.errorMessage,
      signal: processResult.signal,
      watchdog: processResult.watchdog,
      failFast: processResult.failFast,
      sandboxSettings,
      manifestEnv,
      ...(chat ? { chat } : {}),
    };
  } catch (error) {
    if (error instanceof AgentRuntimeError) {
      throw error;
    }
    throw new AgentRuntimeProcessError(
      error instanceof Error ? error.message : toErrorMessage(error),
    );
  } finally {
    await rm(promptPath, { force: true }).catch(() => {});
    if (teardownAuthOnExit || !sessionId) {
      await teardownRegisteredAuthContext(
        sessionId ?? "runtime",
        authContext,
      ).catch(() => {});
    }
  }
}

async function writeEphemeralPrompt(options: {
  runtimePath: string;
  prompt: string;
}): Promise<string> {
  const { runtimePath, prompt } = options;
  const nonce = randomBytes(8).toString("hex");
  const path = join(runtimePath, `${PROMPT_TMP_PREFIX}.${nonce}.txt`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, prompt, { encoding: "utf8" });
  return path;
}

function resolveDenialBackoff(options: {
  root: string;
  providerId: string;
  override?: DenialBackoffConfig;
}): DenialBackoffConfig {
  if (options.override) {
    return options.override;
  }

  try {
    const config = loadSandboxProviderConfig({
      root: options.root,
      providerId: options.providerId,
    });
    return config.denialBackoff;
  } catch {
    return DEFAULT_DENIAL_BACKOFF;
  }
}
