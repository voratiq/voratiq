import {
  access,
  chmod,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";

import * as authRuntime from "../../src/auth/runtime.js";
import { runRunCommand } from "../../src/cli/run.js";
import * as runAgentsModule from "../../src/commands/run/agents.js";
import { executeRunCommand } from "../../src/commands/run/command.js";
import { DirtyWorkingTreeError } from "../../src/preflight/errors.js";
import { buildRunRecordEnhanced } from "../../src/records/enhanced.js";
import * as persistence from "../../src/records/persistence.js";
import type { RunRecord } from "../../src/records/types.js";
import { createWorkspace } from "../../src/workspace/setup.js";
import {
  createRunTestWorkspace,
  type RunTestWorkspace,
} from "../support/fixtures/run-workspace.js";
import { isSandboxRuntimeSupported } from "../support/sandbox-requirements.js";
import type { RunIndexPayload } from "../support/types/persistence.js";

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

// Skip agent-spawning integration tests in nested agent workspaces to break recursive eval loops.
const runningInWorkspace = process.env.VORATIQ_WORKSPACE_TESTS === "1";
const suite =
  runningInWorkspace || !isSandboxRuntimeSupported() ? describe.skip : describe;
const RUN_INTEGRATION_TIMEOUT_MS = 60_000;

const AGENT_IDS = ["claude", "codex", "gemini"] as const;
type AgentId = (typeof AGENT_IDS)[number];

interface AgentConfigOverride {
  enabled?: boolean;
  binary?: string;
  model?: string;
  provider?: string;
  extraArgs?: string[];
}

async function writeAgentsConfig(
  workspace: RunTestWorkspace,
  defaultBinary: string,
  overrides: Partial<Record<AgentId, AgentConfigOverride>> = {},
): Promise<void> {
  const agents = AGENT_IDS.map((id) => {
    const override = overrides[id] ?? {};
    return {
      id,
      provider: override.provider ?? id,
      model: override.model ?? `${id}-test-model`,
      enabled: override.enabled ?? true,
      binary: override.binary ?? defaultBinary,
      extraArgs:
        override.extraArgs && override.extraArgs.length > 0
          ? override.extraArgs
          : undefined,
    };
  });
  await workspace.writeAgentsConfig(agents);
}

suite("voratiq run (integration)", () => {
  let workspace: RunTestWorkspace;
  let repoRoot: string;
  let agentScriptPath: string;
  let buildAuthRuntimeContextSpy: jest.SpyInstance;

  beforeEach(async () => {
    workspace = await createRunTestWorkspace();
    repoRoot = workspace.root;
    agentScriptPath = await createAgentScript(repoRoot);
    buildAuthRuntimeContextSpy = jest
      .spyOn(authRuntime, "buildAuthRuntimeContext")
      .mockImplementation(() => ({
        platform: "linux",
        env: { ...process.env },
        homeDir: workspace.homeDir,
        username: "voratiq-test",
      }));
  });

  afterEach(async () => {
    if (buildAuthRuntimeContextSpy) {
      buildAuthRuntimeContextSpy.mockRestore();
    }
    await workspace?.cleanup();
  });

  it(
    "executes configured agents and records run artifacts",
    async () => {
      await createWorkspace(repoRoot);
      await writeAgentsConfig(workspace, agentScriptPath);

      const specPath = join(repoRoot, "specs", "sample.md");
      await mkdir(join(repoRoot, "specs"), { recursive: true });
      await writeFile(
        specPath,
        "# Sample Spec\nUpdate artifact with greeting.\n",
        "utf8",
      );

      const runReport = await executeRunCommand({
        root: repoRoot,
        runsFilePath: join(repoRoot, ".voratiq", "runs", "index.json"),
        specAbsolutePath: specPath,
        specDisplayPath: relative(repoRoot, specPath),
      });

      expect(runReport.agents).toHaveLength(AGENT_IDS.length);
      for (const agent of runReport.agents) {
        const assets = expectDefined(agent.assets, "Agent assets missing");
        const stdoutPointer = expectDefined(
          assets.stdoutPath,
          "Agent stdout pointer missing",
        );
        const stderrPointer = expectDefined(
          assets.stderrPath,
          "Agent stderr pointer missing",
        );
        const stdoutPath = join(repoRoot, ...stdoutPointer.split("/"));
        const stderrPath = join(repoRoot, ...stderrPointer.split("/"));
        expect(agent.status).toBe("succeeded");
        expect(agent.diffAttempted).toBe(true);
        expect(agent.diffCaptured).toBe(true);
        expect(agent.evals).toHaveLength(4);
        expect(
          agent.evals.every((evaluation) =>
            ["succeeded", "skipped"].includes(evaluation.status),
          ),
        ).toBe(true);
        expect(agent.baseDirectory).toBe(
          `.voratiq/runs/sessions/${runReport.runId}/${agent.agentId}`,
        );

        await expect(readFile(stdoutPath, "utf8")).resolves.toContain("stdout");
        await expect(readFile(stderrPath, "utf8")).resolves.toContain("stderr");

        const workspaceArtifact = join(
          repoRoot,
          ".voratiq",
          "runs",
          "sessions",
          runReport.runId,
          agent.agentId,
          "workspace",
          "artifact.txt",
        );
        const artifactContent = await readFile(workspaceArtifact, "utf8");
        expect(artifactContent).toContain("Implement the following task:");
      }

      const indexPath = join(repoRoot, ".voratiq", "runs", "index.json");
      const indexPayload = JSON.parse(
        await readFile(indexPath, "utf8"),
      ) as RunIndexPayload;
      const indexEntry = indexPayload.sessions.find(
        (entry) => entry.runId === runReport.runId,
      );
      expect(indexEntry).toBeDefined();

      const recordPath = join(
        repoRoot,
        ".voratiq",
        "runs",
        "sessions",
        runReport.runId,
        "record.json",
      );
      const record = JSON.parse(
        await readFile(recordPath, "utf8"),
      ) as RunRecord;
      expect(record.runId).toBe(runReport.runId);
      expect(record.rootPath).toBe(".");
      const enhancedRecord = buildRunRecordEnhanced(record);
      expect(enhancedRecord).toBeDefined();
      const legacyPromptPath = join(
        repoRoot,
        ".voratiq",
        "runs",
        "sessions",
        runReport.runId,
        "prompt.txt",
      );
      await expect(access(legacyPromptPath)).rejects.toThrow();
    },
    RUN_INTEGRATION_TIMEOUT_MS,
  );

  it("records an in-progress run before agents execute", async () => {
    await createWorkspace(repoRoot);
    await writeAgentsConfig(workspace, agentScriptPath);

    const specPath = join(repoRoot, "specs", "progress.md");
    await mkdir(join(repoRoot, "specs"), { recursive: true });
    await writeFile(specPath, "# Progress Spec\nDo something.\n", "utf8");

    const appendSpy = jest.spyOn(persistence, "appendRunRecord");
    const rewriteSpy = jest.spyOn(persistence, "rewriteRunRecord");
    const prepareSpy = jest.spyOn(runAgentsModule, "prepareAgents");

    try {
      const report = await executeRunCommand({
        root: repoRoot,
        runsFilePath: join(repoRoot, ".voratiq", "runs", "index.json"),
        specAbsolutePath: specPath,
        specDisplayPath: relative(repoRoot, specPath),
      });

      expect(appendSpy).toHaveBeenCalledTimes(1);
      const appendCall = appendSpy.mock.calls[0]?.[0];
      expect(appendCall?.record.status).toBe("running");
      expect(appendCall?.record.agents).toHaveLength(0);

      expect(prepareSpy).toHaveBeenCalledTimes(1);
      const appendOrder = (appendSpy.mock.invocationCallOrder ?? [])[0];
      const prepareOrder = (prepareSpy.mock.invocationCallOrder ?? [])[0];
      const firstRewriteOrder = (rewriteSpy.mock.invocationCallOrder ?? [])[0];

      expect(typeof appendOrder).toBe("number");
      expect(typeof prepareOrder).toBe("number");
      expect(typeof firstRewriteOrder).toBe("number");
      expect(appendOrder).toBeLessThan(firstRewriteOrder);
      expect(firstRewriteOrder).toBeLessThan(prepareOrder);

      // Expect queued, running, and completed rewrites plus final run update.
      expect(rewriteSpy).toHaveBeenCalled();
      const pendingRecords: Promise<RunRecord>[] = [];
      for (const result of rewriteSpy.mock.results) {
        if (result.value === undefined) {
          continue;
        }
        const value: unknown = result.value;
        if (isPromiseOfRunRecord(value)) {
          pendingRecords.push(value);
        }
      }
      const rewriteResults = await Promise.all(pendingRecords);

      expect(rewriteResults.length).toBeGreaterThanOrEqual(
        AGENT_IDS.length + 1,
      );

      const queuedSnapshots = rewriteResults.slice(0, AGENT_IDS.length);
      queuedSnapshots.forEach((record, index) => {
        expect(record.status).toBe("running");
        expect(record.agents).toHaveLength(index + 1);
        record.agents.forEach((agentSnapshot) => {
          expect(agentSnapshot.status).toBe("queued");
        });
      });

      const terminalRecord = rewriteResults.at(-1);
      expect(terminalRecord?.status).toBe("succeeded");
      expect(terminalRecord?.runId).toBe(report.runId);
      expect(
        terminalRecord?.agents.every((agent) => agent.status !== "running"),
      ).toBe(true);
    } finally {
      appendSpy.mockRestore();
      rewriteSpy.mockRestore();
      prepareSpy.mockRestore();
    }
  });

  function isPromiseOfRunRecord(value: unknown): value is Promise<RunRecord> {
    return value instanceof Promise;
  }

  function expectDefined<T>(value: T | undefined | null, message: string): T {
    if (value === undefined || value === null) {
      throw new Error(message);
    }
    return value;
  }

  it("rejects dirty working trees before agents run", async () => {
    await createWorkspace(repoRoot);
    await writeAgentsConfig(workspace, agentScriptPath);

    const specRelativePath = "specs/blocking.md";
    const specPath = join(repoRoot, specRelativePath);
    await mkdir(join(repoRoot, "specs"), { recursive: true });
    await writeFile(specPath, "# Dirty Gate\n", "utf8");

    const readmePath = join(repoRoot, "README.md");
    await writeFile(readmePath, "# Voratiq Test Repo\nDirty change\n", "utf8");

    const originalCwd = process.cwd();
    process.chdir(repoRoot);

    let capturedError: unknown;
    try {
      await runRunCommand({ specPath: specRelativePath });
    } catch (error) {
      capturedError = error;
    } finally {
      process.chdir(originalCwd);
    }

    expect(capturedError).toBeInstanceOf(DirtyWorkingTreeError);
    const dirtyError = capturedError as DirtyWorkingTreeError;
    expect(dirtyError.message).toBe(
      "Repository has uncommitted tracked changes.",
    );
    expect(dirtyError.detailLines.join("\n")).toContain("README.md");

    const runDirectories = await readdir(join(repoRoot, ".voratiq", "runs"));
    expect(runDirectories).toContain("sessions");
    expect(runDirectories).toContain("index.json");
    const sessionEntries = await readdir(
      join(repoRoot, ".voratiq", "runs", "sessions"),
    );
    expect(sessionEntries).toHaveLength(0);

    const runsLog = await readFile(
      join(repoRoot, ".voratiq", "runs", "index.json"),
      "utf8",
    );
    const indexPayload = JSON.parse(runsLog) as RunIndexPayload;
    expect(indexPayload.sessions).toHaveLength(0);
  });

  it("fails fast when all agents are disabled", async () => {
    await createWorkspace(repoRoot);
    await writeAgentsConfig(workspace, agentScriptPath, {
      claude: { enabled: false },
      codex: { enabled: false },
      gemini: { enabled: false },
    });

    const specPath = join(repoRoot, "specs", "disabled.md");
    await mkdir(join(repoRoot, "specs"), { recursive: true });
    await writeFile(specPath, "Disabled agents\n", "utf8");

    await expect(
      executeRunCommand({
        root: repoRoot,
        runsFilePath: join(repoRoot, ".voratiq", "runs", "index.json"),
        specAbsolutePath: specPath,
        specDisplayPath: relative(repoRoot, specPath),
      }),
    ).rejects.toThrow(
      "No agents enabled in `.voratiq/agents.yaml`. Set `enabled: true` on at least one agent.",
    );
  });

  it(
    "respects --max-parallel limit and preserves deterministic ordering",
    async () => {
      await createWorkspace(repoRoot);
      await writeAgentsConfig(workspace, agentScriptPath);

      const specRelativePath = "specs/parallel.md";
      const specPath = join(repoRoot, specRelativePath);
      await mkdir(join(repoRoot, "specs"), { recursive: true });
      await writeFile(
        specPath,
        "# Parallel\nCheck deterministic ordering.\n",
        "utf8",
      );

      const originalCwd = process.cwd();
      process.chdir(repoRoot);
      let body = "";
      try {
        const result = await runRunCommand({
          specPath: specRelativePath,
          maxParallel: 2,
        });
        body = result.body;
      } finally {
        process.chdir(originalCwd);
      }
      const normalizedBody = body.replace(ANSI_PATTERN, "");
      const claudeIndex = normalizedBody.indexOf("  claude SUCCEEDED");
      const codexIndex = normalizedBody.indexOf("  codex SUCCEEDED");
      const geminiIndex = normalizedBody.indexOf("  gemini SUCCEEDED");

      expect(claudeIndex).toBeGreaterThanOrEqual(0);
      expect(codexIndex).toBeGreaterThanOrEqual(0);
      expect(geminiIndex).toBeGreaterThanOrEqual(0);
      expect(codexIndex).toBeGreaterThan(claudeIndex);
      expect(geminiIndex).toBeGreaterThan(codexIndex);

      const indexPath = join(repoRoot, ".voratiq", "runs", "index.json");
      const indexPayload = JSON.parse(
        await readFile(indexPath, "utf8"),
      ) as RunIndexPayload;
      const latestEntry =
        indexPayload.sessions[indexPayload.sessions.length - 1] ?? undefined;
      const recordId = latestEntry?.runId;
      expect(recordId).toBeDefined();
      if (!recordId) {
        throw new Error("Missing run record id");
      }

      const recordPath = join(
        repoRoot,
        ".voratiq",
        "runs",
        "sessions",
        recordId,
        "record.json",
      );
      const record = JSON.parse(
        await readFile(recordPath, "utf8"),
      ) as RunRecord;

      const agentIds = record.agents.map((agent) => agent.agentId);
      const expectedOrder = Array.from(AGENT_IDS).sort();
      expect(agentIds).toEqual(expectedOrder);
    },
    RUN_INTEGRATION_TIMEOUT_MS,
  );

  it("surfaces summary violations with clear messaging", async () => {
    await createWorkspace(repoRoot);
    const summarylessScriptPath = await createSummarylessAgentScript(repoRoot);
    await writeAgentsConfig(workspace, agentScriptPath, {
      codex: { binary: summarylessScriptPath },
    });

    const specPath = join(repoRoot, "specs", "missing-summary.md");
    await mkdir(join(repoRoot, "specs"), { recursive: true });
    await writeFile(specPath, "# Missing summary\nDo nothing.\n", "utf8");

    const runReport = await executeRunCommand({
      root: repoRoot,
      runsFilePath: join(repoRoot, ".voratiq", "runs", "index.json"),
      specAbsolutePath: specPath,
      specDisplayPath: relative(repoRoot, specPath),
    });

    const summarylessAgent = runReport.agents.find(
      (agent) => agent.agentId === "codex",
    );
    expect(summarylessAgent).toBeDefined();
    expect(summarylessAgent?.status).toBe("failed");
    expect(summarylessAgent?.error).toContain("ENOENT");
    expect(summarylessAgent?.diffAttempted).toBe(false);
  });

  it("reports no-workspace-changes when an agent exits without edits", async () => {
    await createWorkspace(repoRoot);
    const noChangeScriptPath = await createNoChangeAgentScript(repoRoot);
    await writeAgentsConfig(workspace, agentScriptPath, {
      codex: { binary: noChangeScriptPath },
    });

    const specPath = join(repoRoot, "specs", "no-edits.md");
    await mkdir(join(repoRoot, "specs"), { recursive: true });
    await writeFile(specPath, "# No edits\nDo nothing.\n", "utf8");

    const runReport = await executeRunCommand({
      root: repoRoot,
      runsFilePath: join(repoRoot, ".voratiq", "runs", "index.json"),
      specAbsolutePath: specPath,
      specDisplayPath: relative(repoRoot, specPath),
    });

    const noChangeAgent = runReport.agents.find(
      (agent) => agent.agentId === "codex",
    );
    expect(noChangeAgent).toBeDefined();
    expect(noChangeAgent?.status).toBe("failed");
    expect(noChangeAgent?.error).toBe(
      "Agent process failed. No workspace changes detected.",
    );
    expect(noChangeAgent?.diffAttempted).toBe(false);
  });

  it("marks signal-terminated agents as failures", async () => {
    await createWorkspace(repoRoot);
    const signalScriptPath = await createSignalTerminatingAgentScript(repoRoot);
    await writeAgentsConfig(workspace, agentScriptPath, {
      codex: { binary: signalScriptPath },
    });

    const specPath = join(repoRoot, "specs", "signal.md");
    await mkdir(join(repoRoot, "specs"), { recursive: true });
    await writeFile(specPath, "# Signal\nTest signal termination.\n", "utf8");

    const runReport = await executeRunCommand({
      root: repoRoot,
      runsFilePath: join(repoRoot, ".voratiq", "runs", "index.json"),
      specAbsolutePath: specPath,
      specDisplayPath: relative(repoRoot, specPath),
    });

    const signalAgent = runReport.agents.find(
      (agent) => agent.agentId === "codex",
    );
    expect(signalAgent).toBeDefined();
    expect(signalAgent?.status).toBe("failed");
    expect(signalAgent?.error).toBe(
      "Agent process failed. Please review the logs. (exit code 1)",
    );
  });

  it("surfaces git status failures from the failure classifier", async () => {
    await createWorkspace(repoRoot);
    const gitBreakerScript = await createGitBreakingAgentScript(repoRoot);
    await writeAgentsConfig(workspace, agentScriptPath, {
      codex: { binary: gitBreakerScript },
    });

    const specPath = join(repoRoot, "specs", "git-breaker.md");
    await mkdir(join(repoRoot, "specs"), { recursive: true });
    await writeFile(specPath, "# Git breaker\n", "utf8");

    const runReport = await executeRunCommand({
      root: repoRoot,
      runsFilePath: join(repoRoot, ".voratiq", "runs", "index.json"),
      specAbsolutePath: specPath,
      specDisplayPath: relative(repoRoot, specPath),
    });

    const gitFailureAgent = runReport.agents.find(
      (agent) => agent.agentId === "codex",
    );
    expect(gitFailureAgent).toBeDefined();
    expect(gitFailureAgent?.status).toBe("failed");
    expect(gitFailureAgent?.error).toBe(
      "Agent process failed. Please review the logs. (exit code 1)",
    );
  });
});

async function createAgentScript(root: string): Promise<string> {
  const scriptPath = join(root, "fake-agent.js");
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function extractPrompt(argv) {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.startsWith('--prompt=')) {
      return arg.slice('--prompt='.length);
    }
    if (typeof arg === 'string' && arg.startsWith('-p=')) {
      return arg.slice(3);
    }
  }

  const promptIndex = argv.findIndex((value) => value === '--prompt' || value === '-p');
  if (promptIndex >= 0 && typeof argv[promptIndex + 1] === 'string') {
    return argv[promptIndex + 1];
  }
  const lastArg = argv.at(-1);
  if (typeof lastArg === 'string' && !lastArg.startsWith('-')) {
    return lastArg;
  }
  return '';
}
let prompt = extractPrompt(process.argv.slice(2));
if (!prompt && !process.stdin.isTTY) {
  try {
    prompt = fs.readFileSync(0, 'utf8');
  } catch (error) {
    // ignore and fall back to empty prompt handling below
  }
}

