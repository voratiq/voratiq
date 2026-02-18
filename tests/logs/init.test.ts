import type { InitCommandResult } from "../../src/commands/init/types.js";
import { renderInitTranscript } from "../../src/render/transcripts/init.js";
import { colorize } from "../../src/utils/colors.js";

describe("renderInitTranscript", () => {
  const noSupportedCliNote =
    "No supported agent CLIs were detected, so no run-stage agents were seeded. Verify provider CLI installs/PATH. Then update .voratiq/agents.yaml and .voratiq/orchestration.yaml.";
  const manualPresetNote =
    "Manual preset seeds empty orchestration stages by default. Decide what should run, then update .voratiq/orchestration.yaml.";
  const partialPresetNote =
    "Some preset providers were not detected, so only detected providers were seeded into the default run stage. Verify installs/PATH for missing providers. Then update .voratiq/agents.yaml and .voratiq/orchestration.yaml.";

  const baseResult: InitCommandResult = {
    preset: "pro",
    workspaceResult: {
      createdDirectories: [],
      createdFiles: [],
    },
    agentSummary: {
      configPath: ".voratiq/agents.yaml",
      enabledAgents: ["claude-opus-4-6", "gpt-5.3-codex", "gemini-2.5-pro"],
      agentCount: 3,
      zeroDetections: false,
      detectedProviders: [
        { provider: "claude", binary: "/usr/local/bin/claude" },
        { provider: "codex", binary: "/usr/local/bin/codex" },
        { provider: "gemini", binary: "/usr/local/bin/gemini" },
      ],
      providerEnablementPrompted: true,
      configCreated: false,
      configUpdated: true,
    },
    orchestrationSummary: {
      configPath: ".voratiq/orchestration.yaml",
      configCreated: false,
    },
    environmentSummary: {
      configPath: ".voratiq/environment.yaml",
      detectedEntries: ["node"],
      configCreated: false,
      configUpdated: true,
      config: {
        node: { dependencyRoots: ["node_modules"] },
      },
    },
    evalSummary: {
      configPath: ".voratiq/evals.yaml",
      configuredEvals: ["format", "lint", "typecheck", "tests"],
      configCreated: false,
      configUpdated: true,
    },
    sandboxSummary: {
      configPath: ".voratiq/sandbox.yaml",
      configCreated: false,
    },
  };

  it("renders the workspace configuration summary with learn-more and spec hint", () => {
    const output = renderInitTranscript(baseResult);
    const lines = output.split("\n");

    expect(lines[0]).toBe("Configuring workspace…");
    expect(output).toContain("CONFIGURATION  FILE");
    expect(output).toContain("agents         .voratiq/agents.yaml");
    expect(output).toContain("orchestration  .voratiq/orchestration.yaml");
    expect(output).toContain("environment    .voratiq/environment.yaml");
    expect(output).toContain("evals          .voratiq/evals.yaml");
    expect(output).toContain("sandbox        .voratiq/sandbox.yaml");
    expect(
      findLineIndex(lines, "agents         .voratiq/agents.yaml"),
    ).toBeLessThan(
      findLineIndex(lines, "orchestration  .voratiq/orchestration.yaml"),
    );
    expect(
      findLineIndex(lines, "orchestration  .voratiq/orchestration.yaml"),
    ).toBeLessThan(
      findLineIndex(lines, "environment    .voratiq/environment.yaml"),
    );
    expect(
      findLineIndex(lines, "environment    .voratiq/environment.yaml"),
    ).toBeLessThan(findLineIndex(lines, "evals          .voratiq/evals.yaml"));
    expect(
      findLineIndex(lines, "evals          .voratiq/evals.yaml"),
    ).toBeLessThan(
      findLineIndex(lines, "sandbox        .voratiq/sandbox.yaml"),
    );
    expect(output).toContain("To learn more about configuration:");
    expect(output).toContain(
      "https://github.com/voratiq/voratiq/tree/main/docs/configs",
    );
    expect(output).toContain(colorize("Voratiq initialized.", "green"));
    expect(output).toContain("To generate a spec:");
    expect(output).toContain(
      'voratiq spec --description "<what you want to build>" --agent <agent-id>',
    );
    expect(output).not.toContain("Detecting agent CLIs…");
    expect(output).not.toContain("PROVIDER  BINARY");
    expect(output).not.toContain("Enable detected providers? [Y/n]:");
    expect(normalizedIncludes(output, noSupportedCliNote)).toBe(false);
    expect(normalizedIncludes(output, manualPresetNote)).toBe(false);
    expect(normalizedIncludes(output, partialPresetNote)).toBe(false);
  });

  it("renders no-supported-provider note when no supported CLIs are detected", () => {
    const output = renderInitTranscript({
      ...baseResult,
      preset: "manual",
      agentSummary: {
        ...baseResult.agentSummary,
        zeroDetections: true,
        detectedProviders: [],
      },
    });

    expect(normalizedIncludes(output, noSupportedCliNote)).toBe(true);
    expect(normalizedIncludes(output, manualPresetNote)).toBe(false);
    expect(normalizedIncludes(output, partialPresetNote)).toBe(false);
  });

  it("renders manual note when manual preset has detected CLIs", () => {
    const output = renderInitTranscript({
      ...baseResult,
      preset: "manual",
      agentSummary: {
        ...baseResult.agentSummary,
        enabledAgents: [],
      },
    });

    expect(normalizedIncludes(output, manualPresetNote)).toBe(true);
    expect(normalizedIncludes(output, noSupportedCliNote)).toBe(false);
    expect(normalizedIncludes(output, partialPresetNote)).toBe(false);
  });

  it("renders partial preset note for pro/lite when some preset providers are missing", () => {
    const output = renderInitTranscript({
      ...baseResult,
      preset: "lite",
      agentSummary: {
        ...baseResult.agentSummary,
        detectedProviders: [
          { provider: "claude", binary: "/usr/local/bin/claude" },
          { provider: "codex", binary: "/usr/local/bin/codex" },
        ],
      },
    });

    expect(normalizedIncludes(output, partialPresetNote)).toBe(true);
    expect(normalizedIncludes(output, noSupportedCliNote)).toBe(false);
    expect(normalizedIncludes(output, manualPresetNote)).toBe(false);
  });
});

function normalizedIncludes(haystack: string, needle: string): boolean {
  return normalizeWhitespace(stripAnsi(haystack)).includes(
    normalizeWhitespace(stripAnsi(needle)),
  );
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripAnsi(value: string): string {
  const esc = String.fromCharCode(27);
  const ansiPattern = new RegExp(`${esc}\\[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
}

function findLineIndex(lines: readonly string[], value: string): number {
  const index = lines.findIndex((line) => line.includes(value));
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}
