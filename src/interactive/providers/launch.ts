import { injectPromptArg } from "../../agents/runtime/shim/argv.js";
import type { AgentDefinition } from "../../configs/agents/types.js";
import type { NativeToolDeclaration, ToolAttachmentStatus } from "../types.js";
import type { FirstPartyMcpStatusAndArgs } from "./mcp.js";
import { BUNDLED_VORATIQ_TOOL_TARGET_NAME } from "./shared.js";

export interface ProviderLaunchPreparationInput {
  providerId: string;
  agent: AgentDefinition;
  root: string;
  toolDeclarations: readonly NativeToolDeclaration[];
  prompt?: string;
  launchMode?: "default" | "first-party";
  firstPartyMcpResolution?: FirstPartyMcpStatusAndArgs;
}

export interface ProviderLaunchPreparationResult {
  args: string[];
  env: Record<string, string>;
  toolAttachmentStatus: ToolAttachmentStatus;
  artifactCaptureSupported: boolean;
}

interface ProviderLaunchAdapter {
  prepare(
    options: ProviderLaunchPreparationInput,
  ): Promise<ProviderLaunchPreparationResult>;
}

const providerLaunchAdapters: Record<string, ProviderLaunchAdapter> = {
  codex: { prepare: prepareCodexLaunch },
  claude: { prepare: prepareClaudeLaunch },
  gemini: { prepare: prepareGeminiLaunch },
};

export function createBundledVoratiqToolDeclaration(options: {
  command: string;
  argsPrefix: readonly string[];
}): NativeToolDeclaration {
  return {
    name: BUNDLED_VORATIQ_TOOL_TARGET_NAME,
    command: options.command,
    args: [...options.argsPrefix, "mcp", "--stdio"],
  };
}

export async function prepareProviderNativeLaunch(
  options: ProviderLaunchPreparationInput,
): Promise<ProviderLaunchPreparationResult> {
  const adapter = providerLaunchAdapters[options.providerId] ?? {
    prepare: prepareGenericLaunch,
  };
  return await adapter.prepare(options);
}

function prepareCodexLaunch(
  options: ProviderLaunchPreparationInput,
): Promise<ProviderLaunchPreparationResult> {
  const args = applyPositionalPrompt(
    applyNativeQaLaunchArgs("codex", sanitizeCodexArgs(options.agent)),
    options.prompt,
  );

  const mcp = resolveFirstPartyMcpStatusAndArgs({
    launchMode: options.launchMode,
    toolDeclarations: options.toolDeclarations,
    firstPartyMcpResolution: options.firstPartyMcpResolution,
  });

  return Promise.resolve({
    args: [...args, ...mcp.additionalArgs],
    env: {},
    toolAttachmentStatus: mcp.toolAttachmentStatus,
    artifactCaptureSupported: true,
  });
}

function prepareClaudeLaunch(
  options: ProviderLaunchPreparationInput,
): Promise<ProviderLaunchPreparationResult> {
  const args = applyPositionalPrompt(
    sanitizeClaudeArgs(options.agent),
    options.prompt,
  );

  const mcp = resolveFirstPartyMcpStatusAndArgs({
    launchMode: options.launchMode,
    toolDeclarations: options.toolDeclarations,
    firstPartyMcpResolution: options.firstPartyMcpResolution,
  });

  return Promise.resolve({
    args: [...args, ...mcp.additionalArgs],
    env: {},
    toolAttachmentStatus: mcp.toolAttachmentStatus,
    artifactCaptureSupported: true,
  });
}

function prepareGeminiLaunch(
  options: ProviderLaunchPreparationInput,
): Promise<ProviderLaunchPreparationResult> {
  const args = applyGeminiLaunchPrompt(
    applyNativeQaLaunchArgs("gemini", sanitizeGeminiArgs(options.agent)),
    options.prompt,
  );

  const mcp = resolveFirstPartyMcpStatusAndArgs({
    launchMode: options.launchMode,
    toolDeclarations: options.toolDeclarations,
    firstPartyMcpResolution: options.firstPartyMcpResolution,
  });

  return Promise.resolve({
    args,
    env: {},
    toolAttachmentStatus: mcp.toolAttachmentStatus,
    artifactCaptureSupported: true,
  });
}

function prepareGenericLaunch(
  options: ProviderLaunchPreparationInput,
): Promise<ProviderLaunchPreparationResult> {
  return Promise.resolve({
    args: applyPositionalPrompt(
      ensureModelArg(options.agent.argv, options.agent.model),
      options.prompt,
    ),
    env: {},
    toolAttachmentStatus:
      options.toolDeclarations.length > 0 ? "failed" : "not-requested",
    artifactCaptureSupported: false,
  });
}

