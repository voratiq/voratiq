import { access, lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";

import {
  disposeHandles,
  type SecretHandle,
  stageSecretFile,
} from "../../../src/auth/providers/secret-staging.js";

describe("secret staging", () => {
  it("writes secrets as regular files with 0600 permissions and cleans up", async () => {
    const sandboxHome = await mkdtemp(join(os.tmpdir(), "voratiq-secret-"));
    const secretPath = join(sandboxHome, "secret.bin");
    const payload = Buffer.from("fixture");

    let handle: SecretHandle | undefined;
    try {
      handle = await stageSecretFile(sandboxHome, {
        destinationPath: secretPath,
        sourceBytes: payload,
        providerId: "test",
        fileLabel: "secret",
      });

      const stats = await lstat(secretPath);
      expect(stats.isFile()).toBe(true);
      expect(stats.mode & 0o777).toBe(0o600);
      const contents = await readFile(secretPath);
      expect(contents.equals(payload)).toBe(true);

      handle.abort();
      await expect(handle.cleanup()).resolves.toBeUndefined();
      await expect(access(secretPath)).rejects.toThrow();
      handle = undefined;
    } finally {
      if (handle) {
        await handle.cleanup();
      }
      await rm(sandboxHome, { recursive: true, force: true });
    }
  });

  it("disposes staged files when handles are disposed", async () => {
    const sandboxHome = await mkdtemp(join(os.tmpdir(), "voratiq-secret-"));
    const secretPath = join(sandboxHome, "dispose.bin");

    let handle: SecretHandle | undefined;
    try {
      handle = await stageSecretFile(sandboxHome, {
        destinationPath: secretPath,
        sourceBytes: Buffer.from("payload"),
        providerId: "test",
        fileLabel: "dispose",
      });

      await disposeHandles(handle ? [handle] : []);
      await expect(access(secretPath)).rejects.toThrow();
      handle = undefined;
    } finally {
      if (handle) {
        await handle.cleanup();
      }
      await rm(sandboxHome, { recursive: true, force: true });
    }
  });

  it("rejects staging outside of the sandbox home", async () => {
    const sandboxHome = await mkdtemp(join(os.tmpdir(), "voratiq-secret-"));
    const outsidePath = join(sandboxHome, "..", "leak.bin");
    await expect(
      stageSecretFile(sandboxHome, {
        destinationPath: outsidePath,
        sourceBytes: Buffer.from("payload"),
        providerId: "test",
        fileLabel: "leak",
      }),
    ).rejects.toThrow(/sandbox home/i);
    await rm(sandboxHome, { recursive: true, force: true });
  });
});
