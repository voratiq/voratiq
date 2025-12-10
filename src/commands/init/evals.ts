import { type EnvironmentConfig } from "../../configs/environment/types.js";
import {
  CANONICAL_EVAL_SLUGS,
  detectEvalSuggestions,
  type EvalSuggestion,
} from "../../configs/evals/detect.js";
import { readEvalsConfig } from "../../configs/evals/loader.js";
import type {
  EvalCommandEntry,
  EvalsConfig,
  EvalSlug,
} from "../../configs/evals/types.js";
import { normalizeEvalCommand } from "../../configs/evals/types.js";
import { renderEvalCommandPreface } from "../../render/transcripts/init.js";
import {
  isDefaultYamlTemplate,
  loadYamlConfig,
  persistYamlConfig,
} from "../../utils/yaml.js";
import {
  formatWorkspacePath,
  resolveWorkspacePath,
  VORATIQ_EVALS_FILE,
} from "../../workspace/structure.js";
import { buildDefaultEvalsTemplate } from "../../workspace/templates.js";
import type { EvalInitSummary, InitConfigureOptions } from "./types.js";

export const EVALS_CONFIG_DISPLAY_PATH =
  formatWorkspacePath(VORATIQ_EVALS_FILE);

const PLACEHOLDER_TEMPLATE = 'echo "configure %slug% eval"';

export async function configureEvals(
  root: string,
  options: InitConfigureOptions,
  environment: EnvironmentConfig,
): Promise<EvalInitSummary> {
  const filePath = resolveWorkspacePath(root, VORATIQ_EVALS_FILE);
  const defaultTemplate = buildDefaultEvalsTemplate();

  const loadResult = await loadYamlConfig(filePath, readEvalsConfig);
  const defaultStatus = isDefaultYamlTemplate(
    loadResult.snapshot,
    defaultTemplate,
  );
  const configCreated = !loadResult.snapshot.exists;
  const suggestions = await detectEvalSuggestions(root, environment);
  const shouldSeed =
    configCreated || defaultStatus || loadResult.config.length === 0;
  const refreshPlaceholders =
    !shouldSeed && isPlaceholderConfig(loadResult.config);

  let nextEntries = loadResult.config;
  let configUpdated = false;

  if (shouldSeed) {
    const seededEntries = await buildSeedEntries(suggestions, options);
    const hasConfiguredEntries = seededEntries.some((entry) =>
      Boolean(normalizeEvalCommand(entry.command)),
    );
    const hasExistingContent =
      loadResult.snapshot.exists && loadResult.snapshot.normalized.length > 0;

    if (!hasConfiguredEntries && hasExistingContent) {
      nextEntries = loadResult.config;
    } else {
      const serialized = hasConfiguredEntries
        ? serializeEvalConfig(seededEntries)
        : defaultTemplate;
      configUpdated = await persistYamlConfig({
        filePath,
        serialized,
        original: loadResult.snapshot,
        defaultTemplate,
        isDefaultTemplate: defaultStatus,
      });
      nextEntries = seededEntries;
    }
  } else if (refreshPlaceholders) {
    const refreshed = await refreshExistingEntries(
      loadResult.config,
      suggestions,
      options,
    );
    if (refreshed.changed) {
      const serialized = serializeEvalConfig(refreshed.entries);
      configUpdated = await persistYamlConfig({
        filePath,
        serialized,
        original: loadResult.snapshot,
        defaultTemplate,
        isDefaultTemplate: defaultStatus,
      });
      nextEntries = refreshed.entries;
    }
  }

  return buildEvalSummary(nextEntries, configCreated, configUpdated);
}

function buildEvalSummary(
  entries: readonly EvalCommandEntry[],
  configCreated: boolean,
  configUpdated: boolean,
): EvalInitSummary {
  const enabled = entries
    .filter((entry) => {
      const normalized = normalizeEvalCommand(entry.command);
      if (!normalized) {
        return false;
      }
      return normalized !== buildPlaceholderCommand(entry.slug);
    })
    .map((entry) => entry.slug);

  return {
    configPath: EVALS_CONFIG_DISPLAY_PATH,
    configuredEvals: enabled,
    configCreated,
    configUpdated,
  };
}

async function buildSeedEntries(
  suggestions: EvalSuggestion[],
  options: InitConfigureOptions,
): Promise<EvalCommandEntry[]> {
  const combined = combineSuggestionCommands(suggestions);
  const firstPrompt = { value: true };
  const entries: EvalCommandEntry[] = [];

  for (const slug of CANONICAL_EVAL_SLUGS) {
    const proposed = combined.get(slug);
    const command = await resolveCommandChoice({
      slug,
      proposed,
      options,
      firstPrompt,
    });
    entries.push({ slug, command });
  }

  return entries;
}

