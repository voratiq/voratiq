import process from "node:process";

import { assertTestHookRegistrationEnabled } from "../../testing/test-hooks.js";
import { relativeToRoot } from "../../utils/path.js";
import {
  parseYamlDocument,
  type YamlParseErrorDetail,
} from "../../utils/yaml-reader.js";
import {
  resolveWorkspacePath,
  VORATIQ_SANDBOX_FILE,
} from "../../workspace/structure.js";
import { createConfigLoader } from "../shared/loader-factory.js";
import { formatYamlErrorMessage } from "../shared/yaml-error-formatter.js";
import {
  listSandboxProviderDefaults,
  listSandboxProviderIds,
} from "./defaults.js";
import {
  DEFAULT_SANDBOX_ERROR_CONTEXT,
  SandboxConfigurationError,
} from "./errors.js";
import {
  extractFilesystemOverride,
  extractNetworkOverride,
  mergeFilesystemConfig,
  mergeNetworkConfig,
} from "./merge.js";
import { type ProviderOverride, validateSandboxOverrides } from "./schemas.js";
import type {
  LoadSandboxConfigurationOptions,
  LoadSandboxNetworkConfigOptions,
  LoadSandboxProviderConfigOptions,
  SandboxConfig,
  SandboxFilesystemConfig,
  SandboxNetworkConfig,
  SandboxProviderConfig,
} from "./types.js";
export type {
  LoadSandboxConfigurationOptions,
  LoadSandboxNetworkConfigOptions,
  LoadSandboxProviderConfigOptions,
  SandboxConfig,
  SandboxFilesystemConfig,
  SandboxNetworkConfig,
  SandboxProviderConfig,
} from "./types.js";

const configCache = new Map<string, SandboxConfig>();

const DEFAULT_FILESYSTEM_CONFIG: SandboxFilesystemConfig = {
  allowWrite: [],
  denyRead: [],
  denyWrite: [],
};

const sandboxConfigLoader = createConfigLoader<
  SandboxConfig,
  LoadSandboxConfigurationOptions
>({
  resolveFilePath: (root, options) => resolveSandboxFilePath(root, options),
  selectReadFile: (options) => options.readFile,
  handleMissing: ({ root, filePath }) => {
    throw new SandboxConfigurationError(
      `Missing sandbox configuration at ${relativeToRoot(root, filePath)}.`,
    );
  },
  prepareContent: (content, { root, filePath }) => {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      throw new SandboxConfigurationError(
        `${DEFAULT_SANDBOX_ERROR_CONTEXT}: ${relativeToRoot(root, filePath)} is empty.`,
      );
    }
    return trimmed;
  },
  parse: (content, context) => {
    const parsedDocument = parseSandboxYaml(
      content,
      context.root,
      context.filePath,
    );
    const overrides = validateSandboxOverrides(
      parsedDocument,
      context.root,
      context.filePath,
    );

    const canonicalProviders = listSandboxProviderDefaults();
    const providerOverrides = overrides.providers;
    const displayPath = relativeToRoot(context.root, context.filePath);

    validateProviderOverrides(providerOverrides, displayPath);

    const providers: Record<string, SandboxProviderConfig> = {};
    for (const canonical of canonicalProviders) {
      const override: ProviderOverride | undefined = getOverride(
        providerOverrides,
        canonical.id,
      );
      const networkOverride = extractNetworkOverride(override);
      const providerNetwork = mergeNetworkConfig(
        canonical.network,
        networkOverride,
      );
      const providerFilesystem = mergeFilesystemConfig(
        DEFAULT_FILESYSTEM_CONFIG,
        extractFilesystemOverride(override),
      );

      if (networkOverride?.allowAllUnixSockets === true) {
        emitAllowAllUnixSocketsWarning(canonical.id, displayPath);
      }

      providers[canonical.id] = {
        providerId: canonical.id,
        network: providerNetwork,
        filesystem: providerFilesystem,
      };
    }

    return {
      filePath: context.filePath,
      displayPath,
      providers,
    };
  },
});

function clearSandboxConfigurationCache(): void {
  configCache.clear();
}

function resolveSandboxFilePath(
  root: string,
  options: LoadSandboxConfigurationOptions,
): string {
  return options.filePath ?? resolveWorkspacePath(root, VORATIQ_SANDBOX_FILE);
}

export function loadSandboxConfiguration(
  options: LoadSandboxConfigurationOptions = {},
): SandboxConfig {
  const root = options.root ?? process.cwd();
  const filePath = resolveSandboxFilePath(root, options);
  const disableCache =
    options.disableCache === true || typeof options.readFile === "function";

  if (!disableCache) {
    const cached = configCache.get(filePath);
    if (cached) {
      return cloneSandboxConfig(cached);
    }
  }

  const loaderOptions: LoadSandboxConfigurationOptions = {
    ...options,
    root,
    filePath,
  };

  const loaded = sandboxConfigLoader(loaderOptions);

  if (!disableCache) {
    configCache.set(filePath, loaded);
  }

  return cloneSandboxConfig(loaded);
}

function loadSandboxNetworkConfig(
  options: LoadSandboxNetworkConfigOptions,
): SandboxNetworkConfig {
  const { providerId } = options;
  const providerConfig = loadSandboxProviderConfig(options, providerId);
  return cloneNetworkConfig(providerConfig.network);
}

