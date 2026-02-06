import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { resolveUpdateStatePath } from "../../../src/update-check/state-path.js";

describe("resolveUpdateStatePath", () => {
  it("uses XDG_STATE_HOME when set", () => {
    const env = { XDG_STATE_HOME: "/custom/state" };
    expect(resolveUpdateStatePath(env)).toBe(
      "/custom/state/voratiq/update-state.json",
    );
  });

  it("falls back to ~/.local/state when XDG_STATE_HOME is not set", () => {
    const env = {};
    expect(resolveUpdateStatePath(env)).toBe(
      join(homedir(), ".local", "state", "voratiq", "update-state.json"),
    );
  });

  it("falls back to ~/.local/state when XDG_STATE_HOME is empty string", () => {
    const env = { XDG_STATE_HOME: "" };
    expect(resolveUpdateStatePath(env)).toBe(
      join(homedir(), ".local", "state", "voratiq", "update-state.json"),
    );
  });
});