async function refreshExistingEntries(
  entries: EvalsConfig,
  suggestions: EvalSuggestion[],
  options: InitConfigureOptions,
): Promise<{ entries: EvalCommandEntry[]; changed: boolean }> {
  const existingBySlug = new Map<EvalSlug, EvalCommandEntry>();
  const extras: EvalCommandEntry[] = [];
  for (const entry of entries) {
    if (CANONICAL_EVAL_SLUGS.includes(entry.slug)) {
      existingBySlug.set(entry.slug, { ...entry });
    } else {
      extras.push({ ...entry });
    }
  }

  const combined = combineSuggestionCommands(suggestions);
  const firstPrompt = { value: true };
  let changed = false;
  const updatedCanonical: EvalCommandEntry[] = [];

  for (const slug of CANONICAL_EVAL_SLUGS) {
    const prior = existingBySlug.get(slug);
    const proposed = combined.get(slug);
    const resolved = await resolveCommandChoice({
      slug,
      proposed,
      options,
      firstPrompt,
      existing: prior?.command,
    });
    if (!prior || prior.command !== resolved) {
      changed = true;
    }
    updatedCanonical.push({ slug, command: resolved });
  }

  const resultEntries = [...updatedCanonical, ...extras];
  return { entries: resultEntries, changed };
}

function combineSuggestionCommands(
  suggestions: EvalSuggestion[],
): Map<EvalSlug, string | undefined> {
  const combined = new Map<EvalSlug, string[]>();

  for (const suggestion of suggestions) {
    for (const [slug, command] of suggestion.commands) {
      const list = combined.get(slug);
      if (!list) {
        combined.set(slug, [command]);
        continue;
      }
      if (!list.includes(command)) {
        list.push(command);
      }
    }
  }

  const resolved = new Map<EvalSlug, string | undefined>();
  for (const slug of CANONICAL_EVAL_SLUGS) {
    const entries = combined.get(slug);
    if (!entries || entries.length === 0) {
      resolved.set(slug, undefined);
      continue;
    }
    resolved.set(slug, entries.join(" && "));
  }
  return resolved;
}

async function resolveCommandChoice(params: {
  slug: EvalSlug;
  proposed: string | undefined;
  options: InitConfigureOptions;
  firstPrompt: { value: boolean };
  existing?: string;
}): Promise<string | undefined> {
  const { slug, proposed, options, firstPrompt, existing } = params;
  const normalizedExisting = normalizeEvalCommand(existing);
  const normalizedProposed = normalizeEvalCommand(proposed);

  if (!normalizedProposed) {
    return normalizedExisting;
  }

  if (!options.interactive || !options.confirm) {
    return normalizedProposed;
  }

  const prefaceLines = renderEvalCommandPreface({
    commandName: slug,
    commandText: normalizedProposed,
    firstPrompt: firstPrompt.value,
  });

  const defaultValue =
    normalizedExisting !== undefined
      ? normalizedExisting === normalizedProposed
      : true;

  const accepted = await options.confirm({
    message: "Enable?",
    defaultValue,
    prefaceLines,
  });
  firstPrompt.value = false;

  return accepted ? normalizedProposed : normalizedExisting;
}

function isPlaceholderConfig(entries: EvalsConfig): boolean {
  if (entries.length === 0) {
    return true;
  }

  const canonical = entries.filter((entry) =>
    CANONICAL_EVAL_SLUGS.includes(entry.slug),
  );

  if (canonical.length !== CANONICAL_EVAL_SLUGS.length) {
    return false;
  }

  const nonCanonical = entries.some(
    (entry) => !CANONICAL_EVAL_SLUGS.includes(entry.slug),
  );
  if (nonCanonical) {
    return false;
  }

  return canonical.every((entry) => {
    const normalized = normalizeEvalCommand(entry.command);
    return (
      normalized === undefined ||
      normalized === buildPlaceholderCommand(entry.slug)
    );
  });
}

function serializeEvalConfig(entries: readonly EvalCommandEntry[]): string {
  const lines: string[] = [];

  for (const entry of entries) {
    const command = normalizeEvalCommand(entry.command);
    if (!command) {
      lines.push(`${entry.slug}:`);
      continue;
    }
    if (
      command.includes("#") ||
      command.includes(": ") ||
      command.includes('"')
    ) {
      const escaped = command.replace(/"/g, '\\"');
      lines.push(`${entry.slug}: "${escaped}"`);
    } else if (command.includes(" ") || command.includes(":")) {
      lines.push(`${entry.slug}: "${command}"`);
    } else {
      lines.push(`${entry.slug}: ${command}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function buildPlaceholderCommand(slug: EvalSlug): string {
  return PLACEHOLDER_TEMPLATE.replace("%slug%", slug);
}
