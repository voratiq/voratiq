import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { resolveStageCompetitors } from "../../../src/commands/shared/resolve-stage-competitors.js";
import { HintedError } from "../../../src/utils/errors.js";

describe("resolveStageCompetitors", () => {
  it("reports duplicate CLI ids using the provided override flag name", () => {
    expect(() =>
      resolveStageCompetitors({
        root: "/unused",
        stageId: "run",
        cliAgentIds: ["alpha", "alpha"],
        cliOverrideFlag: "--run-agent",
      }),
    ).toThrow('Duplicate --run-agent values are not allowed for stage "run".');
  });

  it("reports single-agent guardrails using the provided override flag name", () => {
    let caught: unknown;
    try {
      resolveStageCompetitors({
        root: "/unused",
        stageId: "review",
        cliAgentIds: ["alpha", "beta"],
        cliOverrideFlag: "--review-agent",
        enforceSingleCompetitor: true,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HintedError);
    const hinted = caught as HintedError;
    expect(hinted.headline).toBe(
      'Multiple agents resolved for stage "review".',
    );
    expect(hinted.hintLines).toContain(
      "Provide --review-agent <id> to run review with an explicit agent.",
    );
  });

  it("reports missing stage resolution using the provided override flag name", async () => {
    const root = await mkdtemp(join(tmpdir(), "voratiq-stage-resolution-"));
    try {
      await mkdir(join(root, ".voratiq"), { recursive: true });
      await writeFile(
        join(root, ".voratiq", "orchestration.yaml"),
        [
          "profiles:",
          "  default:",
          "    spec:",
          "      agents: []",
          "    run:",
          "      agents: []",
          "    review:",
          "      agents: []",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        join(root, ".voratiq", "agents.yaml"),
        [
          "agents:",
          "  - id: alpha",
          '    provider: "codex"',
          '    model: "gpt-5"',
          "    enabled: true",
          '    binary: "/bin/echo"',
          "",
        ].join("\n"),
        "utf8",
      );

      let caught: unknown;
      try {
        resolveStageCompetitors({
          root,
          stageId: "run",
          cliOverrideFlag: "--run-agent",
          includeDefinitions: false,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(HintedError);
      const hinted = caught as HintedError;
      expect(hinted.headline).toBe('No agent resolved for stage "run".');
      expect(hinted.hintLines).toContain(
        "Provide --run-agent <id> to run run with an explicit agent.",
      );
      expect(
        hinted.hintLines.some((line) =>
          line.includes("profiles.default.run.agents"),
        ),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
