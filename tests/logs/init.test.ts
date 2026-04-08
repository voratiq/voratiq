import type { InitCommandResult } from "../../src/commands/init/types.js";
import { renderInitTranscript } from "../../src/render/transcripts/init.js";
import { colorize } from "../../src/utils/colors.js";

describe("renderInitTranscript", () => {
  const noSupportedCliNote =
    "No agent CLIs detected on PATH. Install providers, then run `voratiq sync`.";
  const manualPresetNote =
    "Manual preset leaves stages empty. Add agents to `orchestration.yaml`.";
  const partialPresetNote =
    "Some providers not found on PATH. Only detected providers were configured. Install missing ones, then run `voratiq sync`.";

  const baseResult: InitCommandResult = {
    mode: "bootstrap",
    syncRecommended: false,
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
      managed: true,
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
    sandboxSummary: {
      configPath: ".voratiq/sandbox.yaml",
      configCreated: false,
    },
  };

  it("renders the workspace configuration summary with learn-more and auto hint", () => {
    const output = renderInitTranscript(baseResult);
    const lines = output.split("\n");

    expect(lines[0]).toBe("Configuring workspace…");
    expect(output).toContain("CONFIGURATION  FILE");
    expect(output).toContain("agents         .voratiq/agents.yaml");
    expect(output).toContain("orchestration  .voratiq/orchestration.yaml");
    expect(output).toContain("verification   .voratiq/verification.yaml");
    expect(output).toContain("environment    .voratiq/environment.yaml");
    expect(output).toContain("sandbox        .voratiq/sandbox.yaml");
    expect(
      findLineIndex(lines, "agents         .voratiq/agents.yaml"),
    ).toBeLessThan(
      findLineIndex(lines, "orchestration  .voratiq/orchestration.yaml"),
    );
    expect(
      findLineIndex(lines, "orchestration  .voratiq/orchestration.yaml"),
    ).toBeLessThan(
      findLineIndex(lines, "verification   .voratiq/verification.yaml"),
    );
    expect(
      findLineIndex(lines, "verification   .voratiq/verification.yaml"),
    ).toBeLessThan(
      findLineIndex(lines, "environment    .voratiq/environment.yaml"),
    );
    expect(
      findLineIndex(lines, "environment    .voratiq/environment.yaml"),
    ).toBeLessThan(
      findLineIndex(lines, "sandbox        .voratiq/sandbox.yaml"),
    );
    expect(output).toContain("Configuration docs:");
    expect(output).toContain(
      "https://github.com/voratiq/voratiq/tree/main/docs/configs",
    );
    expect(output).toContain(colorize("Voratiq initialized.", "green"));
    expect(output).toContain("Run end-to-end:");
    expect(output).toContain('voratiq auto --description "<task>"');
    expect(output).not.toContain("To generate a spec:");
    expect(output).not.toContain("voratiq spec --description");
    expect(output).not.toContain("Detecting agent CLIs…");
    expect(output).not.toContain("PROVIDER  BINARY");
    expect(output).not.toContain("Enable detected providers? [Y/n]:");
    expect(normalizedIncludes(output, noSupportedCliNote)).toBe(false);
    expect(normalizedIncludes(output, manualPresetNote)).toBe(false);
    expect(normalizedIncludes(output, partialPresetNote)).toBe(false);
  });

  it("renders repair guidance that points users to sync", () => {
    const output = renderInitTranscript({
      ...baseResult,
      mode: "repair",
      syncRecommended: true,
    });

    expect(output).toContain("Configuring workspace…");
    expect(output).toContain(colorize("Voratiq initialized.", "green"));
    expect(output).toContain(
      "Workspace already exists. `voratiq init` repaired missing structure only.",
    );
    expect(output).toContain("voratiq sync");
    expect(output).toContain('voratiq auto --description "<task>"');
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
