import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { composeStageSandboxPolicy } from "../../../src/competition/shared/sandbox-policy.js";
import type { EnvironmentConfig } from "../../../src/configs/environment/types.js";

describe("composeStageSandboxPolicy", () => {
  it("preserves configured dependency roots from repository-read isolation", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-sandbox-policy-"));

    try {
      await mkdir(join(root, ".voratiq"), { recursive: true });
      await mkdir(join(root, "dist"), { recursive: true });
      await mkdir(join(root, "node_modules", "jest", "bin"), {
        recursive: true,
      });
      await mkdir(join(root, "envs", "project"), { recursive: true });
      await writeFile(join(root, "README.md"), "# repo\n", "utf8");
      await writeFile(
        join(root, "node_modules", "jest", "bin", "jest.js"),
        "console.log('ok');\n",
        "utf8",
      );
      await writeFile(join(root, "envs", "project", "pyvenv.cfg"), "", "utf8");

      const environment: EnvironmentConfig = {
        node: { dependencyRoots: ["node_modules"] },
        python: { path: "envs/project" },
      };

      const policy = await composeStageSandboxPolicy({
        stageId: "run",
        root,
        workspacePath: join(
          root,
          ".voratiq",
          "run",
          "sessions",
          "run-1",
          "agent",
          "workspace",
        ),
        runtimePath: join(
          root,
          ".voratiq",
          "run",
          "sessions",
          "run-1",
          "agent",
          "runtime",
        ),
        sandboxHomePath: join(
          root,
          ".voratiq",
          "run",
          "sessions",
          "run-1",
          "agent",
          "sandbox",
          "home",
        ),
        environment,
      });

      expect(policy.extraReadProtectedPaths).not.toContain(
        join(root, "node_modules"),
      );
      expect(policy.extraReadProtectedPaths).not.toContain(
        join(root, "envs", "project"),
      );
      expect(policy.extraReadProtectedPaths).toContain(join(root, "README.md"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves dependency realpaths when the configured root is a repo symlink", async () => {
    const root = await mkdtemp(
      join(process.cwd(), ".tmp-voratiq-sandbox-policy-realpath-"),
    );

    try {
      await mkdir(join(root, ".voratiq"), { recursive: true });
      await mkdir(join(root, "dist"), { recursive: true });
      await mkdir(join(root, "vendor", "node_modules", "jest", "bin"), {
        recursive: true,
      });
      await writeFile(
        join(root, "vendor", "node_modules", "jest", "bin", "jest.js"),
        "console.log('ok');\n",
        "utf8",
      );
      await symlink(
        join(root, "vendor", "node_modules"),
        join(root, "node_modules"),
        "dir",
      );

      const policy = await composeStageSandboxPolicy({
        stageId: "run",
        root,
        workspacePath: join(
          root,
          ".voratiq",
          "run",
          "sessions",
          "run-1",
          "agent",
          "workspace",
        ),
        runtimePath: join(
          root,
          ".voratiq",
          "run",
          "sessions",
          "run-1",
          "agent",
          "runtime",
        ),
        sandboxHomePath: join(
          root,
          ".voratiq",
          "run",
          "sessions",
          "run-1",
          "agent",
          "sandbox",
          "home",
        ),
        environment: {
          node: { dependencyRoots: ["node_modules"] },
        },
      });

      expect(policy.extraReadProtectedPaths).not.toContain(
        join(root, "node_modules"),
      );
      expect(policy.extraReadProtectedPaths).not.toContain(
        join(root, "vendor"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
