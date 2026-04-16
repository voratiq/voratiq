import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readVerificationConfig } from "../../src/configs/verification/loader.js";
import { VORATIQ_MANAGED_STATE_FILE } from "../../src/workspace/constants.js";
import {
  WorkspaceMissingEntryError,
  WorkspaceSetupError,
  WorkspaceWrongTypeEntryError,
} from "../../src/workspace/errors.js";
import { resolveWorkspacePath } from "../../src/workspace/path-resolvers.js";
import {
  createWorkspace,
  validateWorkspace,
} from "../../src/workspace/setup.js";
import type { CreateWorkspaceResult } from "../../src/workspace/types.js";

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "voratiq-init-"));
  await mkdir(join(dir, ".git"), { recursive: true });
  return dir;
}

function normalizeForAssertion(value: string): string {
  return value.replace(/\\/g, "/");
}

interface PackageJsonFixture {
  scripts: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface VerificationSeedingCase {
  name: string;
  packageJson?: PackageJsonFixture;
  extraFiles?: Array<{ path: string; content: string }>;
  expectedProgrammatic: Array<{ slug: string; command: string }>;
  presentKeys: string[];
  absentKeys: string[];
}

describe("workspace bootstrap", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await createTempRepo();
  });

  afterEach(async () => {
    if (repoRoot) {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("creates minimal workspace and validates", async () => {
    const result: CreateWorkspaceResult = await createWorkspace(repoRoot);

    const createdDirs = result.createdDirectories.map((dir) =>
      normalizeForAssertion(dir),
    );
    const createdFiles = result.createdFiles.map((file) =>
      normalizeForAssertion(file),
    );

    expect(createdDirs).toEqual(
      expect.arrayContaining([
        normalizeForAssertion(".voratiq"),
        normalizeForAssertion(join(".voratiq", "interactive")),
        normalizeForAssertion(join(".voratiq", "spec")),
        normalizeForAssertion(join(".voratiq", "run")),
        normalizeForAssertion(join(".voratiq", "reduce")),
        normalizeForAssertion(join(".voratiq", "verify")),
        normalizeForAssertion(join(".voratiq", "message")),
        normalizeForAssertion(join(".voratiq", "interactive", "sessions")),
        normalizeForAssertion(join(".voratiq", "spec", "sessions")),
        normalizeForAssertion(join(".voratiq", "run", "sessions")),
        normalizeForAssertion(join(".voratiq", "reduce", "sessions")),
        normalizeForAssertion(join(".voratiq", "verify", "sessions")),
        normalizeForAssertion(join(".voratiq", "message", "sessions")),
      ]),
    );
    expect(
      createdDirs.filter((dir) =>
        [
          ".voratiq/spec",
          ".voratiq/run",
          ".voratiq/reduce",
          ".voratiq/verify",
          ".voratiq/message",
        ].includes(dir),
      ),
    ).toEqual([
      ".voratiq/spec",
      ".voratiq/run",
      ".voratiq/reduce",
      ".voratiq/verify",
      ".voratiq/message",
    ]);
    expect(createdFiles).toEqual(
      expect.arrayContaining([
        normalizeForAssertion(join(".voratiq", "interactive", "index.json")),
        normalizeForAssertion(join(".voratiq", "spec", "index.json")),
        normalizeForAssertion(join(".voratiq", "run", "index.json")),
        normalizeForAssertion(join(".voratiq", "reduce", "index.json")),
        normalizeForAssertion(join(".voratiq", "verify", "index.json")),
        normalizeForAssertion(join(".voratiq", "message", "index.json")),
        normalizeForAssertion(join(".voratiq", "agents.yaml")),
        normalizeForAssertion(join(".voratiq", "verification.yaml")),
        normalizeForAssertion(join(".voratiq", "environment.yaml")),
        normalizeForAssertion(join(".voratiq", "sandbox.yaml")),
        normalizeForAssertion(join(".voratiq", "orchestration.yaml")),
        normalizeForAssertion(join(".voratiq", VORATIQ_MANAGED_STATE_FILE)),
      ]),
    );
    expect(
      createdFiles.filter((file) =>
        [
          ".voratiq/spec/index.json",
          ".voratiq/run/index.json",
          ".voratiq/reduce/index.json",
          ".voratiq/verify/index.json",
          ".voratiq/message/index.json",
        ].includes(file),
      ),
    ).toEqual([
      ".voratiq/spec/index.json",
      ".voratiq/run/index.json",
      ".voratiq/reduce/index.json",
      ".voratiq/verify/index.json",
      ".voratiq/message/index.json",
    ]);

    await expect(validateWorkspace(repoRoot)).resolves.toBeUndefined();
  });

  it("seeds managed-state metadata when bootstrap creates managed config", async () => {
    await createWorkspace(repoRoot);

    const managedStatePath = resolveWorkspacePath(
      repoRoot,
      VORATIQ_MANAGED_STATE_FILE,
    );
    const content = JSON.parse(await readFile(managedStatePath, "utf8")) as {
      version: number;
      configs: {
        agents?: { fingerprint: string; managedEntriesFingerprint: string };
        orchestration?: { fingerprint: string; preset: string };
      };
    };

    expect(content.version).toBe(1);
    expect(content.configs.agents?.fingerprint).toBeTruthy();
    expect(content.configs.agents?.managedEntriesFingerprint).toBeTruthy();
    expect(content.configs.orchestration?.fingerprint).toBeTruthy();
    expect(content.configs.orchestration?.preset).toBe("pro");
  });

  it("seeds local git excludes for volatile .voratiq runtime state", async () => {
    await createWorkspace(repoRoot);

    const excludePath = join(repoRoot, ".git", "info", "exclude");
    const content = await readFile(excludePath, "utf8");

    expect(content).toContain("# voratiq runtime state (auto-managed)");
    expect(content).toContain("/.voratiq/*/index.json");
    expect(content).toContain("/.voratiq/*/sessions/");
    expect(content).toContain("/.voratiq/*/history.lock");
  });

  it("seeds local git excludes when .git is a worktree pointer file", async () => {
    const gitDir = join(repoRoot, "gitdir-target");
    await mkdir(join(gitDir, "info"), { recursive: true });
    await rm(join(repoRoot, ".git"), { recursive: true, force: true });
    await writeFile(join(repoRoot, ".git"), `gitdir: ${gitDir}\n`, "utf8");

    await createWorkspace(repoRoot);

    const excludePath = join(gitDir, "info", "exclude");
    const content = await readFile(excludePath, "utf8");

    expect(content).toContain("/.voratiq/*/index.json");
    expect(content).toContain("/.voratiq/*/sessions/");
  });

  it("fails validation when the interactive index is missing", async () => {
    await createWorkspace(repoRoot);
    const interactivePath = resolveWorkspacePath(
      repoRoot,
      "interactive",
      "index.json",
    );
    await rm(interactivePath, { force: true });

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceMissingEntryError,
    );
  });

  it("fails validation when the run index is missing", async () => {
    await createWorkspace(repoRoot);
    const runsPath = resolveWorkspacePath(repoRoot, "run", "index.json");
    await rm(runsPath, { force: true });

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceMissingEntryError,
    );
  });

  it("fails validation when the reduction index is missing", async () => {
    await createWorkspace(repoRoot);
    const reductionsPath = resolveWorkspacePath(
      repoRoot,
      "reduce",
      "index.json",
    );
    await rm(reductionsPath, { force: true });

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceMissingEntryError,
    );
  });

  it("fails validation when the verification index is missing", async () => {
    await createWorkspace(repoRoot);
    const verificationsPath = resolveWorkspacePath(
      repoRoot,
      "verify",
      "index.json",
    );
    await rm(verificationsPath, { force: true });

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceMissingEntryError,
    );
  });

  it("fails validation when agents.yaml is missing", async () => {
    await createWorkspace(repoRoot);
    const agentsPath = resolveWorkspacePath(repoRoot, "agents.yaml");
    await rm(agentsPath, { force: true });

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceMissingEntryError,
    );
  });

  it("fails validation when environment.yaml is missing", async () => {
    await createWorkspace(repoRoot);
    const environmentPath = resolveWorkspacePath(repoRoot, "environment.yaml");
    await rm(environmentPath, { force: true });

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceMissingEntryError,
    );
  });

  it("fails validation when sandbox.yaml is missing", async () => {
    await createWorkspace(repoRoot);
    const sandboxPath = resolveWorkspacePath(repoRoot, "sandbox.yaml");
    await rm(sandboxPath, { force: true });

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceMissingEntryError,
    );
  });

  it("fails validation when orchestration.yaml is missing", async () => {
    await createWorkspace(repoRoot);
    const orchestrationPath = resolveWorkspacePath(
      repoRoot,
      "orchestration.yaml",
    );
    await rm(orchestrationPath, { force: true });

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceMissingEntryError,
    );
  });

  it("fails validation when a workspace directory path is a file", async () => {
    await createWorkspace(repoRoot);
    const runsPath = resolveWorkspacePath(repoRoot, "run");
    await rm(runsPath, { recursive: true, force: true });
    await writeFile(runsPath, "");

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceWrongTypeEntryError,
    );
  });

  it("fails validation when a workspace file path is a directory", async () => {
    await createWorkspace(repoRoot);
    const agentsPath = resolveWorkspacePath(repoRoot, "agents.yaml");
    await rm(agentsPath, { force: true });
    await mkdir(agentsPath, { recursive: true });

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceWrongTypeEntryError,
    );
  });

  it("fails validation when an index payload is malformed", async () => {
    await createWorkspace(repoRoot);
    const runsPath = resolveWorkspacePath(repoRoot, "run", "index.json");
    await writeFile(runsPath, '{"version":2,', "utf8");

    await expect(validateWorkspace(repoRoot)).rejects.toBeInstanceOf(
      WorkspaceSetupError,
    );
  });

  it("seeds verification config from detected runnable defaults and static rubrics", async () => {
    await writePackageJson(repoRoot, {
      scripts: {
        "format:check": "prettier --check .",
        lint: "eslint .",
        test: "jest",
      },
      devDependencies: {
        typescript: "^5.0.0",
      },
    });
    await writeFile(join(repoRoot, "tsconfig.typecheck.json"), "{}\n", "utf8");

    await createWorkspace(repoRoot);

    const content = await readFile(
      resolveWorkspacePath(repoRoot, "verification.yaml"),
      "utf8",
    );
    const config = readVerificationConfig(content);

    expect(config.spec.rubric).toEqual([{ template: "spec-verification" }]);
    expect(config.run.programmatic).toEqual([
      { slug: "format", command: "npm run format:check" },
      { slug: "lint", command: "npm run lint" },
      {
        slug: "typecheck",
        command: "npx tsc --project tsconfig.typecheck.json --noEmit",
      },
      { slug: "tests", command: "npm run test" },
    ]);
    expect(config.run.rubric).toEqual([{ template: "run-verification" }]);
    expect(config.reduce.rubric).toEqual([{ template: "reduce-verification" }]);
    expect(config.message.rubric).toEqual([
      { template: "message-verification" },
    ]);
    expect(content).not.toContain("scope:");
  });

  const verificationSeedingCases: VerificationSeedingCase[] = [
    {
      name: "format only",
      packageJson: {
        scripts: {
          "format:check": "prettier --check .",
        },
      },
      expectedProgrammatic: [
        { slug: "format", command: "npm run format:check" },
      ],
      presentKeys: ["format"],
      absentKeys: ["lint", "typecheck", "tests"],
    },
    {
      name: "lint only",
      packageJson: {
        scripts: {
          lint: "eslint .",
        },
      },
      expectedProgrammatic: [{ slug: "lint", command: "npm run lint" }],
      presentKeys: ["lint"],
      absentKeys: ["format", "typecheck", "tests"],
    },
    {
      name: "tests only",
      packageJson: {
        scripts: {
          test: "jest",
        },
      },
      expectedProgrammatic: [{ slug: "tests", command: "npm run test" }],
      presentKeys: ["tests"],
      absentKeys: ["format", "lint", "typecheck"],
    },
    {
      name: "typecheck only",
      packageJson: {
        scripts: {},
      },
      extraFiles: [{ path: "tsconfig.typecheck.json", content: "{}\n" }],
      expectedProgrammatic: [
        {
          slug: "typecheck",
          command: "npx tsc --project tsconfig.typecheck.json --noEmit",
        },
      ],
      presentKeys: ["typecheck"],
      absentKeys: ["format", "lint", "tests"],
    },
    {
      name: "no detectable checks",
      expectedProgrammatic: [],
      presentKeys: [],
      absentKeys: ["format", "lint", "typecheck", "tests"],
    },
  ];

  it.each(verificationSeedingCases)(
    "seeds verification config without hardcoded TS/Node commands when detection finds $name",
    async ({
      packageJson,
      extraFiles,
      expectedProgrammatic,
      presentKeys,
      absentKeys,
    }) => {
      if (packageJson) {
        await writePackageJson(repoRoot, packageJson);
      }
      for (const file of extraFiles ?? []) {
        await writeFile(join(repoRoot, file.path), file.content, "utf8");
      }

      await createWorkspace(repoRoot);

      const content = await readFile(
        resolveWorkspacePath(repoRoot, "verification.yaml"),
        "utf8",
      );
      const config = readVerificationConfig(content);

      expect(config.run.programmatic).toEqual(expectedProgrammatic);
      expect(content).toContain("template: spec-verification");
      expect(content).toContain("template: run-verification");
      expect(content).toContain("template: reduce-verification");
      expect(content).not.toContain("scope:");

      for (const key of presentKeys) {
        expect(content).toContain(`    ${key}:`);
      }
      for (const key of absentKeys) {
        expect(content).not.toContain(`    ${key}:`);
      }

      expect(content.includes("  programmatic:")).toBe(
        expectedProgrammatic.length > 0,
      );
    },
  );
});

async function writePackageJson(
  root: string,
  options: PackageJsonFixture,
): Promise<void> {
  const packageJson = {
    name: "workspace-test-project",
    version: "0.0.0",
    scripts: options.scripts,
    devDependencies: options.devDependencies ?? {},
  };
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(packageJson, null, 2),
    "utf8",
  );
}
