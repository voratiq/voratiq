import process from "node:process";

import { parseYamlDocument } from "../../utils/yaml-reader.js";
import { resolveWorkspacePath } from "../../workspace/structure.js";
import { createConfigLoader } from "../shared/loader-factory.js";
import { type RepoSettings, repoSettingsSchema } from "./types.js";

const SETTINGS_CONFIG_FILENAME = "settings.yaml" as const;

export interface LoadRepoSettingsOptions {
  root?: string;
  filePath?: string;
  readFile?: (path: string) => string;
}

const DEFAULT_SETTINGS: RepoSettings = {
  codex: {
    globalConfigPolicy: "apply",
  },
};

function cloneSettings(settings: RepoSettings): RepoSettings {
  return {
    codex: { globalConfigPolicy: settings.codex.globalConfigPolicy },
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
  parse: (content) => {
    const parsed = safeParseSettingsYaml(content);
    if (!parsed) {
      return cloneSettings(DEFAULT_SETTINGS);
    }

    const { codex } = parsed;
    return {
      codex: {
        globalConfigPolicy: codex?.globalConfigPolicy ?? "apply",
      },
    };
  },
});

export function loadRepoSettings(
  options: LoadRepoSettingsOptions = {},
): RepoSettings {
  const root = options.root ?? process.cwd();
  try {
    return repoSettingsLoader({ ...options, root });
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

function safeParseSettingsYaml(content: string): {
  codex?: { globalConfigPolicy?: "ignore" | "apply" };
} | null {
  let document: unknown;
  try {
    document = parseYamlDocument(content, {
      formatError: (detail) => {
        const reason = detail.reason ?? detail.message ?? "Unknown YAML error";
        return new Error(reason);
      },
      emptyValue: {},
    });
  } catch {
    return null;
  }

  const result = repoSettingsSchema.safeParse(document);
  if (!result.success) {
    return null;
  }
  return result.data;
}
