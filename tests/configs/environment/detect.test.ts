import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  detectEnvironmentConfig,
  type PromptPathOptions,
} from "../../../src/configs/environment/detect.js";
import {
  getNodeDependencyRoots,
  getPythonEnvironmentPath,
} from "../../../src/configs/environment/types.js";

async function createTempProject(): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "voratiq-env-"));
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

describe("detectEnvironmentConfig", () => {
  it("reports detected node modules and python environments", async () => {
    const { root, cleanup } = await createTempProject();

    try {
      await mkdir(join(root, "node_modules"));
      await mkdir(join(root, ".venv"));

      const result = await detectEnvironmentConfig({
        root,
        interactive: false,
      });

      expect(result.detectedEntries).toContain("node");
      expect(result.detectedEntries).toContain("python.path=.venv");
      expect(getNodeDependencyRoots(result.config)).toEqual(["node_modules"]);
      expect(getPythonEnvironmentPath(result.config)).toBe(".venv");
    } finally {
      await cleanup();
    }
  });

  it("prompts for python path when markers exist", async () => {
    const { root, cleanup } = await createTempProject();

    try {
      await writeFile(join(root, "pyproject.toml"), "[tool.poetry]\n", "utf8");

      const prompts: string[] = [];
      const result = await detectEnvironmentConfig({
        root,
        interactive: true,
        promptPath: (options: PromptPathOptions) => {
          prompts.push(options.message);
          return Promise.resolve(".custom-venv");
        },
      });

      expect(prompts).toHaveLength(1);
      expect(getPythonEnvironmentPath(result.config)).toBe(".custom-venv");
      expect(result.detectedEntries).toContain("python.path=.custom-venv");
    } finally {
      await cleanup();
    }
  });
});
