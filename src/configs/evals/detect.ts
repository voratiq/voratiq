import { readFile } from "node:fs/promises";

import { pathExists } from "../../utils/fs.js";
import { resolvePath } from "../../utils/path.js";
import {
  type EnvironmentConfig,
  getPythonEnvironmentPath,
  isNodeEnvironmentDisabled,
  isPythonEnvironmentDisabled,
} from "../environment/types.js";
import type { EvalSlug } from "./types.js";

export const CANONICAL_EVAL_SLUGS: EvalSlug[] = [
  "format",
  "lint",
  "typecheck",
  "tests",
];

export interface EvalSuggestion {
  source: "node" | "python";
  commands: Map<EvalSlug, string>;
  notes: string[];
  warnings: string[];
}

export async function detectEvalSuggestions(
  root: string,
  environment: EnvironmentConfig,
): Promise<EvalSuggestion[]> {
  const suggestions: EvalSuggestion[] = [];

  const nodeSuggestion = await detectNodeEvalSuggestion(root, environment);
  if (nodeSuggestion) {
    suggestions.push(nodeSuggestion);
  }

  const pythonSuggestion = await detectPythonEvalSuggestion(root, environment);
  if (pythonSuggestion) {
    suggestions.push(pythonSuggestion);
  }

  return suggestions;
}

async function detectNodeEvalSuggestion(
  root: string,
  environment: EnvironmentConfig,
): Promise<EvalSuggestion | undefined> {
  if (isNodeEnvironmentDisabled(environment)) {
    return undefined;
  }

  const packageJsonPath = resolvePath(root, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    return undefined;
  }

  let packageJson: PackageJson | undefined;
  try {
    const raw = await readFile(packageJsonPath, "utf8");
    packageJson = JSON.parse(raw) as PackageJson;
  } catch {
    return undefined;
  }

  const manager = await resolvePackageManager(root, packageJson);
  const scripts = packageJson.scripts ?? {};
  const commands = new Map<EvalSlug, string>();

  const formatScript = pickScript(scripts, ["format:check", "format"]);
  if (formatScript) {
    commands.set("format", buildRunScriptCommand(manager, formatScript));
  }

  const lintScript = pickScript(scripts, ["lint"]);
  if (lintScript) {
    commands.set("lint", buildRunScriptCommand(manager, lintScript));
  }

  const typecheckScript = pickScript(scripts, ["typecheck"]);
  if (typecheckScript) {
    commands.set("typecheck", buildRunScriptCommand(manager, typecheckScript));
  } else if (await pathExists(resolvePath(root, "tsconfig.typecheck.json"))) {
    commands.set(
      "typecheck",
      "npx tsc --project tsconfig.typecheck.json --noEmit",
    );
  } else if (hasDependency(packageJson, "typescript")) {
    commands.set("typecheck", "npx tsc --noEmit");
  }

  const testsScript = pickScript(scripts, ["test"]);
  if (testsScript) {
    commands.set("tests", buildRunScriptCommand(manager, testsScript));
  }

  if (commands.size === 0) {
    return undefined;
  }

  const notes = ["Detected Node.js workspace; npm-style commands suggested."];
  const warnings: string[] = [];
  const nodeModulesPath = resolvePath(root, "node_modules");
  if (!(await pathExists(nodeModulesPath))) {
    warnings.push(
      "Detected package.json but node_modules/ is missing; install dependencies before running these commands.",
    );
  }

  return {
    source: "node",
    commands,
    notes,
    warnings,
  };
}

async function detectPythonEvalSuggestion(
  root: string,
  environment: EnvironmentConfig,
): Promise<EvalSuggestion | undefined> {
  if (isPythonEnvironmentDisabled(environment)) {
    return undefined;
  }

  const dependencies = await readPythonDependencies(root);
  if (dependencies.size === 0) {
    return undefined;
  }

  const commands = new Map<EvalSlug, string>();

  if (dependencies.has("ruff")) {
    commands.set("lint", "uv run ruff check");
    commands.set("format", "uv run ruff format --check");
  }

  if (dependencies.has("pytest")) {
    commands.set("tests", "uv run pytest");
  }

  if (dependencies.has("pyright")) {
    commands.set("typecheck", "uv run pyright");
  }

  if (commands.size === 0) {
    return undefined;
  }

  const notes = ["Detected Python workspace; uv-based commands suggested."];
  const warnings: string[] = [];
  if (!getPythonEnvironmentPath(environment)) {
    warnings.push(
      "Python tooling detected but python.path is unset in .voratiq/environment.yaml; configure a virtual environment.",
    );
  }

  return {
    source: "python",
    commands,
    notes,
    warnings,
  };
}