function resolveFirstPartyMcpStatusAndArgs(options: {
  launchMode?: "default" | "first-party";
  toolDeclarations: readonly NativeToolDeclaration[];
  firstPartyMcpResolution?: FirstPartyMcpStatusAndArgs;
}): FirstPartyMcpStatusAndArgs {
  if (options.launchMode !== "first-party") {
    return {
      toolAttachmentStatus:
        options.toolDeclarations.length > 0 ? "failed" : "not-requested",
      additionalArgs: [],
    };
  }

  if (options.toolDeclarations.length === 0) {
    return {
      toolAttachmentStatus: "not-requested",
      additionalArgs: [],
    };
  }

  return (
    options.firstPartyMcpResolution ?? {
      toolAttachmentStatus: "failed",
      additionalArgs: [],
    }
  );
}

function sanitizeCodexArgs(agent: AgentDefinition): string[] {
  const sanitized: string[] = [];
  for (let index = 0; index < agent.argv.length; index += 1) {
    const token = agent.argv[index] ?? "";
    if (token === "exec" && index === 0) {
      continue;
    }
    if (token === "--experimental-json") {
      continue;
    }
    if (token === "--dangerously-bypass-approvals-and-sandbox") {
      continue;
    }
    if (token === "-c") {
      index += 1;
      continue;
    }
    sanitized.push(token);
  }
  return ensureModelArg(sanitized, agent.model);
}

function sanitizeClaudeArgs(agent: AgentDefinition): string[] {
  const sanitized: string[] = [];
  for (let index = 0; index < agent.argv.length; index += 1) {
    const token = agent.argv[index] ?? "";
    if (token === "--output-format") {
      index += 1;
      continue;
    }
    if (token === "--dangerously-skip-permissions") {
      continue;
    }
    if (token === "-p" || token === "--prompt") {
      const next = agent.argv[index + 1] ?? "";
      if (next && !next.startsWith("-")) {
        index += 1;
      }
      continue;
    }
    sanitized.push(token);
  }
  return ensureModelArg(sanitized, agent.model);
}

function sanitizeGeminiArgs(agent: AgentDefinition): string[] {
  const sanitized: string[] = [];
  for (let index = 0; index < agent.argv.length; index += 1) {
    const token = agent.argv[index] ?? "";
    if (token === "--output-format") {
      index += 1;
      continue;
    }
    if (token === "--yolo") {
      continue;
    }
    sanitized.push(token);
  }
  return ensureModelArg(sanitized, agent.model);
}

function ensureModelArg(argv: readonly string[], model: string): string[] {
  const sanitized = [...argv];
  for (let index = 0; index < sanitized.length; index += 1) {
    const token = sanitized[index] ?? "";
    if (token !== "--model") {
      continue;
    }
    if (!sanitized[index + 1]) {
      sanitized[index + 1] = model;
    }
    return sanitized;
  }

  sanitized.push("--model", model);
  return sanitized;
}

function applyPositionalPrompt(
  argv: readonly string[],
  prompt: string | undefined,
): string[] {
  if (!prompt || prompt.trim().length === 0) {
    return [...argv];
  }
  return injectPromptArg(argv, prompt);
}

function applyGeminiLaunchPrompt(
  argv: readonly string[],
  prompt: string | undefined,
): string[] {
  const qaInitialPrompt =
    process.env.VORATIQ_QA_NATIVE_LAUNCH === "1"
      ? process.env.VORATIQ_QA_INITIAL_PROMPT?.trim()
      : undefined;
  const combinedPrompt = [prompt?.trim(), qaInitialPrompt]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join("\n\n");

  if (combinedPrompt.length === 0) {
    return [...argv];
  }

  if (qaInitialPrompt && qaInitialPrompt.length > 0) {
    return [...argv, "--prompt-interactive", combinedPrompt];
  }

  return injectPromptArg(argv, combinedPrompt);
}

function applyNativeQaLaunchArgs(
  providerId: "codex" | "claude" | "gemini",
  argv: readonly string[],
): string[] {
  if (process.env.VORATIQ_QA_NATIVE_LAUNCH !== "1") {
    return [...argv];
  }

  const nextArgv = [...argv];
  switch (providerId) {
    case "codex":
      if (!nextArgv.includes("--no-alt-screen")) {
        nextArgv.push("--no-alt-screen");
      }
      break;
    case "gemini":
      if (!nextArgv.includes("--screen-reader")) {
        nextArgv.push("--screen-reader");
      }
      break;
    default:
      break;
  }
  return nextArgv;
}