export function loadSandboxProviderConfig(
  options: LoadSandboxProviderConfigOptions,
  providerIdOverride?: string,
): SandboxProviderConfig {
  const { providerId } = options;
  const resolvedProviderId = providerIdOverride ?? providerId;
  const config = loadSandboxConfiguration(options);
  const providerConfig = config.providers[resolvedProviderId];

  if (!providerConfig) {
    throw new SandboxConfigurationError(
      `${DEFAULT_SANDBOX_ERROR_CONTEXT}: Unsupported sandbox provider "${resolvedProviderId}" in ${config.displayPath}.`,
    );
  }

  return {
    providerId: providerConfig.providerId,
    network: cloneNetworkConfig(providerConfig.network),
    filesystem: cloneFilesystemConfig(providerConfig.filesystem),
  };
}

const SANDBOX_LOADER_TEST_HOOKS = Symbol.for(
  "voratiq.configs.sandbox.loader.testHooks",
);

type SandboxLoaderTestHooks = {
  clearCache: () => void;
  loadNetworkConfig: (
    options: LoadSandboxNetworkConfigOptions,
  ) => SandboxNetworkConfig;
};

type SandboxLoaderTestHookRegistry = Partial<
  Record<typeof SANDBOX_LOADER_TEST_HOOKS, SandboxLoaderTestHooks>
>;

function registerSandboxLoaderTestHooks(): void {
  const registry = globalThis as SandboxLoaderTestHookRegistry;
  registry[SANDBOX_LOADER_TEST_HOOKS] = {
    clearCache: clearSandboxConfigurationCache,
    loadNetworkConfig: loadSandboxNetworkConfig,
  };
}

let sandboxLoaderTestHooksRegistered = false;

export function enableSandboxLoaderTestHooks(): void {
  assertTestHookRegistrationEnabled("sandbox config loader");
  if (sandboxLoaderTestHooksRegistered) {
    return;
  }
  registerSandboxLoaderTestHooks();
  sandboxLoaderTestHooksRegistered = true;
}

export function areSandboxLoaderTestHooksRegistered(): boolean {
  return sandboxLoaderTestHooksRegistered;
}

function parseSandboxYaml(
  content: string,
  root: string,
  filePath: string,
): unknown {
  const displayPath = relativeToRoot(root, filePath);
  return parseYamlDocument(content, {
    formatError: (detail) => formatSandboxYamlError(detail, displayPath),
  });
}

function formatSandboxYamlError(
  detail: YamlParseErrorDetail,
  displayPath: string,
): SandboxConfigurationError {
  if (!detail.isYamlError) {
    throw detail.error;
  }

  const message = formatYamlErrorMessage(detail, {
    context: DEFAULT_SANDBOX_ERROR_CONTEXT,
    displayPath,
  });
  return new SandboxConfigurationError(`${message}.`);
}

function validateProviderOverrides(
  providerOverrides: Record<string, ProviderOverride>,
  displayPath: string,
): void {
  const supportedProviders = new Set(listSandboxProviderIds());

  for (const providerId of Object.keys(providerOverrides)) {
    if (!supportedProviders.has(providerId)) {
      throw new SandboxConfigurationError(
        `${DEFAULT_SANDBOX_ERROR_CONTEXT}: Unknown provider "${providerId}" in ${displayPath}.`,
      );
    }
  }
}

function getOverride<V>(record: Record<string, V>, key: string): V | undefined {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

function emitAllowAllUnixSocketsWarning(
  providerId: string,
  displayPath: string,
): void {
  process.emitWarning(
    `Sandbox provider "${providerId}" enables allowAllUnixSockets via ${displayPath}. This disables Unix socket isolation for that provider.`,
    { code: "VORATIQ_SANDBOX_ALLOW_ALL_UNIX_SOCKETS" },
  );
}

function cloneSandboxConfig(config: SandboxConfig): SandboxConfig {
  const providers: Record<string, SandboxProviderConfig> = {};
  for (const [providerId, providerConfig] of Object.entries(config.providers)) {
    providers[providerId] = {
      providerId,
      network: cloneNetworkConfig(providerConfig.network),
      filesystem: cloneFilesystemConfig(providerConfig.filesystem),
    };
  }

  return {
    filePath: config.filePath,
    displayPath: config.displayPath,
    providers,
  };
}

function cloneNetworkConfig(
  config: SandboxNetworkConfig,
): SandboxNetworkConfig {
  return {
    allowedDomains: [...config.allowedDomains],
    deniedDomains: [...config.deniedDomains],
    allowLocalBinding: config.allowLocalBinding,
    ...(config.allowUnixSockets && config.allowUnixSockets.length > 0
      ? { allowUnixSockets: [...config.allowUnixSockets] }
      : {}),
    ...(typeof config.allowAllUnixSockets === "boolean"
      ? { allowAllUnixSockets: config.allowAllUnixSockets }
      : {}),
  };
}

function cloneFilesystemConfig(
  config: SandboxFilesystemConfig,
): SandboxFilesystemConfig {
  return {
    allowWrite: [...config.allowWrite],
    denyRead: [...config.denyRead],
    denyWrite: [...config.denyWrite],
  };
}
