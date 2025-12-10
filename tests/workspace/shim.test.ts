import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { resolvePath } from "../../src/utils/path.js";
import { WorkspaceSetupError } from "../../src/workspace/errors.js";
import { ensureWorkspaceShim } from "../../src/workspace/shim.js";

const TMP_PREFIX = "voratiq-shim-test-";
const SHIM_RELATIVE_PATH = [
  "dist",
  "commands",
  "run",
  "shim",
  "run-agent-shim.mjs",
] as const;

describe("ensureWorkspaceShim", () => {
  it("links the shim into the workspace when present", async () => {
    const cliInstallRoot = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    const workspace = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    const shimSource = resolvePath(cliInstallRoot, ...SHIM_RELATIVE_PATH);
    await mkdir(dirname(shimSource), { recursive: true });
    await writeFile(shimSource, "console.log('shim');\n", "utf8");

    await ensureWorkspaceShim({
      workspacePath: workspace,
      cliInstallRoot,
    });

    const shimTarget = resolvePath(workspace, ...SHIM_RELATIVE_PATH);
    await expect(access(shimTarget)).resolves.toBeUndefined();
  });

  it("throws a WorkspaceSetupError when the shim is missing", async () => {
    const cliInstallRoot = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    const workspace = await mkdtemp(join(tmpdir(), TMP_PREFIX));

    await expect(
      ensureWorkspaceShim({
        workspacePath: workspace,
        cliInstallRoot,
      }),
    ).rejects.toBeInstanceOf(WorkspaceSetupError);
  });
});
