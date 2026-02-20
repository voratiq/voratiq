import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  isAbsolute,
  relative as relativePath,
  resolve as resolveAbsolute,
} from "node:path";

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
  envDirectoryGuard?: EvalEnvDirectoryGuardOptions;
}

export interface EvalEnvDirectoryGuardOptions {
  trustedAbsoluteRoots: readonly string[];
  includeHomeForPythonStack?: boolean;
  failOnDirectoryPreparationError?: boolean;
}

export interface ExecuteEvaluationsResult {
  results: AgentEvalResult[];
  warnings: string[];
}

export async function executeEvaluations(
  options: ExecuteEvaluationsOptions,
): Promise<ExecuteEvaluationsResult> {
  const {
    evaluations,
    cwd,
    root,
    logsDirectory,
    env,
    environment,
    envDirectoryGuard,
  } = options;
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

    try {
      const prepWarnings = await ensureEvalEnvDirectories({
        command,
        cwd,
        env: evalEnvironment,
        guard: envDirectoryGuard,
      });
      warnings.push(...prepWarnings);
    } catch (error) {
      throw new Error(
        `Eval environment preparation failed for "${slug}": ${toErrorMessage(error)}`,
      );
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

async function ensureEvalEnvDirectories(options: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  guard?: EvalEnvDirectoryGuardOptions;
}): Promise<string[]> {
  const { command, cwd, env, guard } = options;
  if (!guard) {
    return [];
  }

  const warnings: string[] = [];
  const candidates = collectEvalEnvDirCandidates({
    command,
    cwd,
    env,
    includeHomeForPythonStack: guard.includeHomeForPythonStack ?? false,
  });
  if (candidates.length === 0) {
    return warnings;
  }

  const trustedRoots = normalizeTrustedRoots(guard.trustedAbsoluteRoots);
  trustedRoots.push(resolveAbsolute(tmpdir()));

  for (const candidate of candidates) {
    if (
      candidate.absolute &&
      !isWithinAnyRoot(candidate.resolvedPath, trustedRoots)
    ) {
      warnings.push(
        `[voratiq] Warning: skipping eval env mkdir for ${candidate.variables.join(", ")} at ${candidate.resolvedPath} (outside trusted roots).`,
      );
      continue;
    }

    try {
      await mkdir(candidate.resolvedPath, { recursive: true });
    } catch (error) {
      const failureMessage = `[voratiq] Warning: failed to create eval env directory for ${candidate.variables.join(", ")} at ${candidate.resolvedPath}: ${toErrorMessage(error)}`;
      warnings.push(failureMessage);
      if (guard.failOnDirectoryPreparationError) {
        throw new Error(
          `required eval env directory prep failed for ${candidate.variables.join(", ")} at ${candidate.resolvedPath}: ${toErrorMessage(error)}`,
        );
      }
    }
  }

  return warnings;
}

function collectEvalEnvDirCandidates(options: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  includeHomeForPythonStack: boolean;
}): Array<{ resolvedPath: string; variables: string[]; absolute: boolean }> {
  const { command, cwd, env, includeHomeForPythonStack } = options;
  const lowerCommand = command.toLowerCase();
  const variableNames = ["TMPDIR", "TMP", "TEMP"];
  if (includeHomeForPythonStack && requiresPythonStack(lowerCommand)) {
    variableNames.push("HOME");
  }

  const deduplicated = new Map<
    string,
    { resolvedPath: string; variables: string[]; absolute: boolean }
  >();

  for (const variable of variableNames) {
    const raw = env[variable];
    if (typeof raw !== "string") {
      continue;
    }

    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const absolute = isAbsolute(trimmed);
    const resolvedPath = absolute
      ? resolveAbsolute(trimmed)
      : resolveAbsolute(cwd, trimmed);
    const existing = deduplicated.get(resolvedPath);
    if (existing) {
      existing.variables.push(variable);
      continue;
    }

    deduplicated.set(resolvedPath, {
      resolvedPath,
      variables: [variable],
      absolute,
    });
  }

  return Array.from(deduplicated.values());
}

function normalizeTrustedRoots(roots: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const root of roots) {
    if (typeof root !== "string") {
      continue;
    }
    const trimmed = root.trim();
    if (trimmed.length === 0) {
      continue;
    }
    unique.add(resolveAbsolute(trimmed));
  }
  return Array.from(unique);
}

function isWithinAnyRoot(target: string, roots: readonly string[]): boolean {
  for (const root of roots) {
    if (isWithinRoot(root, target)) {
      return true;
    }
  }
  return false;
}

function isWithinRoot(root: string, target: string): boolean {
  const rel = relativePath(root, target);
  if (rel === "" || rel === ".") {
    return true;
  }
  if (rel.startsWith("..")) {
    return false;
  }
  return !isAbsolute(rel);
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
