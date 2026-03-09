export interface AgentManifest {
  binary: string;
  argv: string[];
  promptPath: string;
  workspace: string;
  env: Record<string, string>;
}