function pickScript(
  scripts: Record<string, string>,
  candidates: string[],
): string | undefined {
  for (const candidate of candidates) {
    if (candidate in scripts) {
      return candidate;
    }
  }
  return undefined;
}

async function resolvePackageManager(
  root: string,
  packageJson: PackageJson,
): Promise<NodeManagerDescriptor> {
  if (await pathExists(resolvePath(root, "pnpm-lock.yaml"))) {
    return { kind: "pnpm", exec: "pnpm run" };
  }
  if (await pathExists(resolvePath(root, "yarn.lock"))) {
    return { kind: "yarn", exec: "yarn" };
  }
  if (await pathExists(resolvePath(root, "package-lock.json"))) {
    return { kind: "npm", exec: "npm run" };
  }
  if (await pathExists(resolvePath(root, "npm-shrinkwrap.json"))) {
    return { kind: "npm", exec: "npm run" };
  }

  if (packageJson.packageManager) {
    const manager = packageJson.packageManager.split("@")[0];
    if (manager === "pnpm") {
      return { kind: "pnpm", exec: "pnpm run" };
    }
    if (manager === "yarn") {
      return { kind: "yarn", exec: "yarn" };
    }
  }

  return { kind: "npm", exec: "npm run" };
}

function buildRunScriptCommand(
  manager: NodeManagerDescriptor,
  scriptName: string,
): string {
  switch (manager.kind) {
    case "pnpm":
      return `pnpm run ${scriptName}`;
    case "yarn":
      return scriptName === "test" ? "yarn test" : `yarn ${scriptName}`;
    default:
      return `npm run ${scriptName}`;
  }
}

async function readPythonDependencies(root: string): Promise<Set<string>> {
  const result = new Set<string>();

  const pyprojectPath = resolvePath(root, "pyproject.toml");
  if (await pathExists(pyprojectPath)) {
    try {
      const raw = await readFile(pyprojectPath, "utf8");
      extractPyprojectDependencies(raw, result);
    } catch (error) {
      void error;
    }
  }

  const requirementFiles = [
    "requirements.txt",
    "requirements-dev.txt",
    "dev-requirements.txt",
  ];

  for (const file of requirementFiles) {
    const absolute = resolvePath(root, file);
    if (await pathExists(absolute)) {
      try {
        const raw = await readFile(absolute, "utf8");
        extractRequirementDependencies(raw, result);
      } catch (error) {
        void error;
      }
    }
  }

  return result;
}

function extractPyprojectDependencies(
  content: string,
  result: Set<string>,
): void {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const normalized = line.toLowerCase();
    if (normalized.includes("ruff")) {
      result.add("ruff");
    }
    if (normalized.includes("pytest")) {
      result.add("pytest");
    }
    if (normalized.includes("pyright")) {
      result.add("pyright");
    }
  }
}

function extractRequirementDependencies(
  content: string,
  result: Set<string>,
): void {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const normalized = trimmed.toLowerCase();
    if (normalized.startsWith("ruff")) {
      result.add("ruff");
    }
    if (normalized.startsWith("pytest")) {
      result.add("pytest");
    }
    if (normalized.startsWith("pyright")) {
      result.add("pyright");
    }
  }
}

function hasDependency(packageJson: PackageJson, name: string): boolean {
  const { dependencies = {}, devDependencies = {} } = packageJson;
  return Boolean(dependencies[name] ?? devDependencies[name]);
}

interface PackageJson {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface NodeManagerDescriptor {
  kind: "npm" | "pnpm" | "yarn";
  exec: string;
}
