import { describe, expect, it, jest } from "@jest/globals";
import { Command } from "commander";

import { createConfirmationWorkflow } from "../../src/cli/confirmation.js";
import { createDoctorCommand, runDoctorCommand } from "../../src/cli/doctor.js";
import {
  executeDoctorDiagnosis,
  executeDoctorFix,
  resolveDoctorFixMode,
} from "../../src/commands/doctor/command.js";
import { resolveCliContext } from "../../src/preflight/index.js";
import { isInteractiveShell } from "../../src/utils/terminal.js";
import { silenceCommander } from "../support/commander.js";

jest.mock("../../src/cli/confirmation.js", () => ({
  createConfirmationWorkflow: jest.fn(),
}));

jest.mock("../../src/preflight/index.js", () => ({
  resolveCliContext: jest.fn(),
}));

jest.mock("../../src/commands/doctor/command.js", () => ({
  executeDoctorDiagnosis: jest.fn(),
  executeDoctorFix: jest.fn(),
  resolveDoctorFixMode: jest.fn(),
}));

jest.mock("../../src/utils/terminal.js", () => ({
  isInteractiveShell: jest.fn(),
}));

const createConfirmationWorkflowMock = jest.mocked(createConfirmationWorkflow);
const resolveCliContextMock = jest.mocked(resolveCliContext);
const executeDoctorDiagnosisMock = jest.mocked(executeDoctorDiagnosis);
const executeDoctorFixMock = jest.mocked(executeDoctorFix);
const resolveDoctorFixModeMock = jest.mocked(resolveDoctorFixMode);
const isInteractiveShellMock = jest.mocked(isInteractiveShell);

