import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configureEnvironment } from "../../../src/commands/init/environment.js";

describe("configureEnvironment", () => {
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

    const summary = await configureEnvironment(repoRoot, {
      interactive: false,
    });

    expect(summary.detectedEntries).toEqual(["node"]);
    expect(summary.config.python).toBeUndefined();
  });
});
