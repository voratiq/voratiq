export interface SandboxProviderNetworkDefaults {
  readonly allowedDomains: readonly string[];
  readonly deniedDomains: readonly string[];
  readonly allowLocalBinding: boolean;
  readonly allowUnixSockets?: readonly string[];
  readonly allowAllUnixSockets?: boolean;
}

export interface SandboxProviderDefault {
  readonly id: string;
  readonly network: SandboxProviderNetworkDefaults;
}

export const DEFAULT_SANDBOX_PROVIDERS: readonly SandboxProviderDefault[] = [
  {
    id: "claude",
    network: {
      allowedDomains: ["api.anthropic.com", "console.anthropic.com"],
      deniedDomains: [],
      allowLocalBinding: false,
    },
  },
  {
    id: "codex",
    network: {
      allowedDomains: ["api.openai.com", "chatgpt.com"],
      deniedDomains: [],
      allowLocalBinding: false,
    },
  },
  {
    id: "gemini",
    network: {
      allowedDomains: [
        "oauth2.googleapis.com",
        "cloudcode-pa.googleapis.com",
        "play.googleapis.com",
        "generativelanguage.googleapis.com",
      ],
      deniedDomains: [],
      allowLocalBinding: false,
    },
  },
] as const;

const SANDBOX_PROVIDER_IDS = DEFAULT_SANDBOX_PROVIDERS.map(
  (provider) => provider.id,
);

export function listSandboxProviderDefaults(): SandboxProviderDefault[] {
  return DEFAULT_SANDBOX_PROVIDERS.map(cloneSandboxProviderDefault);
}

export function listSandboxProviderIds(): readonly string[] {
  return SANDBOX_PROVIDER_IDS;
}

function cloneSandboxProviderDefault(
  provider: SandboxProviderDefault,
): SandboxProviderDefault {
  return {
    id: provider.id,
    network: {
      allowedDomains: [...provider.network.allowedDomains],
      deniedDomains: [...provider.network.deniedDomains],
      allowLocalBinding: provider.network.allowLocalBinding,
      ...(provider.network.allowUnixSockets
        ? { allowUnixSockets: [...provider.network.allowUnixSockets] }
        : {}),
      ...(typeof provider.network.allowAllUnixSockets === "boolean"
        ? { allowAllUnixSockets: provider.network.allowAllUnixSockets }
        : {}),
    },
  };
}
