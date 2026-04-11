import { Command } from "commander";

import { createListCommand } from "../../src/cli/list.js";
import { writeCommandOutput } from "../../src/cli/output.js";
import { executeListCommand } from "../../src/commands/list/command.js";
import { resolveCliContext } from "../../src/preflight/index.js";
import { silenceCommander } from "../support/commander.js";

jest.mock("../../src/preflight/index.js", () => ({
  resolveCliContext: jest.fn(),
}));

jest.mock("../../src/commands/list/command.js", () => ({
  executeListCommand: jest.fn(),
}));

jest.mock("../../src/cli/output.js", () => ({
  writeCommandOutput: jest.fn(),
}));

const resolveCliContextMock = jest.mocked(resolveCliContext);
const executeListCommandMock = jest.mocked(executeListCommand);
const writeCommandOutputMock = jest.mocked(writeCommandOutput);

describe("voratiq list command options", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    resolveCliContextMock.mockResolvedValue({
      root: "/repo",
      workspacePaths: {
        root: "/repo",
        workspaceDir: "/repo/.voratiq",
        specsDir: "/repo/.voratiq/spec",
        specsFile: "/repo/.voratiq/spec/index.json",
        runsDir: "/repo/.voratiq/run",
        runsFile: "/repo/.voratiq/run/index.json",
        messagesDir: "/repo/.voratiq/message",
        messagesFile: "/repo/.voratiq/message/index.json",
        reductionsDir: "/repo/.voratiq/reduce",
        reductionsFile: "/repo/.voratiq/reduce/index.json",
        verificationsDir: "/repo/.voratiq/verify",
        verificationsFile: "/repo/.voratiq/verify/index.json",
        interactiveDir: "/repo/.voratiq/interactive",
        interactiveFile: "/repo/.voratiq/interactive/index.json",
      },
    });
    executeListCommandMock.mockResolvedValue({
      warnings: [],
      output: "table output",
      mode: "table",
      json: {
        operator: "run",
        mode: "list",
        sessions: [],
        warnings: [],
      },
    });
  });

  it("rejects when no operator flag is provided", async () => {
    const listCommand = silenceCommander(createListCommand());
    listCommand.exitOverride();
    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(listCommand);

    await expect(
      program.parseAsync(["node", "voratiq", "list"]),
    ).rejects.toMatchObject({
      code: "commander.error",
      exitCode: 1,
    });
    await expect(
      program.parseAsync(["node", "voratiq", "list"]),
    ).rejects.toThrow(
      /exactly one operator flag is required: `--spec`, `--run`, `--reduce`, `--verify`, `--message`, or `--interactive`/u,
    );
  });

  it("rejects when multiple operator flags are provided", async () => {
    const listCommand = silenceCommander(createListCommand());
    listCommand.exitOverride();
    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(listCommand);

    await expect(
      program.parseAsync(["node", "voratiq", "list", "--run", "--spec"]),
    ).rejects.toMatchObject({
      code: "commander.error",
      exitCode: 1,
    });
    await expect(
      program.parseAsync(["node", "voratiq", "list", "--run", "--spec"]),
    ).rejects.toThrow(
      /exactly one operator flag is required: `--spec`, `--run`, `--reduce`, `--verify`, `--message`, or `--interactive`/u,
    );
  });

  it("dispatches table mode when operator flag has no session id", async () => {
    const listCommand = silenceCommander(createListCommand());
    listCommand.exitOverride();
    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(listCommand);

    await program.parseAsync(["node", "voratiq", "list", "--run"]);

    expect(executeListCommandMock).toHaveBeenCalledWith({
      root: "/repo",
      specsFilePath: "/repo/.voratiq/spec/index.json",
      runsFilePath: "/repo/.voratiq/run/index.json",
      messagesFilePath: "/repo/.voratiq/message/index.json",
      reductionsFilePath: "/repo/.voratiq/reduce/index.json",
      verificationsFilePath: "/repo/.voratiq/verify/index.json",
      interactiveFilePath: "/repo/.voratiq/interactive/index.json",
      operator: "run",
      sessionId: undefined,
      limit: undefined,
      verbose: false,
    });
    expect(writeCommandOutputMock).toHaveBeenCalledWith({
      body: "table output",
      alerts: [],
    });
  });

  it("dispatches detail mode and emits normalized json with --json", async () => {
    executeListCommandMock.mockResolvedValue({
      warnings: [],
      output: "ignored in json mode",
      mode: "detail",
      json: {
        operator: "verify",
        mode: "detail",
        session: {
          operator: "verify",
          sessionId: "verify-123",
          status: "succeeded",
          createdAt: "2026-03-01T00:00:00.000Z",
          workspacePath: ".voratiq/verify/sessions/verify-123",
          agents: [],
        },
        warnings: [],
      },
    });

    const listCommand = silenceCommander(createListCommand());
    listCommand.exitOverride();
    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(listCommand);

    await program.parseAsync([
      "node",
      "voratiq",
      "list",
      "--verify",
      "verify-123",
      "--json",
    ]);

    expect(executeListCommandMock).toHaveBeenCalledWith({
      root: "/repo",
      specsFilePath: "/repo/.voratiq/spec/index.json",
      runsFilePath: "/repo/.voratiq/run/index.json",
      messagesFilePath: "/repo/.voratiq/message/index.json",
      reductionsFilePath: "/repo/.voratiq/reduce/index.json",
      verificationsFilePath: "/repo/.voratiq/verify/index.json",
      interactiveFilePath: "/repo/.voratiq/interactive/index.json",
      operator: "verify",
      sessionId: "verify-123",
      limit: undefined,
      verbose: false,
    });
    expect(writeCommandOutputMock).toHaveBeenCalledWith({
      body: JSON.stringify({
        operator: "verify",
        mode: "detail",
        session: {
          operator: "verify",
          sessionId: "verify-123",
          status: "succeeded",
          createdAt: "2026-03-01T00:00:00.000Z",
          workspacePath: ".voratiq/verify/sessions/verify-123",
          agents: [],
        },
        warnings: [],
      }),
    });
  });

  it("dispatches interactive table mode when --interactive is selected", async () => {
    const listCommand = silenceCommander(createListCommand());
    listCommand.exitOverride();
    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(listCommand);

    await program.parseAsync(["node", "voratiq", "list", "--interactive"]);

    expect(executeListCommandMock).toHaveBeenCalledWith({
      root: "/repo",
      specsFilePath: "/repo/.voratiq/spec/index.json",
      runsFilePath: "/repo/.voratiq/run/index.json",
      messagesFilePath: "/repo/.voratiq/message/index.json",
      reductionsFilePath: "/repo/.voratiq/reduce/index.json",
      verificationsFilePath: "/repo/.voratiq/verify/index.json",
      interactiveFilePath: "/repo/.voratiq/interactive/index.json",
      operator: "interactive",
      sessionId: undefined,
      limit: undefined,
      verbose: false,
    });
  });
});
