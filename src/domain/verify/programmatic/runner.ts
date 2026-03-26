import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, resolve as resolveAbsolute } from "node:path";

import {
  type EnvironmentConfig,
  getNodeDependencyRoots,
  getPythonEnvironmentPath,
} from "../../../configs/environment/types.js";
import type {
  ProgrammaticCheckResult,
  ProgrammaticCommandEntry,
} from "../../../configs/verification/methods.js";
import { sanitizeSlugForFilename } from "../../../configs/verification/methods.js";
import { toErrorMessage } from "../../../utils/errors.js";
import {
  normalizePathForDisplay,
  relativeToRoot,
  resolvePath,
} from "../../../utils/path.js";
import { spawnStreamingProcess } from "../../../utils/process.js";

interface ExecuteProgrammaticChecksOptions {
  checks: readonly ProgrammaticCommandEntry[];
  cwd: string;
  root: string;
  logsDirectory: string;
  env?: NodeJS.ProcessEnv;
  environment: EnvironmentConfig;
  envDirectoryGuard?: ProgrammaticEnvDirectoryGuardOptions;
}

export interface ProgrammaticEnvDirectoryGuardOptions {
  trustedAbsoluteRoots: readonly string[];
  includeHomeForPythonStack?: boolean;
  failOnDirectoryPreparationError?: boolean;
}

export interface ExecuteProgrammaticChecksResult {
  results: ProgrammaticCheckResult[];
  warnings: string[];
}

export async function executeProgrammaticChecks(
  options: ExecuteProgrammaticChecksOptions,
): Promise<ExecuteProgrammaticChecksResult> {
  const {
    checks,
    cwd,
    root,
    logsDirectory,
    env,
    environment,
    envDirectoryGuard,
  } = options;
  const results: ProgrammaticCheckResult[] = [];
  const warnings: string[] = [];

  await mkdir(logsDirectory, { recursive: true });

  const checkEnvironment = composeCheckEnvironment(env);

  for (const check of checks) {
    const { slug, command } = check;
    if (!command) {
      results.push({
        slug,
        status: "skipped",
      });
      continue;
    }

    try {
      const prepWarnings = await ensureEnvDirectories({
        command,
        cwd,
        env: checkEnvironment,
        guard: envDirectoryGuard,
      });
      warnings.push(...prepWarnings);
    } catch (error) {
      throw new Error(
        `Programmatic environment preparation failed for "${slug}": ${toErrorMessage(error)}`,
      );
    }

    const logFileName = `${sanitizeSlugForFilename(slug)}.log`;
    const logPath = resolvePath(logsDirectory, logFileName);
    const logStream = createWriteStream(logPath, { flags: "w" });
    let exitCode: number | null = null;
    let status: ProgrammaticCheckResult["status"] = "succeeded";
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
        env: checkEnvironment,
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

function composeCheckEnvironment(
  overrides?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...overrides,
  };
}

async function ensureEnvDirectories(options: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  guard?: ProgrammaticEnvDirectoryGuardOptions;
}): Promise<string[]> {
  const { command, cwd, env, guard } = options;
  if (!guard) {
    return [];
  }

  const warnings: string[] = [];
  const candidates = collectEnvDirCandidates({
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
        `[voratiq] Warning: skipping programmatic env mkdir for ${candidate.variables.join(", ")} at ${candidate.resolvedPath} (outside trusted roots).`,
      );
      continue;
    }

    try {
      await mkdir(candidate.resolvedPath, { recursive: true });
    } catch (error) {
      const failureMessage = `[voratiq] Warning: failed to create programmatic env directory for ${candidate.variables.join(", ")} at ${candidate.resolvedPath}: ${toErrorMessage(error)}`;
      warnings.push(failureMessage);
      if (guard.failOnDirectoryPreparationError) {
        throw new Error(
          `required programmatic env directory prep failed for ${candidate.variables.join(", ")} at ${candidate.resolvedPath}: ${toErrorMessage(error)}`,
        );
      }
    }
  }

  return warnings;
}

function collectEnvDirCandidates(options: {
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

function isWithinAnyRoot(path: string, roots: readonly string[]): boolean {
  for (const root of roots) {
    if (path === root) {
      return true;
    }
    if (path.startsWith(`${root}/`)) {
      return true;
    }
  }
  return false;
}

function detectMissingStacks(
  command: string,
  environment: EnvironmentConfig,
): string[] {
  const missing: string[] = [];
  const lowerCommand = command.toLowerCase();

  if (
    requiresNodeStack(lowerCommand) &&
    getNodeDependencyRoots(environment).length === 0
  ) {
    missing.push("node");
  }
  if (
    requiresPythonStack(lowerCommand) &&
    !getPythonEnvironmentPath(environment)
  ) {
    missing.push("python");
  }

  return missing;
}

function requiresNodeStack(command: string): boolean {
  return /(^|\\s)(npm|pnpm|yarn|node|tsc|jest|vitest)(\\s|$)/u.test(command);
}

function requiresPythonStack(command: string): boolean {
  return /(^|\\s)(python|python3|pip|pip3|pytest)(\\s|$)/u.test(command);
}

function buildMissingStackWarning(
  slug: string,
  command: string,
  missingStacks: readonly string[],
): string {
  const stackList = missingStacks.join(", ");
  return `[voratiq] Warning: programmatic check "${slug}" may fail because ${stackList} support is not enabled (command: ${JSON.stringify(command)}).`;
}
