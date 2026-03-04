import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectBinary } from "../../src/utils/binaries.js";

describe("detectBinary", () => {
  let tempRoot: string;
  let originalPath: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "voratiq-binaries-"));
    originalPath = process.env.PATH;
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("prefers executables from prepended PATH entries", async () => {
    const preferredDir = join(tempRoot, "preferred");
    const fallbackDir = join(tempRoot, "fallback");
    await mkdir(preferredDir, { recursive: true });
    await mkdir(fallbackDir, { recursive: true });

    const commandName = "codex";
    const preferredBinary = join(preferredDir, commandName);
    const fallbackBinary = join(fallbackDir, commandName);

    await writeExecutable(preferredBinary);
    await writeExecutable(fallbackBinary);

    process.env.PATH = `${preferredDir}:${fallbackDir}:${originalPath ?? ""}`;

    expect(detectBinary(commandName)).toBe(preferredBinary);
  });

  it("returns undefined when the binary cannot be resolved", async () => {
    const emptyDir = join(tempRoot, "empty");
    await mkdir(emptyDir, { recursive: true });
    process.env.PATH = `${emptyDir}:${originalPath ?? ""}`;

    const commandName = `missing-voratiq-${Date.now()}-${process.pid}`;
    expect(detectBinary(commandName)).toBeUndefined();
  });
});

async function writeExecutable(path: string): Promise<void> {
  await writeFile(path, "#!/usr/bin/env bash\nexit 0\n", "utf8");
  await chmod(path, 0o755);
}
