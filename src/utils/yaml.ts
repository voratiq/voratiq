import { readFile, writeFile } from "node:fs/promises";

import type { YAMLException } from "js-yaml";

import { isFileSystemError } from "./fs.js";

export interface ConfigSnapshot {
  content: string;
  normalized: string;
  exists: boolean;
}

/**
 * Reads a YAML (or general text) config file and returns its snapshot.
 */
export async function readConfigSnapshot(
  filePath: string,
): Promise<ConfigSnapshot> {
  try {
    const content = await readFile(filePath, "utf8");
    return {
      content,
      normalized: normalizeConfigText(content),
      exists: true,
    };
  } catch (error) {
    if (isFileSystemError(error) && error.code === "ENOENT") {
      return { content: "", normalized: "", exists: false };
    }
    throw error;
  }
}

/**
 * Normalizes YAML text for comparisons by trimming whitespace and normalizing line endings.
 */
export function normalizeConfigText(value: string): string {
  if (value.length === 0) {
    return "";
  }
  return value.replace(/\r\n/g, "\n").trim();
}

/**
 * Writes config content to disk if the normalized version differs from the previous snapshot.
 */
export async function writeConfigIfChanged(
  filePath: string,
  nextContent: string,
  previousNormalized: string,
): Promise<boolean> {
  const nextNormalized = normalizeConfigText(nextContent);
  if (nextNormalized === previousNormalized) {
    return false;
  }

  await writeFile(filePath, ensureTrailingNewline(nextContent), "utf8");
  return true;
}

export interface YamlConfigLoadResult<T> {
  snapshot: ConfigSnapshot;
  config: T;
}

export async function loadYamlConfig<T>(
  filePath: string,
  parse: (content: string) => T,
): Promise<YamlConfigLoadResult<T>> {
  const snapshot = await readConfigSnapshot(filePath);
  return {
    snapshot,
    config: parse(snapshot.content),
  };
}

export function isDefaultYamlTemplate(
  snapshot: ConfigSnapshot,
  defaultTemplate: string,
): boolean {
  if (!snapshot.exists) {
    return true;
  }
  const defaults = normalizeConfigText(defaultTemplate);
  return snapshot.normalized === defaults;
}

export interface PersistYamlConfigOptions {
  filePath: string;
  serialized: string;
  original: ConfigSnapshot;
  defaultTemplate: string;
  isDefaultTemplate?: boolean;
}

export async function persistYamlConfig(
  options: PersistYamlConfigOptions,
): Promise<boolean> {
  const { filePath, serialized, original, defaultTemplate, isDefaultTemplate } =
    options;

  if (!original.exists) {
    return writeConfigIfChanged(filePath, serialized, "__missing__");
  }

  const wasDefaultTemplate =
    isDefaultTemplate ?? isDefaultYamlTemplate(original, defaultTemplate);

  const previousNormalized = wasDefaultTemplate
    ? normalizeConfigText(defaultTemplate)
    : original.normalized;

  return writeConfigIfChanged(filePath, serialized, previousNormalized);
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

export function isYamlException(error: unknown): error is YAMLException {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    "name" in (error as Record<string, unknown>) &&
    (error as YAMLException).name === "YAMLException"
  );
}