if (!prompt) {
  console.error('Missing prompt input');
  process.exit(1);
}

const workspace = process.cwd();
const firstLine = prompt.split('\\n')[0] || '';
fs.writeFileSync(path.join(workspace, 'artifact.txt'), firstLine + '\\n', 'utf8');
fs.writeFileSync(path.join(workspace, '.summary.txt'), 'Implemented spec changes.', 'utf8');

console.log('stdout log');
console.error('stderr log');
`;

  await writeFile(scriptPath, script, { encoding: "utf8" });
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function createSummarylessAgentScript(root: string): Promise<string> {
  const scriptPath = join(root, "summaryless-agent.js");
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const workspace = process.cwd();
fs.writeFileSync(path.join(workspace, 'artifact.txt'), 'no summary', 'utf8');
console.log('stdout log');
console.error('stderr log');
`;

  await writeFile(scriptPath, script, { encoding: "utf8" });
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function createNoChangeAgentScript(root: string): Promise<string> {
  const scriptPath = join(root, "no-change-agent.js");
  const script = `#!/usr/bin/env node
console.log('stdout log');
console.error('stderr log');
`;

  await writeFile(scriptPath, script, { encoding: "utf8" });
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function createSignalTerminatingAgentScript(
  root: string,
): Promise<string> {
  const scriptPath = join(root, "signal-agent.js");
  const script = `#!/usr/bin/env node
process.kill(process.pid, 'SIGTERM');
setTimeout(() => {}, 1000);
`;

  await writeFile(scriptPath, script, { encoding: "utf8" });
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function createGitBreakingAgentScript(root: string): Promise<string> {
  const scriptPath = join(root, "git-breaker-agent.js");
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const workspace = process.cwd();
try {
  const gitFile = path.join(workspace, '.git');
  const contents = fs.readFileSync(gitFile, 'utf8');
  const parts = contents.split(/gitdir:/i);
  const gitDirPath = parts[1] ? parts[1].trim() : undefined;
  if (gitDirPath) {
    fs.rmSync(gitDirPath, { recursive: true, force: true });
  }
  fs.rmSync(gitFile, { force: true });
  fs.writeFileSync(gitFile, 'gitdir: /nonexistent/gitdir', 'utf8');
} catch (error) {
  console.error('failed to remove git metadata', error);
}

console.error('breaking git status and exiting');
process.exit(1);
`;

  await writeFile(scriptPath, script, { encoding: "utf8" });
  await chmod(scriptPath, 0o755);
  return scriptPath;
}
