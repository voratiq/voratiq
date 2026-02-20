import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { executeEvaluations } from "../../src/evals/runner.js";
import { spawnStreamingProcess } from "../../src/utils/process.js";

jest.mock("../../src/utils/process.js", () => ({
  spawnStreamingProcess: jest.fn(),
}));

const mockedSpawnStreamingProcess =
  spawnStreamingProcess as jest.MockedFunction<typeof spawnStreamingProcess>;

describe("executeEvaluations", () => {
  beforeEach(() => {
    mockedSpawnStreamingProcess.mockReset();
  });

  it("passes environment overrides to eval subprocess", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "voratiq-runner-"));
    const logsDirectory = join(workspaceRoot, "logs");
    const envOverrides: NodeJS.ProcessEnv = {
      CUSTOM_FLAG: "enabled",
    };

    mockedSpawnStreamingProcess.mockResolvedValue({
      exitCode: 0,
      signal: null,
    });

    const { results, warnings } = await executeEvaluations({
      evaluations: [{ slug: "tests", command: "npm test" }],
      cwd: workspaceRoot,
      root: workspaceRoot,
      logsDirectory,
      env: envOverrides,
      environment: { node: { dependencyRoots: ["node_modules"] } },
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      slug: "tests",
      status: "succeeded",
    });
    expect(warnings).toEqual([]);

    expect(mockedSpawnStreamingProcess).toHaveBeenCalledTimes(1);
    const spawnCall = mockedSpawnStreamingProcess.mock.calls[0][0];
    expect(spawnCall.env).toMatchObject({
      CUSTOM_FLAG: "enabled",
    });
    expect(spawnCall.env).not.toBe(envOverrides);
    expect(envOverrides).toEqual({ CUSTOM_FLAG: "enabled" });
  });

  it("returns missing stack warnings instead of writing to stderr", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "voratiq-runner-"));
    const logsDirectory = join(workspaceRoot, "logs");
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    const stderrCalls: unknown[] = [];

    process.stderr.write = jest.fn((chunk: unknown) => {
      stderrCalls.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      mockedSpawnStreamingProcess.mockResolvedValue({
        exitCode: 0,
        signal: null,
      });

      const { results, warnings } = await executeEvaluations({
        evaluations: [{ slug: "tests", command: "npm test" }],
        cwd: workspaceRoot,
        root: workspaceRoot,
        logsDirectory,
        environment: {},
      });

      expect(results).toHaveLength(1);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("requires node tooling");
      expect(stderrCalls).toEqual([]);
    } finally {
      process.stderr.write = originalStderrWrite;
    }
  });

  it("creates missing trusted temp directories before spawning eval commands", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "voratiq-runner-"));
    const logsDirectory = join(workspaceRoot, "logs");
    const tmpPath = join(workspaceRoot, "sandbox", "tmp");

    mockedSpawnStreamingProcess.mockResolvedValue({
      exitCode: 0,
      signal: null,
    });

    const { results, warnings } = await executeEvaluations({
      evaluations: [{ slug: "tests", command: "uv run pytest" }],
      cwd: workspaceRoot,
      root: workspaceRoot,
      logsDirectory,
      env: { TMPDIR: tmpPath, TMP: tmpPath, TEMP: tmpPath },
      environment: {},
      envDirectoryGuard: {
        trustedAbsoluteRoots: [workspaceRoot],
        includeHomeForPythonStack: true,
        failOnDirectoryPreparationError: true,
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("succeeded");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("requires python tooling");
    await expect(access(tmpPath)).resolves.toBeUndefined();
  });

  it("skips untrusted absolute env directories and emits warnings", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "voratiq-runner-"));
    const logsDirectory = join(workspaceRoot, "logs");
    const outsideTmpPath = join(
      dirname(tmpdir()),
      `voratiq-untrusted-${Date.now()}`,
      "tmp",
    );

    mockedSpawnStreamingProcess.mockResolvedValue({
      exitCode: 0,
      signal: null,
    });

    const { results, warnings } = await executeEvaluations({
      evaluations: [{ slug: "tests", command: "echo ok" }],
      cwd: workspaceRoot,
      root: workspaceRoot,
      logsDirectory,
      env: { TMPDIR: outsideTmpPath },
      environment: {},
      envDirectoryGuard: {
        trustedAbsoluteRoots: [workspaceRoot],
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("succeeded");
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("outside trusted roots"),
      ]),
    );
  });

  it("fails fast with an explicit error when trusted env prep cannot complete", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "voratiq-runner-"));
    const logsDirectory = join(workspaceRoot, "logs");
    const invalidTmpPath = join(workspaceRoot, "tmp-as-file");
    await writeFile(invalidTmpPath, "not a directory", "utf8");

    await expect(
      executeEvaluations({
        evaluations: [{ slug: "tests", command: "uv run pytest" }],
        cwd: workspaceRoot,
        root: workspaceRoot,
        logsDirectory,
        env: { TMPDIR: invalidTmpPath },
        environment: {},
        envDirectoryGuard: {
          trustedAbsoluteRoots: [workspaceRoot],
          includeHomeForPythonStack: true,
          failOnDirectoryPreparationError: true,
        },
      }),
    ).rejects.toThrow(
      /Eval environment preparation failed for "tests": required eval env directory prep failed/u,
    );

    expect(mockedSpawnStreamingProcess).not.toHaveBeenCalled();
  });
});
