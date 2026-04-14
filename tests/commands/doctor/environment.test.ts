import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { reconcileDoctorEnvironment } from "../../../src/commands/doctor/environment.js";
import { readEnvironmentConfig } from "../../../src/configs/environment/loader.js";

describe("reconcileDoctorEnvironment", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "voratiq-env-"));
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("excludes python from the summary when no virtual environment is detected", async () => {
    await mkdir(join(repoRoot, "node_modules"), { recursive: true });

    const summary = await reconcileDoctorEnvironment(repoRoot, {
      interactive: false,
    });

    expect(summary.detectedEntries).toEqual(["node"]);
    expect(summary.config.python).toBeUndefined();
  });

  it("rewrites malformed environment config from a clean baseline", async () => {
    const environmentPath = join(repoRoot, ".voratiq", "environment.yaml");
    await writeFile(environmentPath, "node: [\n", "utf8");

    const summary = await reconcileDoctorEnvironment(repoRoot, {
      interactive: false,
    });
    const current = await readFile(environmentPath, "utf8");

    expect(summary.configUpdated).toBe(true);
    expect(current).not.toContain("node: [");
    expect(() => readEnvironmentConfig(current)).not.toThrow();
  });
});
