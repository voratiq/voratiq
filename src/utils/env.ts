const DEFAULT_ALLOWED_VARIABLES = [
  "CI",
  "COLUMNS",
  "HOME",
  "HOSTNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "NODE_OPTIONS",
  "PATH",
  "PWD",
  "SHELL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "TERM",
  "TMP",
  "TMPDIR",
  "TEMP",
  "TZ",
  "USER",
  "USERNAME",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
] as const;

const DEFAULT_ALLOWED_PREFIXES = ["LC_", "VORATIQ_", "SRT_"] as const;

export interface EnvironmentFilterOptions {
  allow?: readonly string[];
  prefixes?: readonly string[];
}

export interface ComposeEnvironmentOptions extends EnvironmentFilterOptions {
  base?: NodeJS.ProcessEnv;
  includeBase?: boolean;
}

export function composeRestrictedEnvironment(
  overrides?: NodeJS.ProcessEnv,
  options: ComposeEnvironmentOptions = {},
): NodeJS.ProcessEnv {
  const includeBase = options.includeBase ?? true;
  const baseEnv = includeBase
    ? filterEnvironmentVariables(options.base ?? process.env, options)
    : {};
  return overrides ? { ...baseEnv, ...overrides } : baseEnv;
}

export function filterEnvironmentVariables(
  source: NodeJS.ProcessEnv,
  options: EnvironmentFilterOptions = {},
): NodeJS.ProcessEnv {
  const allowedKeys = new Set(options.allow ?? DEFAULT_ALLOWED_VARIABLES);
  const allowedPrefixes = options.prefixes ?? DEFAULT_ALLOWED_PREFIXES;
  const filtered: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }
    if (allowedKeys.has(key)) {
      filtered[key] = value;
      continue;
    }
    if (allowedPrefixes.some((prefix) => key.startsWith(prefix))) {
      filtered[key] = value;
    }
  }

  return filtered;
}
