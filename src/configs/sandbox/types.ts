export interface SandboxNetworkConfig {
  allowedDomains: string[];
  deniedDomains: string[];
  allowLocalBinding: boolean;
  allowUnixSockets?: string[];
  allowAllUnixSockets?: boolean;
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
