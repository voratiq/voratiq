import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, jest } from "@jest/globals";

import { verifyAgentProviders } from "../../../src/agents/runtime/auth.js";
import { executeDoctorFix } from "../../../src/commands/doctor/command.js";
import { executeDoctorDiagnosis } from "../../../src/commands/doctor/command.js";
import { readEnvironmentConfig } from "../../../src/configs/environment/loader.js";
import { createWorkspace } from "../../../src/workspace/setup.js";
import { resolveWorkspacePath } from "../../../src/workspace/structure.js";

jest.mock("../../../src/agents/runtime/auth.js", () => ({
  verifyAgentProviders: jest.fn(),
}));

const verifyAgentProvidersMock = jest.mocked(verifyAgentProviders);

describe("executeDoctorFix integration", () => {
  beforeEach(() => {
    verifyAgentProvidersMock.mockReset();
    verifyAgentProvidersMock.mockResolvedValue([]);
  });

  it("keeps customized orchestration protected during doctor --fix", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "voratiq-doctor-fix-"));
    try {
      await mkdir(join(repoRoot, ".git"), { recursive: true });
      await createWorkspace(repoRoot);

      const orchestrationPath = resolveWorkspacePath(
        repoRoot,
        "orchestration.yaml",
      );
      const customizedOrchestration = [
        "profiles:",
        "  default:",
        "    spec:",
        "      agents: []",
        "    run:",
        "      agents: []",
        "    reduce:",
        "      agents: []",
        "    verify:",
        "      agents: []",
        "    message:",
        "      agents:",
        "        - id: custom-reviewer",
        "",
      ].join("\n");
      await writeFile(orchestrationPath, customizedOrchestration, "utf8");

      const result = await executeDoctorFix({
        root: repoRoot,
        mode: "repair-and-reconcile",
      });
      const current = await readFile(orchestrationPath, "utf8");

      expect(result.mode).toBe("repair-and-reconcile");
      expect(
        result.reconcileResult?.orchestrationSummary.skippedCustomized,
      ).toBe(true);
      expect(current).toBe(customizedOrchestration);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("repairs malformed environment config during doctor --fix", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "voratiq-doctor-fix-env-"));
    try {
      await mkdir(join(repoRoot, ".git"), { recursive: true });
      await createWorkspace(repoRoot);

      const environmentPath = resolveWorkspacePath(
        repoRoot,
        "environment.yaml",
      );
      await writeFile(environmentPath, "node: [\n", "utf8");

      const result = await executeDoctorFix({
        root: repoRoot,
        mode: "repair-and-reconcile",
      });
      const current = await readFile(environmentPath, "utf8");
      const diagnosis = await executeDoctorDiagnosis({ root: repoRoot });

      expect(result.mode).toBe("repair-and-reconcile");
      expect(result.reconcileResult?.environmentSummary.configUpdated).toBe(
        true,
      );
      expect(current).not.toContain("node: [");
      expect(() => readEnvironmentConfig(current)).not.toThrow();
      expect(diagnosis.issueLines).not.toContainEqual(
        expect.stringContaining("Invalid `environment.yaml`"),
      );
      expect(diagnosis.issueLines).not.toContainEqual(
        expect.stringContaining("Missing `environment.yaml`"),
      );
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
