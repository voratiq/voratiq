import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { CliError } from "../../../src/cli/errors.js";
import {
  resolveExtraContextFiles,
  stageExtraContextFiles,
} from "../../../src/competition/shared/extra-context.js";

describe("extra-context staging", () => {
  it("resolves files deterministically and stages them under sibling context paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-extra-context-"));
    try {
      await mkdir(join(root, "notes"), { recursive: true });
      await writeFile(join(root, "notes", "a.md"), "A\n", "utf8");
      await writeFile(join(root, "notes", "b.json"), '{"b":1}\n', "utf8");

      const files = await resolveExtraContextFiles({
        root,
        paths: ["notes/a.md", "notes/b.json"],
      });

      expect(files.map((file) => file.displayPath)).toEqual([
        "notes/a.md",
        "notes/b.json",
      ]);
      expect(files.map((file) => file.stagedRelativePath)).toEqual([
        "../context/a.md",
        "../context/b.json",
      ]);

      const contextPath = join(root, "context");
      await mkdir(contextPath, { recursive: true });
      await stageExtraContextFiles({ contextPath, files });

      await expect(readFile(join(contextPath, "a.md"), "utf8")).resolves.toBe(
        "A\n",
      );
      await expect(readFile(join(contextPath, "b.json"), "utf8")).resolves.toBe(
        '{"b":1}\n',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("appends numeric suffixes when basenames collide", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-extra-context-"));
    try {
      await mkdir(join(root, "notes", "a"), { recursive: true });
      await mkdir(join(root, "notes", "b"), { recursive: true });
      await writeFile(
        join(root, "notes", "a", "reduction.json"),
        "A\n",
        "utf8",
      );
      await writeFile(
        join(root, "notes", "b", "reduction.json"),
        "B\n",
        "utf8",
      );

      const files = await resolveExtraContextFiles({
        root,
        paths: ["notes/a/reduction.json", "notes/b/reduction.json"],
      });

      expect(files.map((file) => file.stagedRelativePath)).toEqual([
        "../context/reduction.json",
        "../context/reduction-2.json",
      ]);

      const contextPath = join(root, "context");
      await mkdir(contextPath, { recursive: true });
      await stageExtraContextFiles({ contextPath, files });

      await expect(
        readFile(join(contextPath, "reduction.json"), "utf8"),
      ).resolves.toBe("A\n");
      await expect(
        readFile(join(contextPath, "reduction-2.json"), "utf8"),
      ).resolves.toBe("B\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts readable files outside the repo and preserves source provenance separately", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-extra-context-root-"));
    const external = await mkdtemp(
      join(tmpdir(), "voratiq-extra-context-external-"),
    );
    try {
      const externalFilePath = join(external, "carry-forward.md");
      await writeFile(externalFilePath, "External\n", "utf8");

      const files = await resolveExtraContextFiles({
        root,
        paths: [externalFilePath],
      });

      expect(files).toEqual([
        {
          absolutePath: externalFilePath,
          displayPath: externalFilePath,
          stagedRelativePath: "../context/carry-forward.md",
        },
      ]);

      const contextPath = join(root, "context");
      await mkdir(contextPath, { recursive: true });
      await stageExtraContextFiles({ contextPath, files });

      await expect(
        readFile(join(contextPath, "carry-forward.md"), "utf8"),
      ).resolves.toBe("External\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  });

  it("fails fast when a path does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-extra-context-"));
    try {
      let caught: unknown;
      try {
        await resolveExtraContextFiles({ root, paths: ["missing.txt"] });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(CliError);
      expect((caught as CliError).message).toContain("not found");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails fast when a path is not a file", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-extra-context-"));
    try {
      await mkdir(join(root, "notes"), { recursive: true });
      let caught: unknown;
      try {
        await resolveExtraContextFiles({ root, paths: ["notes"] });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(CliError);
      expect((caught as CliError).message).toContain("is not a file");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails fast when a file is not readable", async () => {
    if (process.platform === "win32" || process.getuid?.() === 0) {
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "voratiq-extra-context-"));
    try {
      await mkdir(join(root, "notes"), { recursive: true });
      const secretPath = join(root, "notes", "secret.txt");
      await writeFile(secretPath, "shh\n", "utf8");
      await chmod(secretPath, 0o000);

      // Some environments still allow reads here due to elevated privileges.
      await expect(access(secretPath, fsConstants.R_OK)).rejects.toMatchObject({
        code: expect.stringMatching(/^(EACCES|EPERM)$/),
      });

      let caught: unknown;
      try {
        await resolveExtraContextFiles({ root, paths: ["notes/secret.txt"] });
      } catch (error) {
        caught = error;
      } finally {
        await chmod(secretPath, 0o644);
      }

      expect(caught).toBeInstanceOf(CliError);
      expect((caught as CliError).message).toContain("not readable");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
