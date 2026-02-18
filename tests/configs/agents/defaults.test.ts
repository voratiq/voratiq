import {
  assertAgentCatalogGuardrails,
  sanitizeAgentIdFromModel,
} from "../../../src/configs/agents/defaults.js";

describe("sanitizeAgentIdFromModel", () => {
  it("lowercases and swaps punctuation for hyphens", () => {
    expect(sanitizeAgentIdFromModel("GPT-5.1_Codex")).toBe("gpt-5-1-codex");
  });

  it("collapses repeated punctuation into single hyphens", () => {
    expect(sanitizeAgentIdFromModel("Gemini__2..5---PRO")).toBe(
      "gemini-2-5-pro",
    );
  });

  it("trims dangling hyphens", () => {
    expect(sanitizeAgentIdFromModel("__Claude--Sonnet__")).toBe(
      "claude-sonnet",
    );
  });

  it("throws when no alphanumeric characters remain", () => {
    expect(() => sanitizeAgentIdFromModel("--__..__--")).toThrow(
      /Unable to derive agent id/u,
    );
  });
});

describe("assertAgentCatalogGuardrails", () => {
  it("throws when supported catalog resolves duplicate ids", () => {
    expect(() =>
      assertAgentCatalogGuardrails({
        supportedCatalog: [
          { provider: "codex", model: "gpt-5.2", id: "dup" },
          { provider: "codex", model: "gpt-5.3-codex", id: "dup" },
        ],
        presetCatalogs: [],
      }),
    ).toThrow(/duplicate agent id "dup"/u);
  });

  it("throws when preset includes entry not present in supported catalog", () => {
    expect(() =>
      assertAgentCatalogGuardrails({
        supportedCatalog: [{ provider: "claude", model: "claude-opus-4-6" }],
        presetCatalogs: [
          {
            presetName: "pro",
            catalog: [{ provider: "gemini", model: "gemini-2.5-pro" }],
          },
        ],
      }),
    ).toThrow(/is not present in SUPPORTED_AGENT_CATALOG/u);
  });
});
