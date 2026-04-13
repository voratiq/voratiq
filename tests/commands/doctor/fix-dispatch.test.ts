import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
  executeDoctorFix,
  resolveDoctorFixMode,
} from "../../../src/commands/doctor/command.js";
import { executeDoctorBootstrap } from "../../../src/commands/doctor/fix.js";
import { executeDoctorReconcile } from "../../../src/commands/doctor/reconcile.js";
import { repairWorkspaceStructure } from "../../../src/workspace/setup.js";

jest.mock("../../../src/commands/doctor/fix.js", () => ({
  executeDoctorBootstrap: jest.fn(),
}));

jest.mock("../../../src/commands/doctor/reconcile.js", () => ({
  executeDoctorReconcile: jest.fn(),
}));

jest.mock("../../../src/workspace/setup.js", () => ({
  repairWorkspaceStructure: jest.fn(),
  validateWorkspace: jest.fn(),
}));

const executeDoctorBootstrapMock = jest.mocked(executeDoctorBootstrap);
const executeDoctorReconcileMock = jest.mocked(executeDoctorReconcile);
const repairWorkspaceStructureMock = jest.mocked(repairWorkspaceStructure);

describe("doctor fix dispatch", () => {
  beforeEach(() => {
    executeDoctorBootstrapMock.mockReset();
    executeDoctorReconcileMock.mockReset();
    repairWorkspaceStructureMock.mockReset();
    executeDoctorBootstrapMock.mockResolvedValue({
      mode: "bootstrap",
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
        managed: true,
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
    repairWorkspaceStructureMock.mockResolvedValue({
      repaired: false,
      createdDirectories: [],
      createdFiles: [],
    });
    executeDoctorReconcileMock.mockResolvedValue({
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
        skippedCustomized: false,
        managed: true,
        preset: "pro",
      },
    });
  });

  it("delegates missing-workspace fix to bootstrap behavior", async () => {
    const result = await executeDoctorFix({
      root: "/repo",
      mode: "bootstrap-workspace",
    });

    expect(result).toEqual({ mode: "bootstrap-workspace" });
    expect(executeDoctorBootstrapMock).toHaveBeenCalledWith({
      root: "/repo",
      preset: "pro",
      interactive: false,
    });
    expect(repairWorkspaceStructureMock).not.toHaveBeenCalled();
    expect(executeDoctorReconcileMock).not.toHaveBeenCalled();
  });

  it("forwards bootstrap interaction options when provided", async () => {
    const confirm = () => Promise.resolve(true);
    const prompt = () => Promise.resolve("1");

    await executeDoctorFix({
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

    expect(executeDoctorBootstrapMock).toHaveBeenCalledWith({
      root: "/repo",
      preset: "pro",
      interactive: true,
      assumeYes: false,
      confirm,
      prompt,
    });
  });

  it("runs additive structural repair before reconcile for existing workspaces", async () => {
    const result = await executeDoctorFix({
      root: "/repo",
      mode: "repair-and-reconcile",
    });

    expect(result.mode).toBe("repair-and-reconcile");
    expect(repairWorkspaceStructureMock).toHaveBeenCalledWith("/repo");
    expect(executeDoctorReconcileMock).toHaveBeenCalledWith({ root: "/repo" });
    expect(
      repairWorkspaceStructureMock.mock.invocationCallOrder[0],
    ).toBeLessThan(executeDoctorReconcileMock.mock.invocationCallOrder[0] ?? 0);
    expect(executeDoctorBootstrapMock).not.toHaveBeenCalled();
  });

  it("resolves fix mode from workspace presence", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-doctor-fix-mode-"));
    try {
      await mkdir(join(root, ".git"), { recursive: true });
      await expect(resolveDoctorFixMode(root)).resolves.toBe(
        "bootstrap-workspace",
      );

      await mkdir(join(root, ".voratiq"), { recursive: true });
      await expect(resolveDoctorFixMode(root)).resolves.toBe(
        "repair-and-reconcile",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
