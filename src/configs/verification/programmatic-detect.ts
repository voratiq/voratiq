import { readFile } from "node:fs/promises";

import { pathExists } from "../../utils/fs.js";
import { resolvePath } from "../../utils/path.js";
import {
  type EnvironmentConfig,
  getPythonEnvironmentPath,
  isNodeEnvironmentDisabled,
  isPythonEnvironmentDisabled,
} from "../environment/types.js";
import type { ProgrammaticSlug } from "./methods.js";

export const CANONICAL_PROGRAMMATIC_SLUGS: ProgrammaticSlug[] = [
  "format",
  "lint",
  "typecheck",
  "tests",
];

export interface ProgrammaticSuggestion {
  source: "node" | "python";
  commands: Map<ProgrammaticSlug, string>;
  notes: string[];
  warnings: string[];
}

export async function detectProgrammaticSuggestions(
  root: string,
  environment: EnvironmentConfig,
): Promise<ProgrammaticSuggestion[]> {
  const suggestions: ProgrammaticSuggestion[] = [];

  const nodeSuggestion = await detectNodeSuggestion(root, environment);
  if (nodeSuggestion) {
    suggestions.push(nodeSuggestion);
  }

  const pythonSuggestion = await detectPythonSuggestion(root, environment);
  if (pythonSuggestion) {
    suggestions.push(pythonSuggestion);
  }

  return suggestions;
}

async function detectNodeSuggestion(
  root: string,
  environment: EnvironmentConfig,
): Promise<ProgrammaticSuggestion | undefined> {
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
  const commands = new Map<ProgrammaticSlug, string>();

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

async function detectPythonSuggestion(
  root: string,
  environment: EnvironmentConfig,
): Promise<ProgrammaticSuggestion | undefined> {
  if (isPythonEnvironmentDisabled(environment)) {
    return undefined;
  }

  const dependencies = await readPythonDependencies(root);
  if (dependencies.size === 0) {
    return undefined;
  }

  const commands = new Map<ProgrammaticSlug, string>();

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
  const patterns = [
    /^\s*dependencies\s*=\s*\[/imu,
    /^\s*\[project.optional-dependencies\]\s*$/imu,
  ];
  if (!patterns.some((pattern) => pattern.test(content))) {
    return;
  }
  for (const match of content.matchAll(/"([A-Za-z0-9_.-]+)\\b[^"]*"/gu)) {
    result.add(match[1].toLowerCase());
  }
}

function extractRequirementDependencies(
  content: string,
  result: Set<string>,
): void {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z0-9_.-]+)/u);
    if (match?.[1]) {
      result.add(match[1].toLowerCase());
    }
  }
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
}

interface NodeManagerDescriptor {
  kind: "npm" | "pnpm" | "yarn";
  exec: string;
}

function hasDependency(pkg: PackageJson, name: string): boolean {
  return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}
