import { spawn } from "node:child_process";
import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { loadRepoSettings } from "../../configs/settings/loader.js";
import type {
  NativeToolDeclaration,
  PromptForMcpInstall,
  ProviderMcpCommandInput,
  ProviderMcpCommandResult,
  ProviderMcpCommandRunner,
} from "../types.js";
import {
  BUNDLED_VORATIQ_TOOL_TARGET_NAME,
  type FirstPartyProviderId,
} from "./shared.js";

export interface FirstPartyMcpStatusAndArgs {
  toolAttachmentStatus: "not-requested" | "attached" | "failed";
  additionalArgs: string[];
}

interface FirstPartyMcpAdapter {
  providerCommand: FirstPartyProviderId;
  installPromptMessage: string;
  inspectHintCommand(toolName: string): string;
  inspectTools(options: {
    providerBinary: string;
    root: string;
    toolDeclarations: readonly NativeToolDeclaration[];
    runCommand: ProviderMcpCommandRunner;
  }): Promise<Map<string, FirstPartyMcpToolInspection>>;
  buildAddArgs(tool: NativeToolDeclaration): string[];
}

type FirstPartyMcpInspectionState = "matched" | "missing" | "conflicting";

interface FirstPartyMcpToolInspection {
  state: FirstPartyMcpInspectionState;
  detail?: string;
}

interface FirstPartyMcpInspectionSummary {
  missingToolDeclarations: NativeToolDeclaration[];
  conflict?:
    | {
        tool: NativeToolDeclaration;
        detail?: string;
      }
    | undefined;
}

interface VerifiedFirstPartyMcpStatusOptions {
  adapter: FirstPartyMcpAdapter;
  providerBinary: string;
  root: string;
  toolDeclarations: readonly NativeToolDeclaration[];
  runCommand: ProviderMcpCommandRunner;
}

const FIRST_PARTY_MCP_VERIFY_DELAYS_MS = [
  0, 250, 500, 1_000, 2_000, 4_000, 8_000,
] as const;

const firstPartyMcpAdapters: Record<
  FirstPartyProviderId,
  FirstPartyMcpAdapter
> = {
  codex: {
    providerCommand: "codex",
    installPromptMessage: "Would you like to install the Voratiq MCP?",
    inspectHintCommand: (toolName) => `codex mcp get --json ${toolName}`,
    inspectTools: inspectCodexMcpTools,
    buildAddArgs: buildCodexMcpAddArgs,
  },
  claude: {
    providerCommand: "claude",
    installPromptMessage: "Would you like to install the Voratiq MCP?",
    inspectHintCommand: (toolName) => `claude mcp get ${toolName}`,
    inspectTools: inspectClaudeMcpTools,
    buildAddArgs: buildClaudeMcpAddArgs,
  },
  gemini: {
    providerCommand: "gemini",
    installPromptMessage: "Would you like to install the Voratiq MCP?",
    inspectHintCommand: () => "gemini mcp list",
    inspectTools: inspectGeminiMcpTools,
    buildAddArgs: buildGeminiMcpAddArgs,
  },
};

