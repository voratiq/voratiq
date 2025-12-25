import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { promoteWorkspaceFile } from "../../src/workspace/promotion.js";

describe("promoteWorkspaceFile", () => {
  it("copies staged content into artifacts with an optional transform", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-promotion-"));
    const workspacePath = join(root, "workspace");
    const artifactsPath = join(root, "artifacts");
    const staged = join(workspacePath, "notes.txt");

    await mkdir(workspacePath, { recursive: true });
    await mkdir(artifactsPath, { recursive: true });
    await writeFile(staged, " hello world ", { encoding: "utf8", flag: "w" });

    const result = await promoteWorkspaceFile({
      workspacePath,
      artifactsPath,
      stagedRelativePath: "notes.txt",
      artifactRelativePath: "notes.txt",
      transform: (raw) => raw.toString("utf8").trim(),
    });

    expect(result.stagedPath).toContain("workspace");
    expect(result.artifactPath).toContain("artifacts");
    expect(await readFile(result.artifactPath, "utf8")).toBe("hello world");
    await expect(readFile(result.stagedPath, "utf8")).rejects.toBeDefined();
    await rm(root, { recursive: true, force: true });
  });

  it("rejects promotion when paths escape the declared roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-promotion-escape-"));
    const workspacePath = join(root, "workspace");
    const artifactsPath = join(root, "artifacts");
    const staged = join(workspacePath, "notes.txt");

    await mkdir(workspacePath, { recursive: true });
    await mkdir(artifactsPath, { recursive: true });
    await writeFile(staged, "ok", { encoding: "utf8", flag: "w" });

    await expect(
      promoteWorkspaceFile({
        workspacePath,
        artifactsPath,
        stagedRelativePath: "../notes.txt",
        artifactRelativePath: "notes.txt",
      }),
    ).rejects.toThrow(/workspace/);

    await expect(
      promoteWorkspaceFile({
        workspacePath,
        artifactsPath,
        stagedRelativePath: "notes.txt",
        artifactRelativePath: "../notes.txt",
      }),
    ).rejects.toThrow(/artifacts/);

    await rm(root, { recursive: true, force: true });
  });
});
