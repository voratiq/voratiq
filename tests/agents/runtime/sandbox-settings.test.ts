import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { generateSandboxSettings } from "../../../src/agents/runtime/sandbox.js";
import type { AgentId } from "../../../src/configs/agents/types.js";
import { buildAgentWorkspacePaths } from "../../../src/workspace/layout.js";

describe("generateSandboxSettings", () => {
  it("keeps artifacts and the repo root write-protected while allowing workspace staging", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-sandbox-settings-"));
    await mkdir(join(root, ".voratiq"), { recursive: true });
    await writeFile(
      join(root, ".voratiq", "sandbox.yaml"),
      "providers:\n  codex: {}\n",
      "utf8",
    );

    const agentId: AgentId = "codex";
    const workspacePaths = buildAgentWorkspacePaths({
      root,
      runId: "run-123",
      agentId,
    });

    const settings = generateSandboxSettings({
      sandboxHomePath: workspacePaths.sandboxHomePath,
      workspacePath: workspacePaths.workspacePath,
      providerId: agentId,
      root,
      repoRootPath: root,
      sandboxSettingsPath: workspacePaths.sandboxSettingsPath,
      runtimePath: workspacePaths.runtimePath,
      artifactsPath: workspacePaths.artifactsPath,
    });

    expect(settings.filesystem.allowWrite).toEqual(
      expect.arrayContaining([
        workspacePaths.workspacePath,
        workspacePaths.sandboxHomePath,
      ]),
    );
    expect(settings.filesystem.allowWrite).not.toContain(root);
    expect(settings.filesystem.denyWrite).toEqual(
      expect.arrayContaining([
        workspacePaths.artifactsPath,
        workspacePaths.runtimePath,
      ]),
    );
    await rm(root, { recursive: true, force: true });
  });
});