export async function resolveFirstPartyMcpStatus(options: {
  providerId: FirstPartyProviderId;
  providerBinary?: string;
  root: string;
  toolDeclarations: readonly NativeToolDeclaration[];
  promptForMcpInstall?: PromptForMcpInstall;
  mcpCommandRunner?: ProviderMcpCommandRunner;
}): Promise<FirstPartyMcpStatusAndArgs> {
  if (options.toolDeclarations.length === 0) {
    return {
      toolAttachmentStatus: "not-requested",
      additionalArgs: [],
    };
  }

  const settings = loadRepoSettings({ root: options.root });
  if (settings.mcp[options.providerId] === "never") {
    return {
      toolAttachmentStatus: "failed",
      additionalArgs: [],
    };
  }

  const runCommand = options.mcpCommandRunner ?? runProviderMcpCommand;
  const adapter = firstPartyMcpAdapters[options.providerId];
  const providerBinary = resolveProviderBinary(
    options.providerBinary,
    adapter.providerCommand,
  );
  const initialInspection = summarizeFirstPartyMcpInspection({
    toolDeclarations: options.toolDeclarations,
    inspections: await adapter.inspectTools({
      providerBinary,
      root: options.root,
      toolDeclarations: options.toolDeclarations,
      runCommand,
    }),
  });
  if (initialInspection.conflict) {
    throw new Error(
      buildFirstPartyMcpConflictMessage({
        adapter,
        tool: initialInspection.conflict.tool,
        detail: initialInspection.conflict.detail,
      }),
    );
  }
  if (initialInspection.missingToolDeclarations.length === 0) {
    // Refresh session-scoped env (e.g. VORATIQ_INTERACTIVE_SESSION_ID) on the
    // already-registered MCP entry so the spawned subprocess receives env values
    // that match the current interactive session. The `mcp add` invocation is
    // idempotent across all three providers; the existing inspection only
    // verifies command+args, so we cannot detect env drift otherwise.
    const declarationsWithEnv = options.toolDeclarations.filter(
      (tool) => tool.env && Object.keys(tool.env).length > 0,
    );
    if (declarationsWithEnv.length > 0) {
      await installVoratiqMcpForProvider({
        adapter,
        providerBinary,
        root: options.root,
        toolDeclarations: declarationsWithEnv,
        runCommand,
      });
    }
    return {
      toolAttachmentStatus: "attached",
      additionalArgs: [],
    };
  }

  if (!options.promptForMcpInstall) {
    return {
      toolAttachmentStatus: "failed",
      additionalArgs: [],
    };
  }

  const shouldInstall = await options.promptForMcpInstall({
    providerId: options.providerId,
    message: adapter.installPromptMessage,
    defaultValue: true,
  });
  if (!shouldInstall) {
    return {
      toolAttachmentStatus: "failed",
      additionalArgs: [],
    };
  }

  await installVoratiqMcpForProvider({
    adapter,
    providerBinary,
    root: options.root,
    toolDeclarations: initialInspection.missingToolDeclarations,
    runCommand,
  });

  const verifiedInspection = await verifyFirstPartyMcpStatus({
    adapter,
    providerBinary,
    root: options.root,
    toolDeclarations: options.toolDeclarations,
    runCommand,
  });
  if (verifiedInspection.conflict) {
    throw new Error(
      buildFirstPartyMcpConflictMessage({
        adapter,
        tool: verifiedInspection.conflict.tool,
        detail: verifiedInspection.conflict.detail,
      }),
    );
  }
  if (verifiedInspection.missingToolDeclarations.length > 0) {
    throw new Error(
      buildFirstPartyMcpInstallVerificationMessage({
        adapter,
        missingToolDeclarations: verifiedInspection.missingToolDeclarations,
      }),
    );
  }

  return {
    toolAttachmentStatus: "attached",
    additionalArgs: [],
  };
}

function summarizeFirstPartyMcpInspection(options: {
  toolDeclarations: readonly NativeToolDeclaration[];
  inspections: ReadonlyMap<string, FirstPartyMcpToolInspection>;
}): FirstPartyMcpInspectionSummary {
  const missingToolDeclarations: NativeToolDeclaration[] = [];
  for (const tool of options.toolDeclarations) {
    const inspection = options.inspections.get(tool.name);
    if (!inspection || inspection.state === "missing") {
      missingToolDeclarations.push(tool);
      continue;
    }
    if (inspection.state === "conflicting") {
      return {
        missingToolDeclarations,
        conflict: {
          tool,
          detail: inspection.detail,
        },
      };
    }
  }
  return { missingToolDeclarations };
}

