export interface SandboxNetworkConfig {
  allowedDomains: string[];
  deniedDomains: string[];
  allowLocalBinding: boolean;
  allowUnixSockets?: string[];
  allowAllUnixSockets?: boolean;
}

export interface DenialBackoffConfig {
  enabled: boolean;
  warningThreshold: number;
  delayThreshold: number;
  delayMs: number;
  failFastThreshold: number;
  windowMs: number;
}

export interface SandboxFilesystemConfig {
  allowWrite: string[];
  denyRead: string[];
  denyWrite: string[];
}

export interface SandboxProviderConfig {
  providerId: string;
  network: SandboxNetworkConfig;
  filesystem: SandboxFilesystemConfig;
  denialBackoff: DenialBackoffConfig;
}

export interface SandboxConfig {
  filePath: string;
  displayPath: string;
  providers: Record<string, SandboxProviderConfig>;
}

export interface LoadSandboxConfigurationOptions {
  root?: string;
  filePath?: string;
  readFile?: (path: string) => string;
  disableCache?: boolean;
}

export interface LoadSandboxNetworkConfigOptions
  extends LoadSandboxConfigurationOptions {
  providerId: string;
}

export interface LoadSandboxProviderConfigOptions
  extends LoadSandboxConfigurationOptions {
  providerId: string;
}
