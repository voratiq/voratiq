import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { runCli } from "../../src/bin.js";
import { appendRunRecord } from "../../src/runs/records/persistence.js";
import type { RunRecord } from "../../src/runs/records/types.js";
import { createWorkspace } from "../../src/workspace/setup.js";
import {
  resolveWorkspacePath,
  VORATIQ_RUNS_FILE,
} from "../../src/workspace/structure.js";

const execFileAsync = promisify(execFile);
const KEEP_DEBUG = process.env.VORATIQ_TEST_KEEP_REPO === "1";
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "..", "..");
const SHIM_RELATIVE_PATH = [
  "dist",
  "commands",
  "run",
  "shim",
  "run-agent-shim.mjs",
] as const;

export interface CliRunOptions {
  env?: NodeJS.ProcessEnv;
}

export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
}

export interface CreateTestWorkspaceOptions {
  autoSeedWorkspace?: boolean;
}

export class TestWorkspace {
  static async create(
    options: CreateTestWorkspaceOptions = {},
  ): Promise<TestWorkspace> {
    const root = await mkdtemp(join(tmpdir(), "voratiq-ws-"));
    const workspace = new TestWorkspace(root);
    await workspace.initializeGitRepository();
    await workspace.ensureShimPresent();

    if (options.autoSeedWorkspace) {
      await workspace.ensureWorkspace();
    }

    return workspace;
  }

  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  private async ensureShimPresent(): Promise<void> {
    const sourcePath = resolve(REPO_ROOT, ...SHIM_RELATIVE_PATH);
    try {
      await access(sourcePath);
    } catch {
      throw new Error(
        `Run shim missing at ${sourcePath}. Run "npm run build" before executing CLI integration tests.`,
      );
    }
    const targetPath = resolve(this.root, ...SHIM_RELATIVE_PATH);
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, { force: true });
  }

  get runsFilePath(): string {
    return resolveWorkspacePath(this.root, VORATIQ_RUNS_FILE);
  }

  async ensureWorkspace(
    commitMessage = "chore: seed voratiq workspace",
  ): Promise<void> {
    await createWorkspace(this.root);
    await this.git(["add", "."]);
    await this.safeCommit(commitMessage);
  }

  async seedRunRecords(records: readonly RunRecord[]): Promise<void> {
    await createWorkspace(this.root);
    for (const record of records) {
      await appendRunRecord({
        root: this.root,
        runsFilePath: this.runsFilePath,
        record,
      });
    }
  }

  async writeFile(repoRelativePath: string, contents: string): Promise<void> {
    const absolutePath = join(this.root, repoRelativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, "utf8");
  }

  async git(args: readonly string[]): Promise<void> {
    await execFileAsync("git", args, { cwd: this.root });
  }

  async runVoratiq(
    args: readonly string[],
    options: CliRunOptions = {},
  ): Promise<CliRunResult> {
    const argv = ["node", "voratiq", ...args];
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];
    const originalStdout = process.stdout.write.bind(process.stdout);
    const originalStderr = process.stderr.write.bind(process.stderr);
    const originalCwd = process.cwd();
    const envOverrides = options.env ?? {};
    const previousEnv: Record<string, string | undefined> = {};

    try {
      process.chdir(this.root);
      for (const [key, value] of Object.entries(envOverrides)) {
        previousEnv[key] = process.env[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      process.exitCode = undefined;
      process.stdout.write = ((chunk: unknown) => {
        stdoutBuffer.push(typeof chunk === "string" ? chunk : String(chunk));
        return true;
      }) as typeof process.stdout.write;

      process.stderr.write = ((chunk: unknown) => {
        stderrBuffer.push(typeof chunk === "string" ? chunk : String(chunk));
        return true;
      }) as typeof process.stderr.write;

      await runCli(argv);
    } finally {
      process.stdout.write = originalStdout;
      process.stderr.write = originalStderr;
      process.chdir(originalCwd);
      for (const key of Object.keys(envOverrides)) {
        const previousValue = previousEnv[key];
        if (previousValue === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previousValue;
        }
      }
    }

    const exitCode = process.exitCode;
    process.exitCode = undefined;

    return {
      stdout: stdoutBuffer.join(""),
      stderr: stderrBuffer.join(""),
      exitCode,
    };
  }

  async cleanup(): Promise<void> {
    if (KEEP_DEBUG) {
      return;
    }
    await rm(this.root, { recursive: true, force: true });
  }

  private async initializeGitRepository(): Promise<void> {
    await execFileAsync("git", ["init", "--initial-branch=main"], {
      cwd: this.root,
    });
    await execFileAsync("git", ["config", "user.name", "Voratiq Tests"], {
      cwd: this.root,
    });
    await execFileAsync("git", ["config", "user.email", "tests@voratiq.dev"], {
      cwd: this.root,
    });
  }

  private async safeCommit(message: string): Promise<void> {
    try {
      await execFileAsync("git", ["commit", "--allow-empty", "-m", message], {
        cwd: this.root,
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "stderr" in error &&
        typeof (error as { stderr?: unknown }).stderr === "string" &&
        (error as { stderr: string }).stderr.includes("nothing to commit")
      ) {
        return;
      }
      throw error;
    }
  }
}
