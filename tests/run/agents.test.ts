/* eslint jest/no-standalone-expect: ["error", { "additionalTestBlockFunctions": ["sandboxTest"] }] */
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";

import { runRunCommand } from "../../src/cli/run.js";
import { loadAgentCatalog } from "../../src/configs/agents/loader.js";
import {
  type AgentInvocationEnhanced,
  buildRunRecordEnhanced,
  type RunRecordEnhanced,
} from "../../src/records/enhanced.js";
import type {
  AgentReport,
  RunRecord,
  RunReport,
} from "../../src/records/types.js";
import { pathExists } from "../../src/utils/fs.js";
import { createWorkspace } from "../../src/workspace/setup.js";
import {
  type AgentConfigDefinition,
  createRunTestWorkspace,
  type RunTestWorkspace,
} from "../support/fixtures/run-workspace.js";
import {
  sandboxTest,
  withSandboxEnabled,
} from "../support/sandbox-requirements.js";

// Skip agent-spawning integration tests in nested agent workspaces to break recursive eval loops.
const runningInWorkspace = process.env.VORATIQ_WORKSPACE_TESTS === "1";
const suite = runningInWorkspace ? describe.skip : describe;
const AGENT_TEST_TIMEOUT_MS = 30_000;

interface AgentTestScenario {
  name: string;
  agentId: string;
  provider: string;
  model: string;
  specSlug: string;
  specHeading: string;
  specBody: string;
  extraArgs?: string[];
  assertScenario: (context: AgentTestContext) => Promise<void> | void;
}

interface AgentTestContext {
  scenario: AgentTestScenario;
  manifest: AgentManifestSnapshot;
  runReport: RunReport;
  agentReport: AgentReport;
  agentEnhanced: AgentInvocationEnhanced;
  enhancedRecord: RunRecordEnhanced;
  repoRoot: string;
  agentScriptPath: string;
}

async function writeAgentsConfig(
  workspace: RunTestWorkspace,
  agents: AgentConfigDefinition[],
): Promise<void> {
  await workspace.writeAgentsConfig(agents);
}

async function withRepoCwd<T>(
  repoRoot: string,
  fn: () => Promise<T>,
): Promise<T> {
  const originalCwd = process.cwd();
  try {
    process.chdir(repoRoot);
    return await fn();
  } finally {
    process.chdir(originalCwd);
  }
}

