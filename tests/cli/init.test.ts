import { describe, expect, it, jest } from "@jest/globals";

import { runInitCommand } from "../../src/cli/init.js";
import { executeInitCommand } from "../../src/commands/init/command.js";
import type { InitCommandResult } from "../../src/commands/init/types.js";
import { resolveCliContext } from "../../src/preflight/index.js";

jest.mock("../../src/preflight/index.js", () => ({
  resolveCliContext: jest.fn(),
}));

jest.mock("../../src/commands/init/command.js", () => ({
  executeInitCommand: jest.fn(),
}));

const resolveCliContextMock = jest.mocked(resolveCliContext);
const executeInitCommandMock = jest.mocked(executeInitCommand);

describe("voratiq init (cli)", () => {
  it("defaults to the pro preset when --yes is set and --preset is omitted", async () => {
    resolveCliContextMock.mockResolvedValue({
      root: "/repo",
      workspacePaths: {
        root: "/repo",
        workspaceDir: "/repo/.voratiq",
        runsDir: "/repo/.voratiq/run",
        runsFile: "/repo/.voratiq/run/index.json",
        reductionsDir: "/repo/.voratiq/reduce",
        reductionsFile: "/repo/.voratiq/reduce/index.json",
        specsDir: "/repo/.voratiq/spec",
        specsFile: "/repo/.voratiq/spec/index.json",
        verificationsDir: "/repo/.voratiq/verify",
        verificationsFile: "/repo/.voratiq/verify/index.json",
      },
    });
    executeInitCommandMock.mockResolvedValue({
      preset: "pro",
      workspaceResult: { createdDirectories: [], createdFiles: [] },
      agentSummary: {
        configPath: ".voratiq/agents.yaml",
        enabledAgents: [],
        agentCount: 0,
        zeroDetections: true,
        detectedProviders: [],
        providerEnablementPrompted: false,
        configCreated: false,
        configUpdated: false,
      },
      orchestrationSummary: {
        configPath: ".voratiq/orchestration.yaml",
        configCreated: false,
      },
      environmentSummary: {
        configPath: ".voratiq/environment.yaml",
        detectedEntries: [],
        configCreated: false,
        configUpdated: false,
        config: {},
      },
      sandboxSummary: {
        configPath: ".voratiq/sandbox.yaml",
        configCreated: false,
      },
    });

    await runInitCommand({ yes: true });

    expect(executeInitCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ preset: "pro" }),
    );
  });

  it("prints configuring progress as soon as preset is resolved", async () => {
    resolveCliContextMock.mockResolvedValue({
      root: "/repo",
      workspacePaths: {
        root: "/repo",
        workspaceDir: "/repo/.voratiq",
        runsDir: "/repo/.voratiq/run",
        runsFile: "/repo/.voratiq/run/index.json",
        reductionsDir: "/repo/.voratiq/reduce",
        reductionsFile: "/repo/.voratiq/reduce/index.json",
        specsDir: "/repo/.voratiq/spec",
        specsFile: "/repo/.voratiq/spec/index.json",
        verificationsDir: "/repo/.voratiq/verify",
        verificationsFile: "/repo/.voratiq/verify/index.json",
      },
    });
    executeInitCommandMock.mockImplementation((input) => {
      input.onPresetResolved?.("lite");
      const result: InitCommandResult = {
        preset: "lite",
        workspaceResult: { createdDirectories: [], createdFiles: [] },
        agentSummary: {
          configPath: ".voratiq/agents.yaml",
          enabledAgents: [],
          agentCount: 0,
          zeroDetections: true,
          detectedProviders: [],
          providerEnablementPrompted: false,
          configCreated: false,
          configUpdated: false,
        },
        orchestrationSummary: {
          configPath: ".voratiq/orchestration.yaml",
          configCreated: false,
        },
        environmentSummary: {
          configPath: ".voratiq/environment.yaml",
          detectedEntries: [],
          configCreated: false,
          configUpdated: false,
          config: {},
        },
        sandboxSummary: {
          configPath: ".voratiq/sandbox.yaml",
          configCreated: false,
        },
      };
      return Promise.resolve(result);
    });

    const stdout: string[] = [];
    const stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });

    try {
      const result = await runInitCommand({ yes: true, preset: "lite" });
      expect(result.body).not.toContain("Configuring workspace…");
      expect(stdout.join("")).toContain("\nConfiguring workspace…\n");
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});
