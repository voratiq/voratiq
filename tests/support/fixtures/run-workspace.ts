import { execFile } from "node:child_process";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const KEEP_DEBUG = process.env.VORATIQ_TEST_KEEP_REPO === "1";
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "..", "..", "..");
const SRT_BINARY_ENV = "VORATIQ_SRT_BINARY";
const TEST_KEYCHAIN_ENV = "VORATIQ_TEST_KEYCHAIN_SECRET_PATH";

const SRT_STUB_SOURCE = `#!/usr/bin/env node
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
let remaining = args.slice();

while (remaining.length > 0 && remaining[0] !== "--") {
  const option = remaining[0];
  if (option === "--settings") {
    remaining = remaining.slice(2);
    continue;
  }
  if (option === "--debug") {
    remaining = remaining.slice(1);
    continue;
  }
  break;
}

const separatorIndex = remaining.indexOf("--");
if (separatorIndex === -1) {
  console.error('[srt-stub] missing "--" separator');
  process.exit(1);
}

const command = remaining[separatorIndex + 1];
if (!command) {
  console.error("[srt-stub] missing child command");
  process.exit(1);
}

const commandArgs = remaining.slice(separatorIndex + 2);
const child = spawn(command, commandArgs, { stdio: "inherit" });

child.on("error", (error) => {
  console.error("[srt-stub] failed to spawn child:", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (typeof signal === "string") {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(typeof code === "number" ? code : 1);
});
`;

type EnvSnapshot = Map<string, string | undefined>;

export interface AgentConfigDefinition {
  id: string;
  model: string;
  binary: string;
  provider?: string;
  enabled?: boolean;
  extraArgs?: string[];
}

export interface RunTestWorkspaceOptions {
  agentConfigs?: AgentConfigDefinition[];
  env?: NodeJS.ProcessEnv;
}

export interface RunTestWorkspace {
  root: string;
  homeDir: string;
  claudeConfigDir: string;
  codexHomeDir: string;
  geminiConfigDir: string;
  credentialPath: string;
  srtStubPath: string;
  writeAgentsConfig: (agents: AgentConfigDefinition[]) => Promise<void>;
  cleanup: () => Promise<void>;
}

/**
 * Sets up an isolated run workspace for integration tests. The fixture wires up
 * provider credentials, installs the shim, provisions an SRT stub, applies the
 * required environment overrides, and exposes helpers for writing agent
 * configurations. Call `cleanup()` after each test to restore the environment
 * and delete temporary directories.
 */
export async function createRunTestWorkspace(
  options: RunTestWorkspaceOptions = {},
): Promise<RunTestWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "voratiq-run-"));
  await initGitRepository(root);
  await copyShimIntoRepo(root);

  const envSnapshot: EnvSnapshot = new Map();
  const cleanupCallbacks: Array<() => Promise<void>> = [];

  const claudeConfigDir = await stageClaudeCredentials(root);
  const credentialPath = join(claudeConfigDir, ".credentials.json");
  const codexHomeDir = await stageCodexHome(root);
  const { homeDir, geminiConfigDir } = await stageGeminiHome(root);
  const { stubDir, stubPath } = await createSrtStub();

  cleanupCallbacks.push(async () => {
    await rm(stubDir, { recursive: true, force: true });
  });
  cleanupCallbacks.push(async () => {
    if (!KEEP_DEBUG) {
      await rm(root, { recursive: true, force: true });
    }
  });

  applyEnvOverrides(envSnapshot, {
    CLAUDE_CONFIG_DIR: claudeConfigDir,
    CODEX_HOME: codexHomeDir,
    HOME: homeDir,
    [TEST_KEYCHAIN_ENV]: credentialPath,
    [SRT_BINARY_ENV]: stubPath,
  });

  if (options.env) {
    applyEnvOverrides(envSnapshot, options.env);
  }

  if (options.agentConfigs?.length) {
    await writeAgentsConfigFile(root, options.agentConfigs);
  }

  let cleanedUp = false;
  async function cleanup(): Promise<void> {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    restoreEnv(envSnapshot);
    for (const task of cleanupCallbacks) {
      await task();
    }
  }

  return {
    root,
    homeDir,
    claudeConfigDir,
    codexHomeDir,
    geminiConfigDir,
    credentialPath,
    srtStubPath: stubPath,
    writeAgentsConfig: (agents) => writeAgentsConfigFile(root, agents),
    cleanup,
  };
}

async function initGitRepository(root: string): Promise<void> {
  await execFileAsync("git", ["init", "--initial-branch=main"], {
    cwd: root,
  });
  await execFileAsync("git", ["config", "user.email", "tests@voratiq.dev"], {
    cwd: root,
  });
  await execFileAsync("git", ["config", "user.name", "Voratiq Tests"], {
    cwd: root,
  });

  const readmePath = join(root, "README.md");
  await writeFile(readmePath, "# Voratiq Test Repo\n", "utf8");

  const gitignorePath = join(root, ".gitignore");
  const repoGitignorePath = join(REPO_ROOT, ".gitignore");
  const gitignoreContents = await readFile(repoGitignorePath, "utf8");
  await writeFile(gitignorePath, gitignoreContents, "utf8");

  await execFileAsync("git", ["add", "README.md", ".gitignore"], {
    cwd: root,
  });
  await execFileAsync("git", ["commit", "-m", "Initial commit"], {
    cwd: root,
  });
  await mkdir(join(root, "node_modules"), { recursive: true });
}