describe("voratiq doctor (cli)", () => {
  beforeEach(() => {
    isInteractiveShellMock.mockReturnValue(false);
    createConfirmationWorkflowMock.mockReturnValue({
      interactive: false,
      confirm: () => Promise.resolve(true),
      prompt: () => Promise.resolve(""),
      close: jest.fn(),
    });
  });

  it("returns minimal healthy output with exit code 0", async () => {
    resolveCliContextMock.mockResolvedValue({
      root: "/repo",
      workspacePaths: {
        root: "/repo",
        workspaceDir: "/repo/.voratiq",
        runsDir: "/repo/.voratiq/run",
        runsFile: "/repo/.voratiq/run/index.json",
        reductionsDir: "/repo/.voratiq/reduce",
        reductionsFile: "/repo/.voratiq/reduce/index.json",
        messagesDir: "/repo/.voratiq/message",
        messagesFile: "/repo/.voratiq/message/index.json",
        interactiveDir: "/repo/.voratiq/interactive",
        interactiveFile: "/repo/.voratiq/interactive/index.json",
        specsDir: "/repo/.voratiq/spec",
        specsFile: "/repo/.voratiq/spec/index.json",
        verificationsDir: "/repo/.voratiq/verify",
        verificationsFile: "/repo/.voratiq/verify/index.json",
      },
    });
    executeDoctorDiagnosisMock.mockResolvedValue({
      healthy: true,
      issueLines: [],
    });

    const result = await runDoctorCommand();

    expect(result).toEqual({
      body: "healthy",
      exitCode: 0,
    });
  });

  it("returns issue output with doctor --fix as the primary next action", async () => {
    resolveCliContextMock.mockResolvedValue({
      root: "/repo",
      workspacePaths: {
        root: "/repo",
        workspaceDir: "/repo/.voratiq",
        runsDir: "/repo/.voratiq/run",
        runsFile: "/repo/.voratiq/run/index.json",
        reductionsDir: "/repo/.voratiq/reduce",
        reductionsFile: "/repo/.voratiq/reduce/index.json",
        messagesDir: "/repo/.voratiq/message",
        messagesFile: "/repo/.voratiq/message/index.json",
        interactiveDir: "/repo/.voratiq/interactive",
        interactiveFile: "/repo/.voratiq/interactive/index.json",
        specsDir: "/repo/.voratiq/spec",
        specsFile: "/repo/.voratiq/spec/index.json",
        verificationsDir: "/repo/.voratiq/verify",
        verificationsFile: "/repo/.voratiq/verify/index.json",
      },
    });
    executeDoctorDiagnosisMock.mockResolvedValue({
      healthy: false,
      issueLines: ["- Missing workspace entry: `.voratiq/agents.yaml`."],
    });

    const result = await runDoctorCommand();

    expect(result.exitCode).toBe(1);
    expect(result.body).toBe(
      [
        "issues found",
        "- Missing workspace entry: `.voratiq/agents.yaml`.",
        "",
        "next: `voratiq doctor --fix`",
      ].join("\n"),
    );
  });

  it("emits explicit mutation messaging before fix mode", async () => {
    resolveCliContextMock.mockResolvedValue({
      root: "/repo",
      workspacePaths: {
        root: "/repo",
        workspaceDir: "/repo/.voratiq",
        runsDir: "/repo/.voratiq/run",
        runsFile: "/repo/.voratiq/run/index.json",
        reductionsDir: "/repo/.voratiq/reduce",
        reductionsFile: "/repo/.voratiq/reduce/index.json",
        messagesDir: "/repo/.voratiq/message",
        messagesFile: "/repo/.voratiq/message/index.json",
        interactiveDir: "/repo/.voratiq/interactive",
        interactiveFile: "/repo/.voratiq/interactive/index.json",
        specsDir: "/repo/.voratiq/spec",
        specsFile: "/repo/.voratiq/spec/index.json",
        verificationsDir: "/repo/.voratiq/verify",
        verificationsFile: "/repo/.voratiq/verify/index.json",
      },
    });
    resolveDoctorFixModeMock.mockResolvedValue("repair-and-reconcile");
    executeDoctorFixMock.mockResolvedValue({
      mode: "repair-and-reconcile",
      reconcileResult: {
        workspaceBootstrapped: false,
        agentSummary: {
          configPath: ".voratiq/agents.yaml",
          enabledAgents: [],
          agentCount: 0,
          zeroDetections: true,
          detectedProviders: [],
          providerEnablementPrompted: false,
          configCreated: false,
          configUpdated: false,
          managed: true,
        },
        environmentSummary: {
          configPath: ".voratiq/environment.yaml",
          detectedEntries: [],
          configCreated: false,
          configUpdated: false,
          config: {},
        },
        orchestrationSummary: {
          configPath: ".voratiq/orchestration.yaml",
          configCreated: false,
          configUpdated: false,
          skippedCustomized: true,
          managed: false,
          preset: "pro",
        },
      },
    });

    const outputWrites: string[] = [];
    const result = await runDoctorCommand({
      fix: true,
      writeOutput: (payload) => {
        const alertMessages = (payload.alerts ?? []).map(
          (alert) => alert.message,
        );
        if (alertMessages.length > 0) {
          outputWrites.push(...alertMessages);
        }
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.body).toContain("Repair complete.");
    expect(outputWrites).toEqual([
      "Workspace found. This will repair structure and reconcile managed config.",
    ]);
  });

  it("preserves interactive bootstrap behavior for missing workspaces", async () => {
    const confirm = () => Promise.resolve(true);
    const prompt = () => Promise.resolve("1");
    const close = jest.fn();

    resolveCliContextMock.mockResolvedValue({
      root: "/repo",
      workspacePaths: {
        root: "/repo",
        workspaceDir: "/repo/.voratiq",
        runsDir: "/repo/.voratiq/run",
        runsFile: "/repo/.voratiq/run/index.json",
        reductionsDir: "/repo/.voratiq/reduce",
        reductionsFile: "/repo/.voratiq/reduce/index.json",
        messagesDir: "/repo/.voratiq/message",
        messagesFile: "/repo/.voratiq/message/index.json",
        interactiveDir: "/repo/.voratiq/interactive",
        interactiveFile: "/repo/.voratiq/interactive/index.json",
        specsDir: "/repo/.voratiq/spec",
        specsFile: "/repo/.voratiq/spec/index.json",
        verificationsDir: "/repo/.voratiq/verify",
        verificationsFile: "/repo/.voratiq/verify/index.json",
      },
    });
    isInteractiveShellMock.mockReturnValue(true);
    createConfirmationWorkflowMock.mockReturnValue({
      interactive: true,
      confirm,
      prompt,
      close,
    });
    resolveDoctorFixModeMock.mockResolvedValue("bootstrap-workspace");
    executeDoctorFixMock.mockResolvedValue({
      mode: "bootstrap-workspace",
    });

    await runDoctorCommand({ fix: true });

    expect(executeDoctorFixMock).toHaveBeenCalledWith({
      root: "/repo",
      mode: "bootstrap-workspace",
      bootstrapOptions: {
        preset: "pro",
        interactive: true,
        assumeYes: false,
        confirm,
        prompt,
      },
    });
    expect(createConfirmationWorkflowMock).toHaveBeenCalledWith({
      assumeYes: false,
      onUnavailable: expect.any(Function),
    });
    expect(close).toHaveBeenCalled();
  });

  it("keeps non-interactive fix mode deterministic", async () => {
    const close = jest.fn();

    resolveCliContextMock.mockResolvedValue({
      root: "/repo",
      workspacePaths: {
        root: "/repo",
        workspaceDir: "/repo/.voratiq",
        runsDir: "/repo/.voratiq/run",
        runsFile: "/repo/.voratiq/run/index.json",
        reductionsDir: "/repo/.voratiq/reduce",
        reductionsFile: "/repo/.voratiq/reduce/index.json",
        messagesDir: "/repo/.voratiq/message",
        messagesFile: "/repo/.voratiq/message/index.json",
        interactiveDir: "/repo/.voratiq/interactive",
        interactiveFile: "/repo/.voratiq/interactive/index.json",
        specsDir: "/repo/.voratiq/spec",
        specsFile: "/repo/.voratiq/spec/index.json",
        verificationsDir: "/repo/.voratiq/verify",
        verificationsFile: "/repo/.voratiq/verify/index.json",
      },
    });
    isInteractiveShellMock.mockReturnValue(false);
    createConfirmationWorkflowMock.mockReturnValue({
      interactive: false,
      confirm: () => Promise.resolve(true),
      prompt: () => Promise.resolve(""),
      close,
    });
    resolveDoctorFixModeMock.mockResolvedValue("bootstrap-workspace");
    executeDoctorFixMock.mockResolvedValue({
      mode: "bootstrap-workspace",
    });

    await runDoctorCommand({ fix: true });

    expect(createConfirmationWorkflowMock).toHaveBeenCalledWith({
      assumeYes: true,
      onUnavailable: expect.any(Function),
    });
    expect(executeDoctorFixMock).toHaveBeenCalledWith({
      root: "/repo",
      mode: "bootstrap-workspace",
      bootstrapOptions: {
        preset: "pro",
        interactive: false,
        assumeYes: true,
        confirm: expect.any(Function),
        prompt: expect.any(Function),
      },
    });
    expect(close).toHaveBeenCalled();
  });

  it("parses --fix for the doctor command", async () => {
    let received: { fix?: boolean } | undefined;
    const command = silenceCommander(createDoctorCommand());
    command.exitOverride().action((options: { fix?: boolean }) => {
      received = options;
    });

    const program = silenceCommander(new Command());
    program.exitOverride().addCommand(command);

    await program.parseAsync(["node", "voratiq", "doctor", "--fix"]);

    expect(received?.fix).toBe(true);
  });
});
