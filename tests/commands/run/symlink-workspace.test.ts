/* eslint jest/no-standalone-expect: ["error", { "additionalTestBlockFunctions": ["sandboxTest"] }] */
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect } from "@jest/globals";

import {
  configureSandboxSettings,
  getRunCommand,
  runAgentProcess,
} from "../../../src/agents/runtime/launcher.js";
import { buildRunAgentWorkspacePaths } from "../../../src/commands/run/agents/workspace.js";
import type { AgentId } from "../../../src/configs/agents/types.js";
import {
  buildAgentWorkspacePaths,
  scaffoldAgentWorkspace,
} from "../../../src/workspace/layout.js";
import { sandboxTest } from "../../support/sandbox-requirements.js";

const TEMP_PREFIX = "voratiq-symlink-workspace-";
const TEST_AGENT_ID: AgentId = "codex";

async function setupSymlinkWorkspace(): Promise<{
  root: string;
  workspacePaths: ReturnType<typeof buildRunAgentWorkspacePaths>;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  let setupComplete = false;

  try {
    await mkdir(join(root, ".voratiq"), { recursive: true });

    const corePaths = buildAgentWorkspacePaths({
      root,
      runId: "symlink-workspace-test",
      agentId: TEST_AGENT_ID,
    });
    const workspacePaths = buildRunAgentWorkspacePaths({
      root,
      runId: "symlink-workspace-test",
      agentId: TEST_AGENT_ID,
      corePaths,
    });

    await scaffoldAgentWorkspace(corePaths);
    await mkdir(workspacePaths.sandboxHomePath, { recursive: true });
    await mkdir(dirname(workspacePaths.runtimeManifestPath), {
      recursive: true,
    });

    const realWorkspace = join(root, "real-workspace");
    await mkdir(realWorkspace, { recursive: true });
    await rm(workspacePaths.workspacePath, { recursive: true, force: true });
    await symlink(realWorkspace, workspacePaths.workspacePath);

    const promptPath = join(workspacePaths.runtimePath, "prompt.txt");
    await mkdir(dirname(promptPath), { recursive: true });

    await writeFile(
      join(root, ".voratiq", "sandbox.yaml"),
      "providers: {}\n",
      "utf8",
    );

    const manifest = {
      binary: process.execPath,
      argv: ["-e", "process.exit(0)"],
      promptPath,
      workspace: workspacePaths.workspacePath,
      env: {},
    };
    await writeFile(
      workspacePaths.runtimeManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await writeFile(promptPath, "# symlink workspace test\n", "utf8");

    await configureSandboxSettings({
      sandboxHomePath: workspacePaths.sandboxHomePath,
      workspacePath: workspacePaths.workspacePath,
      providerId: TEST_AGENT_ID,
      root,
      sandboxSettingsPath: workspacePaths.sandboxSettingsPath,
      runtimePath: workspacePaths.runtimePath,
      artifactsPath: workspacePaths.artifactsPath,
      extraWriteProtectedPaths: [workspacePaths.evalsDirPath],
      extraReadProtectedPaths: [workspacePaths.evalsDirPath],
    });

    setupComplete = true;
    return {
      root,
      workspacePaths,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } finally {
    if (!setupComplete) {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

sandboxTest(
  "runs successfully when the workspace path is a symlink",
  async () => {
    const context = await setupSymlinkWorkspace();
    try {
      const { workspacePaths } = context;
      const runScriptPath = join(
        workspacePaths.runtimePath,
        "symlink-workspace.js",
      );
      await writeFile(
        runScriptPath,
        "process.stdout.write('symlink-workspace-ok');\n",
        "utf8",
      );
      const result = await runAgentProcess({
        runtimeManifestPath: workspacePaths.runtimeManifestPath,
        agentRoot: workspacePaths.agentRoot,
        stdoutPath: workspacePaths.stdoutPath,
        stderrPath: workspacePaths.stderrPath,
        sandboxSettingsPath: workspacePaths.sandboxSettingsPath,
        resolveRunInvocation: async ({ settingsArg }) => {
          const command = await getRunCommand();
          return {
            command,
            args: [
              "--settings",
              settingsArg,
              "--",
              process.execPath,
              runScriptPath,
            ],
          };
        },
      });

      const stderr = await readFile(workspacePaths.stderrPath, "utf8");
      if (result.exitCode !== 0) {
        throw new Error(
          `Sandbox runtime exited with ${result.exitCode}. Stderr:\n${stderr}`,
        );
      }
      expect(stderr).not.toMatch(/\b(symlink|realpath|boundary|normalize)\b/iu);
    } finally {
      await context.cleanup();
    }
  },
);
