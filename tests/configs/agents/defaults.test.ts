import { sanitizeAgentIdFromModel } from "../../../src/configs/agents/defaults.js";

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
