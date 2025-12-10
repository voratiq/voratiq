import { claudeAuthProvider } from "../../../src/auth/providers/claude.js";
import { codexAuthProvider } from "../../../src/auth/providers/codex.js";
import { geminiAuthProvider } from "../../../src/auth/providers/gemini.js";
import { resolveAuthProvider } from "../../../src/auth/providers/index.js";

describe("auth provider registry", () => {
  it("registers built-in providers on module load", () => {
    expect(resolveAuthProvider("claude")).toBe(claudeAuthProvider);
    expect(resolveAuthProvider("codex")).toBe(codexAuthProvider);
    expect(resolveAuthProvider("gemini")).toBe(geminiAuthProvider);
  });
});
