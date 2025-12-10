import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  it("injects workspace test flag into eval environment", async () => {
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
      VORATIQ_WORKSPACE_TESTS: "1",
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
});
