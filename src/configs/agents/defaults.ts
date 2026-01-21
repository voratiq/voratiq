import { sanitizeSlug } from "../../utils/slug.js";

export const MODEL_PLACEHOLDER = "{{MODEL}}" as const;

export interface AgentDefault {
  readonly provider: string;
  readonly model: string;
  readonly argv: readonly string[];
}

export function sanitizeAgentIdFromModel(model: string): string {
  const sanitized = sanitizeSlug(model);
  if (!sanitized) {
    throw new Error(
      `Unable to derive agent id from model "${model}". Provide a model slug with at least one alphanumeric character.`,
    );
  }
  return sanitized;
}

export const DEFAULT_AGENT_DEFAULTS: readonly AgentDefault[] = [
  {
    provider: "claude",
    model: "claude-opus-4-5-20251101",
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

export function getDefaultAgentIdByProvider(
  provider: string,
): string | undefined {
  const entry = AGENT_DEFAULTS_BY_PROVIDER.get(provider);
  return entry ? sanitizeAgentIdFromModel(entry.model) : undefined;
}

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
