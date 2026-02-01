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

    expect(settings.codex.globalConfigPolicy).toBe("ignore");
  });

  test("parses ignore policy", () => {
    const settings = loadRepoSettings({
      root: "/repo",
      readFile: () => "codex:\n  globalConfigPolicy: ignore\n",
    });

    expect(settings.codex.globalConfigPolicy).toBe("ignore");
  });

  test("parses apply policy", () => {
    const settings = loadRepoSettings({
      root: "/repo",
      readFile: () => "codex:\n  globalConfigPolicy: apply\n",
    });

    expect(settings.codex.globalConfigPolicy).toBe("apply");
  });

  test("throws when policy value is invalid", () => {
    expect(() =>
      loadRepoSettings({
        root: "/repo",
        readFile: () => "codex:\n  globalConfigPolicy: nope\n",
      }),
    ).toThrow("Invalid settings file");
  });
});