async function verifyFirstPartyMcpStatus(
  options: VerifiedFirstPartyMcpStatusOptions,
): Promise<FirstPartyMcpInspectionSummary> {
  let lastSummary: FirstPartyMcpInspectionSummary | undefined;

  for (const waitMs of FIRST_PARTY_MCP_VERIFY_DELAYS_MS) {
    if (waitMs > 0) {
      await delay(waitMs);
    }

    lastSummary = summarizeFirstPartyMcpInspection({
      toolDeclarations: options.toolDeclarations,
      inspections: await options.adapter.inspectTools({
        providerBinary: options.providerBinary,
        root: options.root,
        toolDeclarations: options.toolDeclarations,
        runCommand: options.runCommand,
      }),
    });
    if (
      lastSummary.conflict ||
      lastSummary.missingToolDeclarations.length === 0
    ) {
      return lastSummary;
    }
  }

  return (
    lastSummary ?? { missingToolDeclarations: [...options.toolDeclarations] }
  );
}

function buildFirstPartyMcpConflictMessage(options: {
  adapter: FirstPartyMcpAdapter;
  tool: NativeToolDeclaration;
  detail?: string;
}): string {
  const detailLine = options.detail ? ` ${options.detail}` : "";
  return [
    `A conflicting effective \`${options.tool.name}\` MCP entry is already configured for ${options.adapter.providerCommand}.${detailLine}`.trim(),
    `Inspect it with \`${options.adapter.inspectHintCommand(options.tool.name)}\`, then update or remove the conflicting entry and retry.`,
  ].join(" ");
}

function buildFirstPartyMcpInstallVerificationMessage(options: {
  adapter: FirstPartyMcpAdapter;
  missingToolDeclarations: readonly NativeToolDeclaration[];
}): string {
  const [firstTool] = options.missingToolDeclarations;
  const toolList = options.missingToolDeclarations
    .map((tool) => `\`${tool.name}\``)
    .join(", ");
  return [
    `Installed ${toolList}, but ${options.adapter.providerCommand} still does not resolve the expected Voratiq MCP configuration.`,
    `Inspect the effective entry with \`${options.adapter.inspectHintCommand(firstTool?.name ?? BUNDLED_VORATIQ_TOOL_TARGET_NAME)}\` and retry.`,
  ].join(" ");
}

async function inspectGeminiMcpTools(options: {
  providerBinary: string;
  root: string;
  toolDeclarations: readonly NativeToolDeclaration[];
  runCommand: ProviderMcpCommandRunner;
}): Promise<Map<string, FirstPartyMcpToolInspection>> {
  const inspections = new Map<string, FirstPartyMcpToolInspection>();
  if (options.toolDeclarations.length === 0) {
    return inspections;
  }
  const result = await options.runCommand({
    command: options.providerBinary,
    args: ["mcp", "list"],
    cwd: options.root,
  });

  if (result.exitCode !== 0) {
    throw new Error(buildProviderMcpInspectionError("gemini", result));
  }

  const entries = parseGeminiMcpListEntries(
    [result.stdout, result.stderr].filter((part) => part.length > 0).join("\n"),
  );
  for (const tool of options.toolDeclarations) {
    const entry = entries.get(tool.name);
    if (!entry) {
      inspections.set(tool.name, { state: "missing" });
      continue;
    }
    inspections.set(
      tool.name,
      matchesDeclarationCommandAndArgs(tool, entry)
        ? { state: "matched" }
        : {
            state: "conflicting",
            detail: buildCommandMismatchDetail(tool, entry),
          },
    );
  }
  return inspections;
}

async function inspectCliMcpToolsViaGet(options: {
  providerBinary: string;
  providerCommand: "codex" | "claude";
  root: string;
  toolDeclarations: readonly NativeToolDeclaration[];
  runCommand: ProviderMcpCommandRunner;
}): Promise<Map<string, FirstPartyMcpToolInspection>> {
  const inspections = new Map<string, FirstPartyMcpToolInspection>();
  for (const tool of options.toolDeclarations) {
    inspections.set(
      tool.name,
      await inspectCliMcpTool({
        providerBinary: options.providerBinary,
        providerCommand: options.providerCommand,
        root: options.root,
        declaration: tool,
        runCommand: options.runCommand,
      }),
    );
  }
  return inspections;
}

