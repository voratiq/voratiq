import { stat } from "node:fs/promises";

import { pathExists } from "../../utils/fs.js";
import { resolvePath } from "../../utils/path.js";
import { type EnvironmentConfig, normalizeEnvironmentConfig } from "./types.js";

export interface DetectEnvironmentOptions {
  root: string;
  interactive: boolean;
  promptPath?: PromptPathHandler;
}

export type PromptPathHandler = (options: PromptPathOptions) => Promise<string>;

export interface PromptPathOptions {
  message: string;
  defaultValue?: string;
  prefaceLines?: string[];
}

export interface EnvironmentDetectionResult {
  config: EnvironmentConfig;
  detectedEntries: string[];
}

const PYTHON_PATH_CANDIDATES = [".venv", "venv"];
const PYTHON_MARKER_FILES = [
  "pyproject.toml",
  "requirements.txt",
  "requirements-dev.txt",
  "setup.cfg",
  "setup.py",
  "Pipfile",
  "poetry.lock",
  "uv.lock",
];

export async function detectEnvironmentConfig(
  options: DetectEnvironmentOptions,
): Promise<EnvironmentDetectionResult> {
  const { root, interactive, promptPath } = options;

  const entries: string[] = [];
  const config: EnvironmentConfig = {};

  const nodeModulesDetected = await detectNodeDependencies(root);
  if (nodeModulesDetected) {
    config.node = { dependencyRoots: ["node_modules"] };
    entries.push("node");
  }

  const pythonPath = await detectPythonEnvironmentPath(root);
  if (pythonPath) {
    config.python = { path: pythonPath };
    entries.push(`python.path=${pythonPath}`);
  } else if (interactive && promptPath && (await hasPythonMarkers(root))) {
    const selection = (
      await promptPath({
        message:
          "Enter the path to an existing Python virtual environment (press Enter to skip)",
        defaultValue: ".venv",
        prefaceLines: [
          "",
          "Detected Python project markers but no virtual environment directory.",
        ],
      })
    ).trim();

    if (selection.length > 0) {
      config.python = { path: selection };
      entries.push(`python.path=${selection}`);
    }
  }

  return {
    config: normalizeEnvironmentConfig(config),
    detectedEntries: entries,
  };
}

async function detectNodeDependencies(root: string): Promise<boolean> {
  return pathExists(resolvePath(root, "node_modules"));
}

async function detectPythonEnvironmentPath(
  root: string,
): Promise<string | undefined> {
  for (const candidate of PYTHON_PATH_CANDIDATES) {
    const absolute = resolvePath(root, candidate);
    if (await pathExists(absolute)) {
      if (await isDirectorySafe(absolute)) {
        return candidate;
      }
    }
  }
  return undefined;
}

async function hasPythonMarkers(root: string): Promise<boolean> {
  for (const marker of PYTHON_MARKER_FILES) {
    if (await pathExists(resolvePath(root, marker))) {
      return true;
    }
  }
  return false;
}

async function isDirectorySafe(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