suite("agent integrations", () => {
  let workspace: RunTestWorkspace;
  let repoRoot: string;
  let agentScriptPath: string;

  beforeEach(async () => {
    workspace = await createRunTestWorkspace();
    repoRoot = workspace.root;
    agentScriptPath = await createAgentFixture(repoRoot);
  });

  afterEach(async () => {
    await workspace?.cleanup();
  });

  const agentScenarios: AgentTestScenario[] = [
    {
      name: "Claude",
      agentId: "claude",
      provider: "claude",
      model: "claude-model",
      specSlug: "agents",
      specHeading: "Agent Integration",
      specBody: "Ensure vendor agent artifacts are captured.",
      assertScenario: async ({ manifest, runReport, scenario }) => {
        expect(manifest.argv).toEqual([
          "--model",
          "claude-model",
          "--output-format",
          "json",
          "--dangerously-skip-permissions",
          "-p",
        ]);
        const expectedSandboxPrefix = `.voratiq/runs/sessions/${runReport.runId}/${scenario.agentId}/sandbox`;
        expect(manifest.env.CLAUDE_CONFIG_DIR).toContain(expectedSandboxPrefix);
        expect(manifest.env.CLAUDE_CONFIG_DIR).toBe(
          join(manifest.env.HOME, ".claude"),
        );
        expect(manifest.env.XDG_CONFIG_HOME).toContain(
          `${expectedSandboxPrefix}/.config`,
        );
        expect(manifest.env.XDG_CACHE_HOME).toContain(
          `${expectedSandboxPrefix}/.cache`,
        );
        expect(manifest.env.XDG_DATA_HOME).toContain(
          `${expectedSandboxPrefix}/.local/share`,
        );
        expect(manifest.env.XDG_STATE_HOME).toContain(
          `${expectedSandboxPrefix}/.local/state`,
        );
        expect(manifest.env.CLAUDE_CODE_DEBUG_LOGS_DIR).toContain(
          `${expectedSandboxPrefix}/logs/debug/claude.log`,
        );
        expect(manifest.env.TMPDIR).toContain(`${expectedSandboxPrefix}/tmp`);
        expect(manifest.env.TEMP).toBe(manifest.env.TMPDIR);
        expect(manifest.env.TMP).toBe(manifest.env.TMPDIR);
        expect(manifest.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe(
          "true",
        );
        expect(manifest.env.DISABLE_AUTOUPDATER).toBe("true");
        expect(manifest.env.DISABLE_ERROR_REPORTING).toBe("true");
        expect(manifest.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("0");
        const stagedSandbox = manifest.env.CLAUDE_CONFIG_DIR;
        await expect(pathExists(stagedSandbox)).resolves.toBe(false);
        await expect(access(stagedSandbox)).rejects.toThrow();
        const claudeSecretPath = join(
          repoRoot,
          `.voratiq/runs/sessions/${runReport.runId}/${scenario.agentId}/sandbox/.claude/.credentials.json`,
        );
        await expectNoRegularSecrets(claudeSecretPath);
      },
    },
    {
      name: "Codex",
      agentId: "codex",
      provider: "codex",
      model: "codex-model",
      specSlug: "codex",
      specHeading: "Codex Integration",
      specBody: "Ensure codex credentials are staged.",
      extraArgs: ["--config", "model_reasoning_effort=high"],
      assertScenario: async ({ manifest, runReport, scenario }) => {
        expect(manifest.env.CODEX_HOME).toContain(
          `.voratiq/runs/sessions/${runReport.runId}/${scenario.agentId}/sandbox/.codex`,
        );
        expect(manifest.env.HOME).toContain(
          `.voratiq/runs/sessions/${runReport.runId}/${scenario.agentId}/sandbox`,
        );
        expect(manifest.argv.slice(-2)).toEqual([
          "--config",
          "model_reasoning_effort=high",
        ]);
        expect(manifest.env.RUST_BACKTRACE).toBe("1");
        const stagedSandbox = manifest.env.CODEX_HOME;
        await expect(pathExists(stagedSandbox)).resolves.toBe(false);
        await expect(access(stagedSandbox)).rejects.toThrow();
        const codexSecretPath = join(
          repoRoot,
          `.voratiq/runs/sessions/${runReport.runId}/${scenario.agentId}/sandbox/.codex/auth.json`,
        );
        await expectNoRegularSecrets(codexSecretPath);
      },
    },
    {
      name: "Gemini",
      agentId: "gemini",
      provider: "gemini",
      model: "gemini-model",
      specSlug: "gemini",
      specHeading: "Gemini Integration",
      specBody: "Ensure gemini credentials use sandbox.",
      assertScenario: async ({ manifest, runReport, repoRoot, scenario }) => {
        const homeEnv = manifest.env.HOME;
        expect(homeEnv).toContain(
          `.voratiq/runs/sessions/${runReport.runId}/${scenario.agentId}/sandbox`,
        );
        expect(manifest.env.GEMINI_HOME).toBeUndefined();

        const stagedGeminiDir = join(
          repoRoot,
          `.voratiq/runs/sessions/${runReport.runId}/${scenario.agentId}/sandbox/.gemini`,
        );
        await expect(pathExists(stagedGeminiDir)).resolves.toBe(false);
        await expect(access(stagedGeminiDir)).rejects.toThrow();
        const geminiSecretPath = join(stagedGeminiDir, "oauth_creds.json");
        await expectNoRegularSecrets(geminiSecretPath);
      },
    },
  ];

  for (const scenario of agentScenarios) {
    sandboxTest(
      `runs the ${scenario.name} agent with staged credentials`,
      async () => {
        await withSandboxEnabled(async () => {
          const context = await executeAgentScenario(scenario);
          await scenario.assertScenario(context);
        });
      },
      AGENT_TEST_TIMEOUT_MS,
    );
  }

  async function executeAgentScenario(
    scenario: AgentTestScenario,
  ): Promise<AgentTestContext> {
    await createWorkspace(repoRoot);
    await writeAgentsConfig(workspace, [
      {
        id: scenario.agentId,
        provider: scenario.provider,
        model: scenario.model,
        binary: agentScriptPath,
        extraArgs: scenario.extraArgs,
      },
    ]);

    const specDir = join(repoRoot, "specs");
    await mkdir(specDir, { recursive: true });
    const specPath = join(specDir, `${scenario.specSlug}.md`);
    const specContent = `# ${scenario.specHeading}\n${scenario.specBody}\n`;
    await writeFile(specPath, specContent, "utf8");

    const catalog = loadAgentCatalog({ root: repoRoot });
    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.id).toBe(scenario.agentId);

    const specRelativePath = relative(repoRoot, specPath);
    const { report: runReport } = await withRepoCwd(repoRoot, () =>
      runRunCommand({ specPath: specRelativePath }),
    );
    expect(runReport.agents.map((agent) => agent.agentId)).toEqual([
      scenario.agentId,
    ]);

    const agentReport = runReport.agents[0];
    expect(agentReport).toBeDefined();
    if (!agentReport) {
      throw new Error("Expected agent report for scenario");
    }
    assertAgentReportStructure(agentReport, runReport.runId);

    const indexPath = join(repoRoot, ".voratiq", "runs", "index.json");
    const indexPayload = JSON.parse(await readFile(indexPath, "utf8")) as {
      sessions: Array<Pick<RunRecord, "runId" | "createdAt" | "status">>;
    };
    const indexEntry = indexPayload.sessions.find(
      (entry) => entry.runId === runReport.runId,
    );
    expect(indexEntry).toBeDefined();
    if (!indexEntry) {
      throw new Error(`Run ${runReport.runId} missing from index`);
    }

    const recordPath = join(
      repoRoot,
      ".voratiq",
      "runs",
      "sessions",
      runReport.runId,
      "record.json",
    );
    const record = JSON.parse(await readFile(recordPath, "utf8")) as RunRecord;
    const enhancedRecord = buildRunRecordEnhanced(record);

    const agentEnhanced = enhancedRecord.agents.find(
      (agent) => agent.agentId === scenario.agentId,
    );
    expect(agentEnhanced).toBeDefined();

    const manifest = await loadAgentManifest(agentEnhanced!, repoRoot);
    expect(manifest.binary).toBe(agentScriptPath);
    const manifestDirPath = dirname(
      join(repoRoot, agentEnhanced!.runtimeManifestPath),
    );
    const promptPath = isAbsolute(manifest.promptPath)
      ? manifest.promptPath
      : join(manifestDirPath, manifest.promptPath);
    const expectedPromptPrefix = join(
      repoRoot,
      ".voratiq",
      "runs",
      "sessions",
      runReport.runId,
    );
    expect(
      normalizePathForCompare(promptPath).startsWith(
        normalizePathForCompare(expectedPromptPrefix),
      ),
    ).toBe(true);
    await expect(access(promptPath)).rejects.toThrow();
    const expectedWorkspacePath = join(
      repoRoot,
      agentEnhanced!.baseDirectory,
      "workspace",
    );
    const resolvedWorkspacePath = await realpath(expectedWorkspacePath);
    const manifestWorkspacePath = await realpath(manifest.workspace);
    expect(manifestWorkspacePath).toBe(resolvedWorkspacePath);

    const summaryPath = agentEnhanced!.assets.summaryPath;
    expect(typeof summaryPath).toBe("string");
    const summaryContent = await readFile(
      join(repoRoot, summaryPath as string),
      "utf8",
    );
    expect(summaryContent).toContain("gemini agent summary");

    return {
      scenario,
      manifest,
      runReport,
      agentReport,
      agentEnhanced: agentEnhanced!,
      enhancedRecord,
      repoRoot,
      agentScriptPath,
    };
  }

  function assertAgentReportStructure(
    agentReport: AgentReport,
    runId: string,
  ): void {
    expect(agentReport.status).toBe("succeeded");
    expect(agentReport.assets.stdoutPath).toContain(
      `/${agentReport.agentId}/artifacts/stdout.log`,
    );
    expect(agentReport.assets.stderrPath).toContain(
      `/${agentReport.agentId}/artifacts/stderr.log`,
    );
    expect(agentReport.assets.diffPath).toBeDefined();
    expect(agentReport.assets.diffPath).toContain(
      `/${agentReport.agentId}/artifacts/diff.patch`,
    );
    expect(agentReport.assets.summaryPath).toBeDefined();
    expect(agentReport.baseDirectory).toBe(
      `.voratiq/runs/sessions/${runId}/${agentReport.agentId}`,
    );
  }

  async function loadAgentManifest(
    agent: AgentInvocationEnhanced,
    root: string,
  ): Promise<AgentManifestSnapshot> {
    const manifestRaw = await readFile(
      join(root, agent.runtimeManifestPath),
      "utf8",
    );
    const manifestUnknown = JSON.parse(manifestRaw) as unknown;
    if (!isAgentManifest(manifestUnknown)) {
      throw new Error("Unexpected agent manifest structure");
    }
    return manifestUnknown;
  }
});

interface AgentManifestSnapshot {
  binary: string;
  argv: string[];
  promptPath: string;
  workspace: string;
  env: Record<string, string>;
}

function isAgentManifest(value: unknown): value is AgentManifestSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const { binary, argv, promptPath, workspace, env } = record;
  if (
    typeof binary !== "string" ||
    !Array.isArray(argv) ||
    argv.some((item) => typeof item !== "string") ||
    typeof promptPath !== "string" ||
    typeof workspace !== "string" ||
    !env ||
    typeof env !== "object" ||
    Array.isArray(env)
  ) {
    return false;
  }
  const envRecord = env as Record<string, unknown>;
  return Object.values(envRecord).every(
    (valueItem) => typeof valueItem === "string",
  );
}

function normalizePathForCompare(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith("/private/")
    ? normalized.slice("/private".length)
    : normalized;
}

async function expectNoRegularSecrets(secretPath: string): Promise<void> {
  const exists = await pathExists(secretPath);
  expect(exists).toBe(false);
  if (exists) {
    const stats = await lstat(secretPath);
    expect(stats.isFile()).toBe(true);
  }
}

async function createAgentFixture(root: string): Promise<string> {
  const scriptPath = join(root, "agent-fixture.cjs");
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const workspace = process.cwd();
const content = 'gemini agent summary';
fs.writeFileSync(path.join(workspace, '.summary.txt'), content, 'utf8');
fs.writeFileSync(path.join(workspace, 'artifact.txt'), content, 'utf8');
console.log('stdout from gemini fixture');
console.error('stderr from gemini fixture');
`;

  await writeFile(scriptPath, script, { encoding: "utf8" });
  await chmod(scriptPath, 0o755);
  return scriptPath;
}