async function inspectCodexMcpTools(options: {
  providerBinary: string;
  root: string;
  toolDeclarations: readonly NativeToolDeclaration[];
  runCommand: ProviderMcpCommandRunner;
}): Promise<Map<string, FirstPartyMcpToolInspection>> {
  return await inspectCliMcpToolsViaGet({
    providerBinary: options.providerBinary,
    providerCommand: "codex",
    root: options.root,
    toolDeclarations: options.toolDeclarations,
    runCommand: options.runCommand,
  });
}

async function inspectClaudeMcpTools(options: {
  providerBinary: string;
  root: string;
  toolDeclarations: readonly NativeToolDeclaration[];
  runCommand: ProviderMcpCommandRunner;
}): Promise<Map<string, FirstPartyMcpToolInspection>> {
  return await inspectCliMcpToolsViaGet({
    providerBinary: options.providerBinary,
    providerCommand: "claude",
    root: options.root,
    toolDeclarations: options.toolDeclarations,
    runCommand: options.runCommand,
  });
}

async function inspectCliMcpTool(options: {
  providerBinary: string;
  providerCommand: "codex" | "claude";
  root: string;
  declaration: NativeToolDeclaration;
  runCommand: ProviderMcpCommandRunner;
}): Promise<FirstPartyMcpToolInspection> {
  if (options.providerCommand === "codex") {
    const result = await options.runCommand({
      command: options.providerBinary,
      args: ["mcp", "get", "--json", options.declaration.name],
      cwd: options.root,
    });
    if (result.exitCode !== 0) {
      if (isMissingMcpServerResult(result)) {
        return { state: "missing" };
      }
      throw new Error(buildProviderMcpInspectionError("codex", result));
    }
    const parsed = tryParseJson(result.stdout);
    if (parsed !== undefined) {
      const candidate = findCommandArgsPair(parsed);
      if (candidate) {
        return matchesDeclarationCommandAndArgs(options.declaration, candidate)
          ? { state: "matched" }
          : {
              state: "conflicting",
              detail: buildCommandMismatchDetail(
                options.declaration,
                candidate,
              ),
            };
      }
    }
    return textContainsCommandAndArgs(result.stdout, options.declaration)
      ? { state: "matched" }
      : {
          state: "conflicting",
          detail:
            "Configured entry does not match the expected Voratiq command.",
        };
  }

  const result = await options.runCommand({
    command: options.providerBinary,
    args: ["mcp", "get", options.declaration.name],
    cwd: options.root,
  });
  if (result.exitCode !== 0) {
    if (isMissingMcpServerResult(result)) {
      return { state: "missing" };
    }
    throw new Error(buildProviderMcpInspectionError("claude", result));
  }
  const candidate =
    parseSeparatedCommandAndArgs(result.stdout, {
      commandLabel: "Command",
      argsLabel: "Args",
    }) ?? parseCommandLineValue(result.stdout, "Command");
  if (candidate) {
    return matchesDeclarationCommandAndArgs(options.declaration, candidate)
      ? { state: "matched" }
      : {
          state: "conflicting",
          detail: buildCommandMismatchDetail(options.declaration, candidate),
        };
  }
  return textContainsCommandAndArgs(result.stdout, options.declaration)
    ? { state: "matched" }
    : {
        state: "conflicting",
        detail: "Configured entry does not match the expected Voratiq command.",
      };
}

function buildProviderMcpInspectionError(
  providerCommand: FirstPartyProviderId,
  result: ProviderMcpCommandResult,
): string {
  const output =
    result.stderr.trim() || result.stdout.trim() || "Unknown error";
  return `Failed to inspect ${providerCommand} MCP configuration: ${output}`;
}

