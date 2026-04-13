import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, jest } from "@jest/globals";

import { verifyAgentProviders } from "../../../src/agents/runtime/auth.js";
import { executeDoctorDiagnosis } from "../../../src/commands/doctor/command.js";
import { createWorkspace } from "../../../src/workspace/setup.js";
import { resolveWorkspacePath } from "../../../src/workspace/structure.js";

jest.mock("../../../src/agents/runtime/auth.js", () => ({
  verifyAgentProviders: jest.fn(),
}));

const verifyAgentProvidersMock = jest.mocked(verifyAgentProviders);

describe("executeDoctorDiagnosis", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "voratiq-doctor-diagnosis-"));
    await mkdir(join(repoRoot, ".git"), { recursive: true });
    verifyAgentProvidersMock.mockReset();
    verifyAgentProvidersMock.mockResolvedValue([]);
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("reports a missing workspace without creating files", async () => {
    const result = await executeDoctorDiagnosis({ root: repoRoot });

    expect(result.healthy).toBe(false);
    expect(result.issueLines).toEqual([
      "- Missing workspace entry: `.voratiq/`.",
    ]);
    await expect(access(resolveWorkspacePath(repoRoot))).rejects.toThrow();
  });

  it("checks only enabled agents and their referenced providers", async () => {
    await createWorkspace(repoRoot);
    await writeFile(
      resolveWorkspacePath(repoRoot, "agents.yaml"),
      [
        "agents:",
        "  - id: enabled-codex",
        "    provider: codex",
        "    model: gpt-5.4",
        `    binary: ${process.execPath}`,
        "  - id: disabled-broken",
        "    provider: unknown-provider",
        "    model: unknown-model",
        "    enabled: false",
        "    binary: /missing/provider",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await executeDoctorDiagnosis({ root: repoRoot });

    expect(result).toEqual({
      healthy: true,
      issueLines: [],
    });
    expect(verifyAgentProvidersMock).toHaveBeenCalledWith([
      {
        id: "enabled-codex",
        provider: "codex",
      },
    ]);
  });

  it("reports malformed environment config as invalid instead of missing", async () => {
    await createWorkspace(repoRoot);
    await writeFile(
      resolveWorkspacePath(repoRoot, "agents.yaml"),
      [
        "agents:",
        "  - id: enabled-codex",
        "    provider: codex",
        "    model: gpt-5.4",
        `    binary: ${process.execPath}`,
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      resolveWorkspacePath(repoRoot, "environment.yaml"),
      "node: [\n",
      "utf8",
    );

    const result = await executeDoctorDiagnosis({ root: repoRoot });

    expect(result.healthy).toBe(false);
    expect(result.issueLines).toContainEqual(
      expect.stringContaining("Invalid `environment.yaml`"),
    );
    expect(result.issueLines).not.toContainEqual(
      expect.stringContaining("Missing workspace entry"),
    );
  });
});
