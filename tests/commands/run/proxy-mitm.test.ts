/* eslint jest/no-standalone-expect: ["error", { "additionalTestBlockFunctions": ["sandboxTest"] }] */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const TEMP_PREFIX = "voratiq-proxy-mitm-";
const TEST_AGENT_ID: AgentId = "codex";

function buildSandboxNetworkConfig(options: {
  allowedDomains: string[];
  allowLocalBinding?: boolean;
}): string {
  const lines = ["providers:", `  ${TEST_AGENT_ID}:`, "    network:"];
  lines.push("      allowedDomains:");
  for (const domain of options.allowedDomains) {
    lines.push(`        - ${domain}`);
  }
  if (options.allowLocalBinding) {
    lines.push("      allowLocalBinding: true");
  }
  return `${lines.join("\n")}\n`;
}

async function setupSandboxRun(options: { sandboxConfig: string }): Promise<{
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
      runId: "proxy-mitm-test",
      agentId: TEST_AGENT_ID,
    });
    const workspacePaths = buildRunAgentWorkspacePaths({
      root,
      runId: "proxy-mitm-test",
      agentId: TEST_AGENT_ID,
      corePaths,
    });

    await scaffoldAgentWorkspace(corePaths);
    await mkdir(workspacePaths.sandboxHomePath, { recursive: true });
    await mkdir(dirname(workspacePaths.runtimeManifestPath), {
      recursive: true,
    });

    const promptPath = join(workspacePaths.runtimePath, "prompt.txt");
    await mkdir(dirname(promptPath), { recursive: true });

    await writeFile(
      join(root, ".voratiq", "sandbox.yaml"),
      options.sandboxConfig,
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
    await writeFile(promptPath, "# proxy / mitm test\n", "utf8");

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
  "does not emit proxy requirement/failure errors when allow-listing domains",
  async () => {
    const context = await setupSandboxRun({
      sandboxConfig: buildSandboxNetworkConfig({
        allowedDomains: ["127.0.0.1"],
        allowLocalBinding: true,
      }),
    });

    try {
      const { workspacePaths } = context;
      const runScriptPath = join(workspacePaths.runtimePath, "proxy-mitm.js");
      await writeFile(
        runScriptPath,
        "process.stdout.write('proxy-mitm-ok');\n",
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
      expect(stderr).not.toMatch(
        /\bproxy\b.*\b(required|failure|failed|error)\b/iu,
      );
    } finally {
      await context.cleanup();
    }
  },
);
