export const MODEL_PLACEHOLDER = "{{MODEL}}" as const;

export interface AgentDefault {
  readonly provider: string;
  readonly model: string;
  readonly argv: readonly string[];
}

export function sanitizeAgentIdFromModel(model: string): string {
  const lowered = model.toLowerCase();
  const replaced = lowered.replace(/[^a-z0-9]+/g, "-");
  const collapsed = replaced.replace(/-+/g, "-");
  const trimmed = collapsed.replace(/^-+/u, "").replace(/-+$/u, "");
  if (!trimmed) {
    throw new Error(
      `Unable to derive agent id from model "${model}". Provide a model slug with at least one alphanumeric character.`,
    );
  }
  return trimmed;
}

export const DEFAULT_AGENT_DEFAULTS: readonly AgentDefault[] = [
  {
    provider: "claude",
    model: "claude-sonnet-4-5-20250929",
    argv: [
      "--model",
      MODEL_PLACEHOLDER,
      "--output-format",
      "json",
      "--dangerously-skip-permissions",
      "-p",
    ],
  },
  {
    provider: "codex",
    model: "gpt-5.2-codex",
    argv: [
      "exec",
      "--model",
      MODEL_PLACEHOLDER,
      "--experimental-json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-c",
      "mcp_servers={}",
    ],
  },
  {
    provider: "gemini",
    model: "gemini-2.5-pro",
    argv: ["--model", MODEL_PLACEHOLDER, "--output-format", "json", "--yolo"],
  },
] as const;

const AGENT_DEFAULTS_BY_PROVIDER = new Map(
  DEFAULT_AGENT_DEFAULTS.map(
    (agentDefault) => [agentDefault.provider, agentDefault] as const,
  ),
);

export function getAgentDefault(provider: string): AgentDefault | undefined {
  const agentDefault = AGENT_DEFAULTS_BY_PROVIDER.get(provider);
  return agentDefault ? cloneAgentDefault(agentDefault) : undefined;
}

function cloneAgentDefault(agentDefault: AgentDefault): AgentDefault {
  return {
    provider: agentDefault.provider,
    model: agentDefault.model,
    argv: [...agentDefault.argv],
  };
}
