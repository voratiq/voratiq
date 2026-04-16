import {
  assertAgentCatalogGuardrails,
  getAgentDefaultId,
  getSupportedAgentDefaults,
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
        builtinCatalog: [
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
        builtinCatalog: [{ provider: "claude", model: "claude-opus-4-6" }],
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

describe("getSupportedAgentDefaults", () => {
  it("returns the launcher catalog in the expected curated order", () => {
    expect(
      getSupportedAgentDefaults().map((entry) => getAgentDefaultId(entry)),
    ).toEqual([
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-5-20250929",
      "claude-sonnet-4-6",
      "claude-opus-4-5-20251101",
      "claude-opus-4-6",
      "claude-opus-4-7-high",
      "claude-opus-4-7-xhigh",
      "gpt-5-2",
      "gpt-5-2-high",
      "gpt-5-2-xhigh",
      "gpt-5-3-codex-spark",
      "gpt-5-3-codex",
      "gpt-5-3-codex-high",
      "gpt-5-3-codex-xhigh",
      "gpt-5-4-mini",
      "gpt-5-4",
      "gpt-5-4-high",
      "gpt-5-4-xhigh",
      "gemini-2-5-flash",
      "gemini-2-5-flash-lite",
      "gemini-3-flash-preview",
      "gemini-2-5-pro",
      "gemini-3-1-pro-preview",
    ]);
  });
});
