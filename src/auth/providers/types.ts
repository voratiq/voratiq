export interface AuthRuntimeContext {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  username: string;
}

export interface VerifyOptions {
  agentId: string;
  runtime: AuthRuntimeContext;
}

export interface VerifyResult {
  status: "ok";
}

export interface StageOptions extends VerifyOptions {
  agentRoot: string;
  runId?: string;
  root?: string;
}

export interface StageResult {
  sandboxPath: string;
  env: Record<string, string>;
}

export interface TeardownOptions {
  sandboxPath: string;
}

export interface AuthProvider {
  readonly id: string;
  verify(options: VerifyOptions): Promise<VerifyResult>;
  stage(options: StageOptions): Promise<StageResult>;
  teardown?(options: TeardownOptions): Promise<void>;
}