function isMissingMcpServerResult(result: ProviderMcpCommandResult): boolean {
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return (
    output.includes("no mcp server found") ||
    output.includes("no mcp server named") ||
    output.includes("not found") ||
    output.includes("no server found")
  );
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function findCommandArgsPair(
  value: unknown,
): { command: string; args: string[] } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findCommandArgsPair(entry);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const command =
    typeof candidate.command === "string" ? candidate.command : undefined;
  const args = normalizeStringArray(candidate.args);
  if (command && args) {
    return { command, args };
  }

  for (const nestedValue of Object.values(candidate)) {
    const nested = findCommandArgsPair(nestedValue);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (!value.every((entry) => typeof entry === "string")) {
    return undefined;
  }
  return [...value];
}

function matchesDeclarationCommandAndArgs(
  declaration: NativeToolDeclaration,
  value: { command: string; args: string[] },
): boolean {
  const expectedArgs = declaration.args ? [...declaration.args] : [];
  if (!areStringArraysEqual(value.args, expectedArgs)) {
    return false;
  }
  return areEquivalentMcpCommands(value.command, declaration.command);
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function areEquivalentMcpCommands(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }

  return isNodeExecutableCommand(left) && isNodeExecutableCommand(right);
}

function isNodeExecutableCommand(value: string): boolean {
  const normalized = basename(value).toLowerCase();
  return normalized === "node" || normalized === "node.exe";
}

function buildCommandMismatchDetail(
  declaration: NativeToolDeclaration,
  actual: { command: string; args: string[] },
): string {
  return [
    `Expected \`${formatCommandAndArgs(declaration.command, declaration.args ?? [])}\`,`,
    `found \`${formatCommandAndArgs(actual.command, actual.args)}\`.`,
  ].join(" ");
}

function formatCommandAndArgs(
  command: string,
  args: readonly string[],
): string {
  return [command, ...args].join(" ");
}

function textContainsCommandAndArgs(
  text: string,
  declaration: NativeToolDeclaration,
): boolean {
  const normalized = text.replaceAll(/\s+/gu, " ");
  const commandIndex = normalized.indexOf(declaration.command);
  if (commandIndex < 0) {
    return false;
  }
  let cursor = commandIndex + declaration.command.length;
  for (const arg of declaration.args ?? []) {
    const index = normalized.indexOf(arg, cursor);
    if (index < 0) {
      return false;
    }
    cursor = index + arg.length;
  }
  return true;
}

function parseCommandLineValue(
  text: string,
  label: string,
): { command: string; args: string[] } | undefined {
  const pattern = new RegExp(`^${label}:\\s+(.+)$`, "mu");
  const match = text.match(pattern);
  if (!match?.[1]) {
    return undefined;
  }
  return splitCommandLine(match[1]);
}

function parseSeparatedCommandAndArgs(
  text: string,
  labels: {
    commandLabel: string;
    argsLabel: string;
  },
): { command: string; args: string[] } | undefined {
  const commandLine = parseLabeledLine(text, labels.commandLabel);
  if (!commandLine) {
    return undefined;
  }

  const argsLine = parseLabeledLine(text, labels.argsLabel);
  return {
    command: commandLine,
    args: argsLine
      ? argsLine.split(/\s+/u).filter((part) => part.length > 0)
      : [],
  };
}

function parseLabeledLine(text: string, label: string): string | undefined {
  const pattern = new RegExp(`^${label}:\\s*(.+)$`, "mu");
  const match = text.match(pattern);
  return match?.[1]?.trim() || undefined;
}

function splitCommandLine(value: string): { command: string; args: string[] } {
  const trimmed = value.trim();
  const withoutSuffix = trimmed.replace(
    /\s+\((?:stdio|sse|http)\)(?:\s+-\s+.+)?$/u,
    "",
  );
  const parts = withoutSuffix.split(/\s+/u).filter((part) => part.length > 0);
  return {
    command: parts[0] ?? "",
    args: parts.slice(1),
  };
}

async function installVoratiqMcpForProvider(options: {
  adapter: FirstPartyMcpAdapter;
  providerBinary: string;
  root: string;
  toolDeclarations: readonly NativeToolDeclaration[];
  runCommand: ProviderMcpCommandRunner;
}): Promise<void> {
  for (const toolDeclaration of options.toolDeclarations) {
    const result = await options.runCommand({
      command: options.providerBinary,
      args: options.adapter.buildAddArgs(toolDeclaration),
      cwd: options.root,
    });
    if (result.exitCode !== 0) {
      const stderr = result.stderr.trim();
      const stdout = result.stdout.trim();
      const output =
        stderr || stdout || `${options.adapter.providerCommand} mcp add failed`;
      throw new Error(output);
    }
  }
}

function buildGeminiMcpAddArgs(tool: NativeToolDeclaration): string[] {
  const args = ["mcp", "add", "--scope", "user", "--trust"];
  if (tool.env) {
    for (const [key, value] of Object.entries(tool.env)) {
      args.push("-e", `${key}=${value}`);
    }
  }
  args.push(tool.name, tool.command);
  if (tool.args && tool.args.length > 0) {
    args.push(...tool.args);
  }
  return args;
}

function buildCodexMcpAddArgs(tool: NativeToolDeclaration): string[] {
  const args = ["mcp", "add"];
  if (tool.env) {
    for (const [key, value] of Object.entries(tool.env)) {
      args.push("--env", `${key}=${value}`);
    }
  }
  args.push(tool.name, "--", tool.command);
  if (tool.args && tool.args.length > 0) {
    args.push(...tool.args);
  }
  return args;
}

function buildClaudeMcpAddArgs(tool: NativeToolDeclaration): string[] {
  const args = ["mcp", "add", "--scope", "user"];
  if (tool.env) {
    for (const [key, value] of Object.entries(tool.env)) {
      args.push("-e", `${key}=${value}`);
    }
  }
  args.push(tool.name, "--", tool.command);
  if (tool.args && tool.args.length > 0) {
    args.push(...tool.args);
  }
  return args;
}

function parseGeminiMcpListEntries(
  stdout: string,
): Map<string, { command: string; args: string[] }> {
  const entries = new Map<string, { command: string; args: string[] }>();
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.toLowerCase() === "no mcp servers configured.") {
      continue;
    }
    const entry = parseGeminiMcpListEntry(line);
    if (entry) {
      entries.set(entry.name, entry.commandLine);
    }
  }
  return entries;
}

