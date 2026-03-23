/* eslint jest/no-standalone-expect: ["error", { "additionalTestBlockFunctions": ["sandboxTest"] }] */
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
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
} from "../../../src/agents/runtime/launcher.js";
import { prepareScratchAgentWorkspace } from "../../../src/workspace/agents.js";
import { buildScopedAgentWorkspacePaths } from "../../../src/workspace/layout.js";
import {
  isSandboxLocalBindingPermissionError,
  sandboxTest,
} from "../../support/sandbox-requirements.js";

const PROBE_SCRIPT_PATH = fileURLToPath(
  new URL("../../fixtures/sandbox/probe-write.py", import.meta.url),
);

async function setupVerifySandboxProbe(options: {
  targetDirName: "inputs" | "reference_repo";
}): Promise<{
  workspacePath: string;
  runtimeManifestPath: string;
  sandboxSettingsPath: string;
  stdoutPath: string;
  stderrPath: string;
  agentRoot: string;
  targetPath: string;
  backingTargetPath: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "voratiq-verify-sandbox-"));
  let setupComplete = false;

  try {
    await mkdir(join(root, ".voratiq"), { recursive: true });
    await writeFile(join(root, ".voratiq", "sandbox.yaml"), "providers: {}\n");

    const agentRoot = join(
      root,
      ".voratiq",
      "verifications",
      "sessions",
      "verify-1",
      "verifier-a",
      "rubrics",
      "run-review",
    );
    const workspacePaths = buildScopedAgentWorkspacePaths({ agentRoot });
    await prepareScratchAgentWorkspace({ paths: workspacePaths });

    const sharedInputs = join(
      root,
      ".voratiq",
      "verifications",
      "sessions",
      "verify-1",
      ".shared",
      "inputs",
    );
    const referenceRepo = join(
      root,
      ".voratiq",
      "verifications",
      "sessions",
      "verify-1",
      ".shared",
      "reference",
      "repo",
    );
    await mkdir(sharedInputs, { recursive: true });
    await mkdir(referenceRepo, { recursive: true });

    await symlink(
      sharedInputs,
      join(workspacePaths.workspacePath, "inputs"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await symlink(
      referenceRepo,
      join(workspacePaths.workspacePath, "reference_repo"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const promptPath = join(workspacePaths.runtimePath, "prompt.txt");
    await mkdir(dirname(promptPath), { recursive: true });
    await writeFile(promptPath, "# verify sandbox test\n", "utf8");

    await writeFile(
      workspacePaths.runtimeManifestPath,
      `${JSON.stringify(
        {
          binary: process.execPath,
          argv: ["-e", "process.exit(0)"],
          promptPath,
          workspace: workspacePaths.workspacePath,
          env: {},
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await configureSandboxSettings({
      sandboxHomePath: workspacePaths.sandboxHomePath,
      workspacePath: workspacePaths.workspacePath,
      providerId: "codex",
      stageId: "verify",
      root,
      sandboxSettingsPath: workspacePaths.sandboxSettingsPath,
      runtimePath: workspacePaths.runtimePath,
      artifactsPath: workspacePaths.artifactsPath,
      extraWriteProtectedPaths: [
        join(workspacePaths.workspacePath, "inputs"),
        join(workspacePaths.workspacePath, "reference_repo"),
        sharedInputs,
        referenceRepo,
      ],
    });

    setupComplete = true;
    return {
      workspacePath: workspacePaths.workspacePath,
      runtimeManifestPath: workspacePaths.runtimeManifestPath,
      sandboxSettingsPath: workspacePaths.sandboxSettingsPath,
      stdoutPath: workspacePaths.stdoutPath,
      stderrPath: workspacePaths.stderrPath,
      agentRoot: workspacePaths.agentRoot,
      targetPath: join(
        workspacePaths.workspacePath,
        options.targetDirName,
        "probe.txt",
      ),
      backingTargetPath: join(
        options.targetDirName === "inputs" ? sharedInputs : referenceRepo,
        "probe.txt",
      ),
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } finally {
    if (!setupComplete) {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function runWriteProbe(context: {
  runtimeManifestPath: string;
  sandboxSettingsPath: string;
  stdoutPath: string;
  stderrPath: string;
  agentRoot: string;
  targetPath: string;
}): Promise<{ exitCode: number | null; stderr: string }> {
  const result = await runAgentProcess({
    runtimeManifestPath: context.runtimeManifestPath,
    agentRoot: context.agentRoot,
    stdoutPath: context.stdoutPath,
    stderrPath: context.stderrPath,
    sandboxSettingsPath: context.sandboxSettingsPath,
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
          context.targetPath,
        ],
      };
    },
  });
  const stderr = await readFile(context.stderrPath, "utf8");
  return { exitCode: result.exitCode ?? null, stderr };
}

sandboxTest(
  "denies writes through the mounted verifier inputs path",
  async () => {
    const context = await setupVerifySandboxProbe({ targetDirName: "inputs" });
    try {
      const { exitCode, stderr } = await runWriteProbe(context);
      if (isSandboxLocalBindingPermissionError(stderr)) {
        return;
      }
      expect(exitCode).toBe(42);
      await expect(access(context.backingTargetPath)).rejects.toMatchObject({
        code: expect.stringMatching(/ENOENT|EACCES|EPERM/),
      });
    } finally {
      await context.cleanup();
    }
  },
);

sandboxTest(
  "denies writes through the mounted verifier reference_repo path",
  async () => {
    const context = await setupVerifySandboxProbe({
      targetDirName: "reference_repo",
    });
    try {
      const { exitCode, stderr } = await runWriteProbe(context);
      if (isSandboxLocalBindingPermissionError(stderr)) {
        return;
      }
      expect(exitCode).toBe(42);
      await expect(access(context.backingTargetPath)).rejects.toMatchObject({
        code: expect.stringMatching(/ENOENT|EACCES|EPERM/),
      });
    } finally {
      await context.cleanup();
    }
  },
);
