import { beforeEach, describe, expect, test } from "@jest/globals";

import { SandboxConfigurationError } from "../../../src/configs/sandbox/errors.js";
import { loadSandboxConfiguration } from "../../../src/configs/sandbox/loader.js";
import * as fsUtils from "../../../src/utils/fs.js";
import {
  clearSandboxConfigurationCache,
  loadSandboxNetworkConfig,
} from "../../support/hooks/sandbox-loader.js";

const ROOT = "/repo";
const FILE_PATH = "/repo/.voratiq/sandbox.yaml";

function createMissingFileError(): NodeJS.ErrnoException {
  const error = new Error("not found") as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
}

beforeEach(() => {
  clearSandboxConfigurationCache();
});

describe("sandbox configuration loader", () => {
  test("loads defaults and merges provider overrides", () => {
    const yaml = `
providers:
  codex:
    allowedDomains:
      - api.openai.com
    deniedDomains:
      - blocked.local
    allowLocalBinding: true
`;

    const config = loadSandboxConfiguration({
      root: ROOT,
      filePath: FILE_PATH,
      readFile: () => yaml,
    });

    const codex = config.providers.codex;
    expect(codex.network.allowedDomains).toEqual([
      "api.openai.com",
      "chatgpt.com",
      "auth.openai.com",
    ]);
    expect(codex.network.deniedDomains).toEqual(["blocked.local"]);
    expect(codex.network.allowLocalBinding).toBe(true);

    const claude = config.providers.claude;
    expect(claude.network.allowedDomains).toEqual([
      "api.anthropic.com",
      "console.anthropic.com",
    ]);

    const gemini = config.providers.gemini;
    expect(gemini.network.allowedDomains).toEqual([
      "oauth2.googleapis.com",
      "cloudcode-pa.googleapis.com",
      "play.googleapis.com",
      "generativelanguage.googleapis.com",
    ]);
  });

  test("applies denialBackoff overrides with defaults", () => {
    const yaml = `
providers:
  codex:
    denialBackoff:
      enabled: false
      delayMs: 1234
`;

    const config = loadSandboxConfiguration({
      root: ROOT,
      filePath: FILE_PATH,
      readFile: () => yaml,
    });

    expect(config.providers.codex.denialBackoff).toEqual(
      expect.objectContaining({
        enabled: false,
        warningThreshold: 2,
        delayThreshold: 3,
        delayMs: 1234,
        failFastThreshold: 4,
        windowMs: 120000,
      }),
    );
  });

  test("throws when sandbox.yaml is missing", () => {
    expect(() =>
      loadSandboxConfiguration({
        root: ROOT,
        filePath: FILE_PATH,
        readFile: () => {
          throw createMissingFileError();
        },
      }),
    ).toThrow(SandboxConfigurationError);
  });

  test("throws when sandbox.yaml is empty", () => {
    expect(() =>
      loadSandboxConfiguration({
        root: ROOT,
        filePath: FILE_PATH,
        readFile: () => "   \n",
      }),
    ).toThrow(/is empty/u);
  });

  test("throws when sandbox.yaml has malformed YAML", () => {
    expect(() =>
      loadSandboxConfiguration({
        root: ROOT,
        filePath: FILE_PATH,
        readFile: () => "providers: [unterminated",
      }),
    ).toThrow(SandboxConfigurationError);
  });

  test("throws when sandbox.yaml references unsupported providers", () => {
    const yaml = `
providers:
  mystery:
    allowedDomains:
      - example.com
`;

    expect(() =>
      loadSandboxConfiguration({
        root: ROOT,
        filePath: FILE_PATH,
        readFile: () => yaml,
      }),
    ).toThrow(/Unknown provider/u);
  });

  test("throws when required fields are missing", () => {
    const yaml = `
agents: {}
`;
    expect(() =>
      loadSandboxConfiguration({
        root: ROOT,
        filePath: FILE_PATH,
        readFile: () => yaml,
      }),
    ).toThrow(/Invalid/u);
  });

  test("rejects agent-level overrides", () => {
    const yaml = `
providers:
  claude:
    agents:
      reviewer:
        allowedDomains:
          - reviewer.internal
`;

    expect(() =>
      loadSandboxConfiguration({
        root: ROOT,
        filePath: FILE_PATH,
        readFile: () => yaml,
      }),
    ).toThrow(/Invalid/u);
  });

  test("loadSandboxNetworkConfig returns provider overrides", () => {
    const yaml = `
providers:
  claude:
    allowedDomains:
      - allowed.example.com
`;

    const agentNetwork = loadSandboxNetworkConfig({
      root: ROOT,
      filePath: FILE_PATH,
      readFile: () => yaml,
      providerId: "claude",
    });

    expect(agentNetwork.allowedDomains).toEqual([
      "api.anthropic.com",
      "console.anthropic.com",
      "allowed.example.com",
    ]);
  });
});

describe("sandbox configuration caching", () => {
  test("reuses cached results when reading from disk", () => {
    const yaml = `providers:\n  claude:\n    allowedDomains:\n      - cached.example.com`;
    const spy = jest
      .spyOn(fsUtils, "readUtf8File")
      .mockImplementation(() => yaml);

    const first = loadSandboxConfiguration({
      root: ROOT,
      filePath: FILE_PATH,
    });
    const second = loadSandboxConfiguration({
      root: ROOT,
      filePath: FILE_PATH,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(first.providers.claude.network.allowedDomains).toContain(
      "cached.example.com",
    );
    expect(second.providers.claude.network.allowedDomains).toContain(
      "cached.example.com",
    );

    spy.mockRestore();
  });
});