function parseGeminiMcpListEntry(
  line: string,
):
  | { name: string; commandLine: { command: string; args: string[] } }
  | undefined {
  let normalized = line;
  while (
    normalized.startsWith("✓") ||
    normalized.startsWith("✗") ||
    normalized.startsWith("-") ||
    normalized.startsWith("*")
  ) {
    normalized = normalized.slice(1).trimStart();
  }

  const colonIndex = normalized.indexOf(":");
  const candidate = (
    colonIndex >= 0 ? normalized.slice(0, colonIndex) : normalized
  ).trim();
  if (!candidate) {
    return undefined;
  }
  if (!/^[A-Za-z0-9._-]+$/u.test(candidate)) {
    return undefined;
  }
  if (colonIndex < 0) {
    return undefined;
  }
  const commandText = normalized.slice(colonIndex + 1).trim();
  if (!commandText) {
    return undefined;
  }
  return {
    name: candidate,
    commandLine: splitCommandLine(commandText),
  };
}

async function runProviderMcpCommand(
  input: ProviderMcpCommandInput,
): Promise<ProviderMcpCommandResult> {
  const child = spawn(input.command, [...input.args], {
    cwd: input.cwd,
    env: input.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    let settled = false;
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (stderr.trim().length === 0) {
        stderr = error.message;
      }
      resolve(null);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(typeof code === "number" ? code : null);
    });
  });
  return {
    exitCode,
    stdout,
    stderr,
  };
}

function resolveProviderBinary(
  candidate: string | undefined,
  fallback: string,
): string {
  const normalized = candidate?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}
