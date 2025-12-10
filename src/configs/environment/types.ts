import { z } from "zod";

import { assertRepoRelativePath } from "../../utils/path.js";

function formatEnvironmentPathError(
  label: string,
  value: string,
  reason: string,
): string {
  const displayValue = value.length === 0 ? "<empty>" : value;
  return `Invalid ${label} "${displayValue}": ${reason}.`;
}

function createEnvironmentPathSchema(label: string) {
  return z.string().superRefine((value, ctx) => {
    if (value.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: formatEnvironmentPathError(
          label,
          value,
          "value must be a non-empty string.",
        ),
      });
      return;
    }

    if (value.includes("\0")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: formatEnvironmentPathError(
          label,
          value,
          "paths may not contain null bytes.",
        ),
      });
      return;
    }

    try {
      assertRepoRelativePath(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: formatEnvironmentPathError(
          label,
          value,
          "paths must stay within the repository (no absolute entries, '..', or backslashes).",
        ),
      });
    }
  });
}

const dependencyRoot = createEnvironmentPathSchema("node.dependencyRoots[]");

const pythonPath = createEnvironmentPathSchema("python.path");

export const environmentNodeConfigSchema = z.union([
  z
    .object({
      dependencyRoots: z.array(dependencyRoot).min(1),
    })
    .strict(),
  z.literal(false),
]);

export const environmentPythonConfigSchema = z.union([
  z
    .object({
      path: pythonPath,
    })
    .strict(),
  z.literal(false),
]);

export const environmentConfigSchema = z
  .object({
    node: environmentNodeConfigSchema.optional(),
    python: environmentPythonConfigSchema.optional(),
  })
  .strict();

export type EnvironmentConfig = z.infer<typeof environmentConfigSchema>;

export function normalizeEnvironmentConfig(
  config: EnvironmentConfig,
): EnvironmentConfig {
  const normalized: EnvironmentConfig = {};

  if (config.node === false) {
    normalized.node = false;
  } else if (config.node?.dependencyRoots?.length) {
    normalized.node = {
      dependencyRoots: [...new Set(config.node.dependencyRoots)],
    };
  }

  const pythonPath = getPythonEnvironmentPath(config);
  if (pythonPath) {
    normalized.python = {
      path: pythonPath,
    };
  } else if (isPythonEnvironmentDisabled(config)) {
    normalized.python = false;
  }

  return normalized;
}

export function isNodeEnvironmentDisabled(
  environment: EnvironmentConfig,
): boolean {
  return environment.node === false;
}

export function getNodeDependencyRoots(
  environment: EnvironmentConfig,
): readonly string[] {
  const node = environment.node;
  if (node && typeof node === "object") {
    return node.dependencyRoots;
  }
  return [];
}

export function isPythonEnvironmentDisabled(
  environment: EnvironmentConfig,
): boolean {
  return environment.python === false;
}

export function getPythonEnvironmentPath(
  environment: EnvironmentConfig,
): string | undefined {
  const python = environment.python;
  if (python && typeof python === "object") {
    return python.path;
  }
  return undefined;
}
