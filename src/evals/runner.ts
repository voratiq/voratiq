import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";

import {
  type EnvironmentConfig,
  getNodeDependencyRoots,
  getPythonEnvironmentPath,
} from "../configs/environment/types.js";
import type {
  AgentEvalResult,
  EvalDefinition,
} from "../configs/evals/types.js";
import { sanitizeSlugForFilename } from "../configs/evals/types.js";
import { toErrorMessage } from "../utils/errors.js";
import {
  normalizePathForDisplay,
  relativeToRoot,
  resolvePath,
} from "../utils/path.js";
import { spawnStreamingProcess } from "../utils/process.js";

interface ExecuteEvaluationsOptions {
  evaluations: readonly EvalDefinition[];
  cwd: string;
  root: string;
  logsDirectory: string;
  env?: NodeJS.ProcessEnv;
  environment: EnvironmentConfig;
}

export interface ExecuteEvaluationsResult {
  results: AgentEvalResult[];
  warnings: string[];
}

export async function executeEvaluations(
  options: ExecuteEvaluationsOptions,
): Promise<ExecuteEvaluationsResult> {
  const { evaluations, cwd, root, logsDirectory, env, environment } = options;
  const results: AgentEvalResult[] = [];
  const warnings: string[] = [];

  await mkdir(logsDirectory, { recursive: true });

  const evalEnvironment = composeEvalEnvironment(env);

  for (const evaluation of evaluations) {
    const { slug, command } = evaluation;
    if (!command) {
      results.push({
        slug,
        status: "skipped",
      });
      continue;
    }

    const logFileName = `${sanitizeSlugForFilename(slug)}.log`;
    const logPath = resolvePath(logsDirectory, logFileName);
    const logStream = createWriteStream(logPath, { flags: "w" });
    let exitCode: number | null = null;
    let status: AgentEvalResult["status"] = "succeeded";
    let errorMessage: string | undefined;

    const missingStacks = detectMissingStacks(command, environment);
    if (missingStacks.length > 0) {
      const warningMessage = buildMissingStackWarning(
        slug,
        command,
        missingStacks,
      );
      logStream.write(`${warningMessage}\n`);
      warnings.push(warningMessage);
    }

    try {
      const { exitCode: code, signal } = await spawnStreamingProcess({
        command,
        cwd,
        env: evalEnvironment,
        shell: true,
        stdout: { writable: logStream, endOnClose: false },
        stderr: { writable: logStream, endOnClose: false },
      });
      if (signal) {
        status = "errored";
        exitCode = null;
        errorMessage = `Process terminated by signal ${signal}`;
      } else {
        exitCode = code;
        status = code === 0 ? "succeeded" : "failed";
      }
    } catch (error) {
      status = "errored";
      exitCode = null;
      errorMessage = toErrorMessage(error);
    } finally {
      logStream.end();
    }

    results.push({
      slug,
      status,
      command,
      exitCode,
      logPath: normalizePathForDisplay(relativeToRoot(root, logPath)),
      error: errorMessage,
    });
  }

  return { results, warnings };
}

function composeEvalEnvironment(
  overrides?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...overrides,
  };
}

function detectMissingStacks(
  command: string,
  environment: EnvironmentConfig,
): string[] {
  const lower = command.toLowerCase();
  const required: Set<string> = new Set();

  if (requiresNodeStack(lower)) {
    required.add("node");
  }

  if (requiresPythonStack(lower)) {
    required.add("python");
  }

  const missing: string[] = [];

  if (
    required.has("node") &&
    getNodeDependencyRoots(environment).length === 0
  ) {
    missing.push("node");
  }

  if (required.has("python") && !getPythonEnvironmentPath(environment)) {
    missing.push("python");
  }

  return missing;
}

function requiresNodeStack(source: string): boolean {
  const markers = [
    "npm ",
    "npm:",
    "npx ",
    "pnpm ",
    "yarn ",
    " node",
    "node ",
    "tsc",
    "jest",
  ];
  return markers.some((marker) => source.includes(marker));
}

function requiresPythonStack(source: string): boolean {
  const markers = [
    "python",
    "pytest",
    "ruff",
    "uv ",
    " uv",
    "pipenv",
    "pip ",
    " pip",
    "poetry",
    "pyright",
    "conda",
  ];
  return markers.some((marker) => source.includes(marker));
}

function buildMissingStackWarning(
  slug: string,
  command: string,
  stacks: readonly string[],
): string {
  const stackLabel = stacks.join(" and ");
  return `[voratiq] Warning: "${slug}" command requires ${stackLabel} tooling, but .voratiq/environment.yaml is missing the corresponding configuration. Command: ${command}`;
}
