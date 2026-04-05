import { describe, expect, test } from "@jest/globals";

import { loadRepoSettings } from "../../../src/configs/settings/loader.js";

describe("loadRepoSettings", () => {
  test("defaults to ignore when settings.yaml is missing", () => {
    const error = new Error("missing") as NodeJS.ErrnoException;
    error.code = "ENOENT";

    const settings = loadRepoSettings({
      root: "/repo",
      readFile: () => {
        throw error;
      },
    });

    expect(settings.bounded.codex.globalConfigPolicy).toBe("ignore");
    expect(settings.mcp).toEqual({
      codex: "ask",
      claude: "ask",
      gemini: "ask",
    });
  });

  test("parses ignore policy", () => {
    const settings = loadRepoSettings({
      root: "/repo",
      readFile: () => "bounded:\n  codex:\n    globalConfigPolicy: ignore\n",
    });

    expect(settings.bounded.codex.globalConfigPolicy).toBe("ignore");
  });

  test("parses apply policy", () => {
    const settings = loadRepoSettings({
      root: "/repo",
      readFile: () => "bounded:\n  codex:\n    globalConfigPolicy: apply\n",
    });

    expect(settings.bounded.codex.globalConfigPolicy).toBe("apply");
  });

  test("parses mcp preferences", () => {
    const settings = loadRepoSettings({
      root: "/repo",
      readFile: () =>
        ["mcp:", "  codex: never", "  claude: ask", "  gemini: never", ""].join(
          "\n",
        ),
    });

    expect(settings.mcp).toEqual({
      codex: "never",
      claude: "ask",
      gemini: "never",
    });
  });

  test("keeps codex bounded policy default when only mcp preferences are set", () => {
    const settings = loadRepoSettings({
      root: "/repo",
      readFile: () =>
        ["mcp:", "  codex: ask", "  claude: ask", "  gemini: never", ""].join(
          "\n",
        ),
    });

    expect(settings.bounded.codex.globalConfigPolicy).toBe("ignore");
    expect(settings.mcp.gemini).toBe("never");
  });

  test("throws when policy value is invalid", () => {
    expect(() =>
      loadRepoSettings({
        root: "/repo",
        readFile: () => "bounded:\n  codex:\n    globalConfigPolicy: nope\n",
      }),
    ).toThrow("Invalid settings file");
  });
});
