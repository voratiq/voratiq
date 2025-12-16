import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test } from "@jest/globals";

import { runAgentProcess } from "../../src/commands/run/agents/sandbox-launcher.js";
import { DEFAULT_DENIAL_BACKOFF } from "../../src/commands/run/sandbox.js";
import { buildAgentWorkspacePaths } from "../../src/workspace/layout.js";

const TEMP_PREFIX = "voratiq-denial-backoff-";

test("simulates an npm-hammer denial pattern and fail-fasts", async () => {
  const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  let setupComplete = false;

  try {
    const runId = "denial-backoff-test";
    const agentId = "codex";
    const workspacePaths = buildAgentWorkspacePaths({ root, runId, agentId });

    await mkdir(workspacePaths.agentRoot, { recursive: true });
    await mkdir(workspacePaths.workspacePath, { recursive: true });
    await mkdir(workspacePaths.runtimePath, { recursive: true });
    await mkdir(workspacePaths.sandboxPath, { recursive: true });
    await mkdir(workspacePaths.sandboxHomePath, { recursive: true });
    await mkdir(dirname(workspacePaths.runtimeManifestPath), {
      recursive: true,
    });
    await mkdir(dirname(workspacePaths.promptPath), { recursive: true });
    await mkdir(dirname(workspacePaths.stdoutPath), { recursive: true });
    await mkdir(dirname(workspacePaths.stderrPath), { recursive: true });
    await mkdir(dirname(workspacePaths.sandboxSettingsPath), {
      recursive: true,
    });

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
    await writeFile(
      workspacePaths.promptPath,
      "# denial backoff test\n",
      "utf8",
    );

    setupComplete = true;

    const denialLine =
      "[SandboxDebug] Denied by config rule: registry.npmjs.org:443\n";
    const script = [
      `const line=${JSON.stringify(denialLine)};`,
      "let count = 0;",
      "const emit = () => {",
      "  process.stdout.write(line);",
      "  count += 1;",
      "  if (count >= 4) { setTimeout(() => process.exit(0), 200); return; }",
      "  setTimeout(emit, 1);",
      "};",
      "emit();",
    ].join("");

    const result = await runAgentProcess({
      runtimeManifestPath: workspacePaths.runtimeManifestPath,
      agentRoot: workspacePaths.agentRoot,
      stdoutPath: workspacePaths.stdoutPath,
      stderrPath: workspacePaths.stderrPath,
      sandboxSettingsPath: workspacePaths.sandboxSettingsPath,
      denialBackoff: { ...DEFAULT_DENIAL_BACKOFF, delayMs: 1 },
      providerId: "codex",
      resolveRunInvocation: () => ({
        command: process.execPath,
        args: ["-e", script],
      }),
    });

    expect(result.watchdog?.trigger).toBe("sandbox-denial");
    expect(result.failFast).toEqual({
      operation: "network-connect",
      target: "registry.npmjs.org:443",
    });
    expect(result.errorMessage).toMatch(
      /Sandbox: repeated denial to registry\.npmjs\.org:443/u,
    );

    const stderr = await readFile(workspacePaths.stderrPath, "utf8");
    expect(stderr).toMatch(/SandboxBackoff: WARN/u);
  } finally {
    if (setupComplete) {
      await rm(root, { recursive: true, force: true });
    } else {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}, 30_000);
