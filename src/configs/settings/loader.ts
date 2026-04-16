import process from "node:process";

import { parseYamlDocument } from "../../utils/yaml-reader.js";
import { resolveWorkspacePath } from "../../workspace/path-resolvers.js";
import { createConfigLoader } from "../shared/loader-factory.js";
import { type RepoSettings, repoSettingsSchema } from "./types.js";

const SETTINGS_CONFIG_FILENAME = "settings.yaml" as const;

export interface LoadRepoSettingsOptions {
  root?: string;
  filePath?: string;
  readFile?: (path: string) => string;
}

const DEFAULT_SETTINGS: RepoSettings = {
  bounded: {
    codex: {
      globalConfigPolicy: "ignore",
    },
  },
  mcp: {
    codex: "ask",
    claude: "ask",
    gemini: "ask",
  },
};

function cloneSettings(settings: RepoSettings): RepoSettings {
  return {
    bounded: {
      codex: {
        globalConfigPolicy: settings.bounded.codex.globalConfigPolicy,
      },
    },
    mcp: {
      codex: settings.mcp.codex,
      claude: settings.mcp.claude,
      gemini: settings.mcp.gemini,
    },
  };
}

const repoSettingsLoader = createConfigLoader<
  RepoSettings,
  LoadRepoSettingsOptions
>({
  resolveFilePath: (root, options) =>
    options.filePath ?? resolveWorkspacePath(root, SETTINGS_CONFIG_FILENAME),
  selectReadFile: (options) => options.readFile,
  handleMissing: () => cloneSettings(DEFAULT_SETTINGS),
  parse: (content, context) => {
    const parsed = parseSettingsYaml(content, context);
    const { bounded, mcp } = parsed;
    return {
      bounded: {
        codex: {
          globalConfigPolicy:
            bounded?.codex?.globalConfigPolicy ??
            DEFAULT_SETTINGS.bounded.codex.globalConfigPolicy,
        },
      },
      mcp: {
        codex: mcp?.codex ?? "ask",
        claude: mcp?.claude ?? "ask",
        gemini: mcp?.gemini ?? "ask",
      },
    };
  },
});

export function loadRepoSettings(
  options: LoadRepoSettingsOptions = {},
): RepoSettings {
  const root = options.root ?? process.cwd();
  return repoSettingsLoader({ ...options, root });
}

function parseSettingsYaml(
  content: string,
  context: { filePath: string },
): {
  bounded?: { codex?: { globalConfigPolicy?: "ignore" | "apply" } };
  mcp?: {
    codex?: "ask" | "never";
    claude?: "ask" | "never";
    gemini?: "ask" | "never";
  };
} {
  let document: unknown;
  try {
    document = parseYamlDocument(content, {
      formatError: (detail) => {
        const reason = detail.reason ?? detail.message ?? "Unknown YAML error";
        return new Error(reason);
      },
      emptyValue: {},
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown YAML error";
    throw new Error(
      `Invalid settings file at ${context.filePath}: ${message.replace(/\s+/gu, " ").trim()}`,
    );
  }

  const result = repoSettingsSchema.safeParse(document);
  if (!result.success) {
    const issue = result.error.issues[0];
    const detail = issue?.message ? issue.message : "Invalid settings value";
    throw new Error(`Invalid settings file at ${context.filePath}: ${detail}`);
  }
  return result.data;
}
