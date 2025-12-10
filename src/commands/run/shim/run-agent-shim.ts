import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { composeRestrictedEnvironment } from "../../../utils/env.js";
import {
  GIT_AUTHOR_EMAIL,
  GIT_AUTHOR_NAME,
  GIT_COMMITTER_EMAIL,
  GIT_COMMITTER_NAME,
} from "../../../utils/git.js";
import { injectPromptArg } from "../argv.js";

class ShimError extends Error {
  public readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "ShimError";
    this.exitCode = exitCode;
  }
}

interface NormalizedManifest {
  binary: string;
  argv: string[];
  promptPath: string;
  workspace: string;
  env: Record<string, string>;
}

interface ParsedArguments {
  configPath: string;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const { configPath } = parseArguments(argv);
    const resolvedConfigPath = resolvePath(process.cwd(), configPath);
    const manifest = await loadManifest(resolvedConfigPath);
    const agentRoot = resolveAgentRoot(resolvedConfigPath);
    const prompt = await loadPrompt(
      agentRoot,
      manifest.promptPath,
      resolvedConfigPath,
    );

    let agentArgv: string[];
    try {
      agentArgv = injectPromptArg(manifest.argv, prompt);
    } catch (error) {
      throw new ShimError(
        `Failed to inject prompt into argv: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const exitCode = await launchAgent({
      manifest,
      agentRoot,
      argv: agentArgv,
    });
    return exitCode;
  } catch (error) {
    if (error instanceof ShimError) {
      logError(error.message);
      return error.exitCode;
    }

    const message = error instanceof Error ? error.message : String(error);
    logError(`Unexpected error: ${message}`);
    return 1;
  }
}

function parseArguments(args: string[]): ParsedArguments {
  let configPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--config") {
      const next = args[index + 1];
      if (!next) {
        throw new ShimError("Missing value for --config option");
      }
      configPath = next;
      index += 1;
      continue;
    }

    throw new ShimError(`Unknown argument: ${token}`);
  }

  if (!configPath) {
    throw new ShimError("Missing required --config <path> argument");
  }

  return { configPath };
}

async function loadManifest(configPath: string): Promise<NormalizedManifest> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ShimError(
      `Failed to read manifest at "${configPath}": ${detail}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ShimError(
      `Manifest JSON at "${configPath}" is invalid: ${detail}`,
    );
  }

  return validateManifest(parsed, configPath);
}

function validateManifest(
  data: unknown,
  configPath: string,
): NormalizedManifest {
  if (typeof data !== "object" || data === null) {
    throw new ShimError(`Manifest at "${configPath}" must be a JSON object`);
  }

  const record = data as Record<string, unknown>;
  const { binary, argv, promptPath, workspace, env } = record;

  if (typeof binary !== "string" || binary.trim() === "") {
    throw new ShimError(
      `Manifest at "${configPath}" is missing required string field "binary"`,
    );
  }

  const manifestArgv = ensureStringArray({
    value: argv,
    field: "argv",
    configPath,
  });

  if (typeof promptPath !== "string" || promptPath.trim() === "") {
    throw new ShimError(
      `Manifest at "${configPath}" is missing required string field "promptPath"`,
    );
  }

  if (typeof workspace !== "string" || workspace.trim() === "") {
    throw new ShimError(
      `Manifest at "${configPath}" is missing required string field "workspace"`,
    );
  }

  const manifestEnv = ensureEnvRecord({
    value: env,
    configPath,
  });

  return {
    binary,
    argv: manifestArgv,
    promptPath,
    workspace,
    env: manifestEnv,
  };
}

function ensureStringArray(options: {
  value: unknown;
  field: string;
  configPath: string;
}): string[] {
  const { value, field, configPath } = options;
  if (!Array.isArray(value)) {
    throw new ShimError(
      `Manifest at "${configPath}" must provide "${field}" as an array of strings`,
    );
  }

  const result: string[] = [];
  for (const token of value) {
    if (typeof token !== "string") {
      throw new ShimError(
        `Manifest at "${configPath}" must provide "${field}" as an array of strings`,
      );
    }
    result.push(token);
  }
  return result;
}

function ensureEnvRecord(options: {
  value: unknown;
  configPath: string;
}): Record<string, string> {
  const { value, configPath } = options;
  if (value === undefined) {
    return {};
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ShimError(
      `Manifest at "${configPath}" must provide "env" as an object of string values`,
    );
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new ShimError(
        `Manifest at "${configPath}" must provide "env" as an object of string values`,
      );
    }
    result[key] = entry;
  }

  return result;
}

function resolveAgentRoot(configPath: string): string {
  return dirname(configPath);
}

async function loadPrompt(
  agentRoot: string,
  manifestPromptPath: string,
  configPath: string,
): Promise<string> {
  const promptAbsolute = isAbsolute(manifestPromptPath)
    ? manifestPromptPath
    : resolvePath(agentRoot, manifestPromptPath);
  try {
    return await readFile(promptAbsolute, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ShimError(
      `Failed to read prompt from "${promptAbsolute}" (manifest: "${configPath}", agentRoot: "${agentRoot}", promptPath: "${manifestPromptPath}"): ${detail}`,
    );
  }
}

async function launchAgent(options: {
  manifest: NormalizedManifest;
  agentRoot: string;
  argv: string[];
}): Promise<number> {
  const { manifest, agentRoot, argv } = options;
  const binaryPath = isAbsolute(manifest.binary)
    ? manifest.binary
    : resolvePath(agentRoot, manifest.binary);

  const workspacePath = isAbsolute(manifest.workspace)
    ? manifest.workspace
    : resolvePath(agentRoot, manifest.workspace);
  const launchEnv = composeRestrictedEnvironment(manifest.env);
  // Agent commits generated outside the sandbox reuse this persona via
  // resolveSandboxPersona in src/commands/run/agents/lifecycle.ts.
  const personaEnv: Record<string, string> = {
    GIT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME,
    GIT_COMMITTER_EMAIL,
    GIT_TERMINAL_PROMPT: "0",
  };

  for (const [key, value] of Object.entries(personaEnv)) {
    if (launchEnv[key] === undefined) {
      launchEnv[key] = value;
    }
  }

  return await new Promise<number>((resolve) => {
    let resolved = false;
    const child = spawn(binaryPath, argv, {
      cwd: workspacePath,
      env: launchEnv,
      stdio: "inherit",
    });

    child.once("error", (error) => {
      if (resolved) {
        return;
      }
      resolved = true;
      const detail = error instanceof Error ? error.message : String(error);
      logError(`Failed to launch agent binary at "${binaryPath}": ${detail}`);
      resolve(1);
    });

    child.once("exit", (code, signal) => {
      if (resolved) {
        return;
      }
      resolved = true;
      if (signal) {
        logError(`Agent terminated by signal ${signal}`);
        resolve(1);
        return;
      }
      resolve(code ?? 0);
    });
  });
}

function logError(message: string): void {
  console.error(`[voratiq] ${message}`);
}

const modulePath = fileURLToPath(import.meta.url);
const invokedScript = process.argv[1]
  ? resolvePath(process.argv[1])
  : undefined;

if (invokedScript && modulePath === invokedScript) {
  void main().then(
    (exitCode) => {
      process.exit(exitCode);
    },
    (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      logError(`Unexpected error: ${detail}`);
      process.exit(1);
    },
  );
}