async function copyShimIntoRepo(root: string): Promise<void> {
  const shimSource = join(
    REPO_ROOT,
    "dist",
    "commands",
    "run",
    "shim",
    "run-agent-shim.mjs",
  );
  try {
    await access(shimSource);
  } catch {
    throw new Error(
      `Run shim missing at ${shimSource}. Run "npm run build" before executing integration tests.`,
    );
  }
  const shimTarget = join(
    root,
    "dist",
    "commands",
    "run",
    "shim",
    "run-agent-shim.mjs",
  );
  await mkdir(dirname(shimTarget), { recursive: true });
  await cp(shimSource, shimTarget, { force: true });
}

async function stageClaudeCredentials(root: string): Promise<string> {
  const claudeConfigDir = join(root, "claude-config");
  await mkdir(claudeConfigDir, { recursive: true });
  const credentialsPath = join(claudeConfigDir, ".credentials.json");
  await writeFile(credentialsPath, buildClaudeCredentialFixture(), "utf8");
  return claudeConfigDir;
}

async function stageCodexHome(root: string): Promise<string> {
  const codexHomeDir = join(root, "codex-home");
  await mkdir(codexHomeDir, { recursive: true });
  await writeFile(
    join(codexHomeDir, "auth.json"),
    '{"access_token":"test-token"}\n',
    "utf8",
  );
  await writeFile(
    join(codexHomeDir, "config.toml"),
    "[cli]\ncolor=true\n",
    "utf8",
  );
  await chmod(codexHomeDir, 0o755);
  return codexHomeDir;
}

async function stageGeminiHome(root: string): Promise<{
  homeDir: string;
  geminiConfigDir: string;
}> {
  const homeDir = join(root, "user-home");
  await mkdir(homeDir, { recursive: true });
  const geminiConfigDir = join(homeDir, ".gemini");
  await mkdir(geminiConfigDir, { recursive: true });
  await writeFile(
    join(geminiConfigDir, "oauth_creds.json"),
    '{"token":"test-token"}\n',
    "utf8",
  );
  await writeFile(
    join(geminiConfigDir, "google_accounts.json"),
    '{"accounts":[]}\n',
    "utf8",
  );
  await writeFile(
    join(geminiConfigDir, "settings.json"),
    JSON.stringify(
      {
        telemetry: false,
        security: { auth: { selectedType: "oauth" } },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(
    join(geminiConfigDir, "state.json"),
    JSON.stringify({ session: "test-session" }, null, 2) + "\n",
    "utf8",
  );
  return { homeDir, geminiConfigDir };
}

async function createSrtStub(): Promise<{ stubDir: string; stubPath: string }> {
  const stubDir = await mkdtemp(join(tmpdir(), "voratiq-srt-"));
  const stubPath = join(stubDir, "srt-stub.mjs");
  await writeFile(stubPath, SRT_STUB_SOURCE, { encoding: "utf8" });
  await chmod(stubPath, 0o755);
  return { stubDir, stubPath };
}

async function writeAgentsConfigFile(
  root: string,
  agents: AgentConfigDefinition[],
): Promise<void> {
  const agentsDir = join(root, ".voratiq");
  await mkdir(agentsDir, { recursive: true });
  const agentsPath = join(agentsDir, "agents.yaml");
  const lines: string[] = ["agents:"];
  for (const agent of agents) {
    lines.push(`  - id: ${JSON.stringify(agent.id)}`);
    const provider = agent.provider ?? agent.id;
    lines.push(`    provider: ${JSON.stringify(provider)}`);
    lines.push(`    model: ${JSON.stringify(agent.model)}`);
    const enabled = agent.enabled === undefined ? true : agent.enabled;
    lines.push(`    enabled: ${enabled ? "true" : "false"}`);
    lines.push(`    binary: ${JSON.stringify(agent.binary)}`);
    if (agent.extraArgs && agent.extraArgs.length > 0) {
      lines.push("    extraArgs:");
      for (const arg of agent.extraArgs) {
        lines.push(`      - ${JSON.stringify(arg)}`);
      }
    }
    lines.push("");
  }
  const content = `${lines.join("\n").trimEnd()}\n`;
  await writeFile(agentsPath, content, "utf8");
}

function buildClaudeCredentialFixture(): string {
  const payload = {
    claudeAiOauth: {
      accessToken: "access-test-token",
      refreshToken: "refresh-test-token",
      expiresAt: 1_725_000_000_000,
    },
    primaryApiKey: "sk-test-key",
  };
  return JSON.stringify(payload, null, 2) + "\n";
}

function applyEnvOverrides(
  snapshot: EnvSnapshot,
  overrides: NodeJS.ProcessEnv,
): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (!snapshot.has(key)) {
      snapshot.set(key, process.env[key]);
    }
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [key, value] of snapshot.entries()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
