import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import type { AgentPreset } from "../configs/agents/defaults.js";
import {
  getAgentDefaultId,
  getSupportedAgentDefaults,
} from "../configs/agents/defaults.js";
import { readAgentsConfig } from "../configs/agents/loader.js";
import type { AgentConfigEntry } from "../configs/agents/types.js";
import { isFileSystemError } from "../utils/fs.js";
import { normalizeConfigText } from "../utils/yaml.js";
import {
  resolveWorkspacePath,
  VORATIQ_MANAGED_STATE_FILE,
} from "./structure.js";
import { serializeAgentsConfigEntries } from "./templates.js";

export const MANAGED_STATE_VERSION = 1;

export interface ManagedConfigFingerprint {
  fingerprint: string;
}

export interface ManagedAgentsFingerprint extends ManagedConfigFingerprint {
  managedEntriesFingerprint: string;
}

export interface ManagedOrchestrationFingerprint extends ManagedConfigFingerprint {
  preset: AgentPreset;
}

export interface ManagedStateSnapshot {
  version: number;
  configs: {
    agents?: ManagedAgentsFingerprint;
    orchestration?: ManagedOrchestrationFingerprint;
  };
}

export interface UpdateManagedStateOptions {
  agentsContent?: string;
  orchestrationContent?: string;
  orchestrationPreset?: AgentPreset;
}

export async function readManagedState(
  root: string,
): Promise<ManagedStateSnapshot | undefined> {
  const path = resolveWorkspacePath(root, VORATIQ_MANAGED_STATE_FILE);

  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content) as ManagedStateSnapshot;
  } catch (error) {
    if (isFileSystemError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function updateManagedState(
  root: string,
  options: UpdateManagedStateOptions,
): Promise<{ path: string; created: boolean; updated: boolean }> {
  const path = resolveWorkspacePath(root, VORATIQ_MANAGED_STATE_FILE);
  const existing = await readManagedState(root);
  const next = existing
    ? {
        ...existing,
        version: MANAGED_STATE_VERSION,
        configs: { ...existing.configs },
      }
    : { version: MANAGED_STATE_VERSION, configs: {} };

  if (options.agentsContent !== undefined) {
    next.configs.agents = {
      fingerprint: computeManagedFingerprint(options.agentsContent),
      managedEntriesFingerprint: computeManagedAgentsEntriesFingerprint(
        options.agentsContent,
      ),
    };
  }

  if (options.orchestrationContent !== undefined) {
    next.configs.orchestration = {
      fingerprint: computeManagedFingerprint(options.orchestrationContent),
      preset: options.orchestrationPreset ?? "pro",
    };
  }

  const serialized = serializeManagedState(next);
  const previousSerialized = existing ? serializeManagedState(existing) : "";

  if (serialized === previousSerialized) {
    return { path, created: false, updated: false };
  }

  await writeFile(path, serialized, "utf8");
  return {
    path,
    created: existing === undefined,
    updated: true,
  };
}

export function computeManagedFingerprint(content: string): string {
  return createHash("sha256")
    .update(normalizeConfigText(content), "utf8")
    .digest("hex");
}

export function isManagedFingerprintMatch(
  fingerprint: ManagedConfigFingerprint | undefined,
  content: string,
): boolean {
  if (!fingerprint) {
    return false;
  }

  return fingerprint.fingerprint === computeManagedFingerprint(content);
}

export function isManagedAgentsFingerprintMatch(
  fingerprint: ManagedAgentsFingerprint | undefined,
  content: string,
): boolean {
  if (!fingerprint) {
    return false;
  }

  return (
    fingerprint.fingerprint === computeManagedFingerprint(content) ||
    fingerprint.managedEntriesFingerprint ===
      computeManagedAgentsEntriesFingerprint(content)
  );
}

function serializeManagedState(state: ManagedStateSnapshot): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

function computeManagedAgentsEntriesFingerprint(content: string): string {
  const config = readAgentsConfig(content);
  const entriesById = new Map<string, AgentConfigEntry>();
  for (const entry of config.agents) {
    entriesById.set(entry.id, normalizeAgentEntry(entry));
  }

  const managedEntries = getSupportedAgentDefaults()
    .map((template) => entriesById.get(getAgentDefaultId(template)))
    .filter((entry): entry is AgentConfigEntry => entry !== undefined);

  return createHash("sha256")
    .update(
      normalizeConfigText(
        `agents:\n${serializeAgentsConfigEntries(managedEntries)}`,
      ),
      "utf8",
    )
    .digest("hex");
}

function normalizeAgentEntry(entry: AgentConfigEntry): AgentConfigEntry {
  return {
    id: entry.id,
    provider: entry.provider,
    model: entry.model,
    enabled: entry.enabled !== false,
    binary: entry.binary ?? "",
    extraArgs:
      entry.extraArgs && entry.extraArgs.length > 0
        ? [...entry.extraArgs]
        : undefined,
  };
}
