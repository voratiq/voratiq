/* eslint jest/no-standalone-expect: ["error", { "additionalTestBlockFunctions": ["sandboxTest"] }] */
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "@jest/globals";

import {
  configureSandboxSettings,
  getRunCommand,
  runAgentProcess,
} from "../../src/commands/run/agents/sandbox-launcher.js";
import type { AgentId } from "../../src/configs/agents/types.js";
import {
  buildAgentWorkspacePaths,
  scaffoldAgentWorkspace,
} from "../../src/workspace/layout.js";
import { sandboxTest } from "../support/sandbox-requirements.js";

const PROBE_SCRIPT_PATH = fileURLToPath(
  new URL("../fixtures/sandbox/probe-write.py", import.meta.url),
);

const TEMP_PREFIX = "voratiq-sandbox-run-";
const TEST_AGENT_ID: AgentId = "codex";

type RunAgentResult = Awaited<ReturnType<typeof runAgentProcess>>;

interface SandboxProbeContext {
  root: string;
  workspacePaths: ReturnType<typeof buildAgentWorkspacePaths>;
  targetPath: string;
  cleanup: () => Promise<void>;
}

function buildSandboxFilesystemConfig(options: {
  allowWrite?: string[];
  denyWrite?: string[];
}): string {
  const { allowWrite = [], denyWrite = [] } = options;
  const lines = ["providers:", `  ${TEST_AGENT_ID}:`, "    filesystem:"];
  if (allowWrite.length === 0 && denyWrite.length === 0) {
    lines[2] += " {}";
    return `${lines.join("\n")}\n`;
  }
  if (allowWrite.length > 0) {
    lines.push("      allowWrite:");
    for (const entry of allowWrite) {
      lines.push(`        - ${entry}`);
    }
  }
  if (denyWrite.length > 0) {
    lines.push("      denyWrite:");
    for (const entry of denyWrite) {
      lines.push(`        - ${entry}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function setupSandboxProbe(options: {
  targetRelativePath: string;
  sandboxConfig: string;
}): Promise<SandboxProbeContext> {
  const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  let setupComplete = false;
  try {
    await mkdir(join(root, ".voratiq"), { recursive: true });
    const workspacePaths = buildAgentWorkspacePaths({
      root,
      runId: "sandbox-test",
      agentId: TEST_AGENT_ID,
    });
    await scaffoldAgentWorkspace(workspacePaths);
    await mkdir(workspacePaths.sandboxHomePath, { recursive: true });
    await mkdir(dirname(workspacePaths.runtimeManifestPath), {
      recursive: true,
    });
    await mkdir(dirname(workspacePaths.promptPath), { recursive: true });

    const targetPath = join(
      workspacePaths.workspacePath,
      options.targetRelativePath,
    );
    await mkdir(dirname(targetPath), { recursive: true });

    await writeFile(
      join(root, ".voratiq", "sandbox.yaml"),
      options.sandboxConfig,
      "utf8",
    );

    const manifest = {
      binary: process.execPath,
      argv: ["-e", "process.exit(0)"],
      promptPath: workspacePaths.promptPath,
      workspace: workspacePaths.workspacePath,
      env: {},
    };
    await writeFile(
      workspacePaths.runtimeManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await writeFile(workspacePaths.promptPath, "# sandbox test\n", "utf8");

    await configureSandboxSettings({
      workspacePaths,
      providerId: TEST_AGENT_ID,
      root,
    });

    setupComplete = true;
    return {
      root,
      workspacePaths,
      targetPath,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } finally {
    if (!setupComplete) {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function runWriteProbe(
  context: SandboxProbeContext,
): Promise<{ result: RunAgentResult; stderr: string }> {
  const { workspacePaths, targetPath } = context;
  const result = await runAgentProcess({
    ...workspacePaths,
    resolveRunInvocation: async ({ settingsArg }) => {
      const command = await getRunCommand();
      return {
        command,
        args: [
          "--settings",
          settingsArg,
          "--",
          "/usr/bin/env",
          "python3",
          PROBE_SCRIPT_PATH,
          "--target",
          targetPath,
        ],
      };
    },
  });
  const stderr = await readFile(workspacePaths.stderrPath, "utf8");
  return { result, stderr };
}

sandboxTest("denies writes to blocked workspace paths", async () => {
  const blockedRelative = "blocked";
  const context = await setupSandboxProbe({
    targetRelativePath: join(blockedRelative, "probe.txt"),
    sandboxConfig: buildSandboxFilesystemConfig({
      denyWrite: [blockedRelative],
    }),
  });

  try {
    const { result, stderr } = await runWriteProbe(context);
    expect(result.exitCode).toBe(42);
    await expect(access(context.targetPath)).rejects.toMatchObject({
      code: expect.stringMatching(/ENOENT|EACCES|EPERM/),
    });
    const expectedError =
      process.platform === "darwin"
        ? /write failed: Operation not permitted/i // sandbox-exec
        : /write failed: Read-only file system/i; // bubblewrap
    expect(stderr).toMatch(expectedError);
  } finally {
    await context.cleanup();
  }
});

sandboxTest("allows writes to allowed workspace paths", async () => {
  const allowedRelative = "allowed";
  const context = await setupSandboxProbe({
    targetRelativePath: join(allowedRelative, "probe.txt"),
    sandboxConfig: buildSandboxFilesystemConfig({
      allowWrite: [allowedRelative],
    }),
  });

  try {
    const { result, stderr } = await runWriteProbe(context);
    expect(result.exitCode).toBe(0);
    await expect(access(context.targetPath)).resolves.toBeUndefined();
    const contents = await readFile(context.targetPath, "utf8");
    expect(contents).toBe("sandbox-write");
    expect(stderr).not.toMatch(/write failed/i);
  } finally {
    await context.cleanup();
  }
});
