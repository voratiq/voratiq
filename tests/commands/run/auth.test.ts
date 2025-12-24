import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

import { verifyAgentProviders } from "../../../src/agents/runtime/auth.js";
import * as authRuntime from "../../../src/auth/runtime.js";
import type { AgentDefinition } from "../../../src/configs/agents/types.js";

const BASE_AGENT: AgentDefinition = {
  id: "test-agent",
  provider: "claude",
  model: "test-model",
  binary: "/usr/bin/env",
  argv: ["env"],
};

const SRT_BINARY_ENV = "VORATIQ_SRT_BINARY";
let previousSrtOverride: string | undefined;

beforeAll(() => {
  previousSrtOverride = process.env[SRT_BINARY_ENV];
  process.env[SRT_BINARY_ENV] = process.execPath;
});

afterAll(() => {
  if (previousSrtOverride === undefined) {
    delete process.env[SRT_BINARY_ENV];
  } else {
    process.env[SRT_BINARY_ENV] = previousSrtOverride;
  }
});

describe("auth provider verification", () => {
  it("throws when auth provider is missing", async () => {
    const agent = {
      ...BASE_AGENT,
      provider: "",
    } as AgentDefinition;

    await expect(verifyAgentProviders([agent])).rejects.toThrow(
      'Agent "test-agent" missing provider.',
    );
  });

  it("throws when provider id is unknown", async () => {
    const agent: AgentDefinition = {
      ...BASE_AGENT,
      provider: "unknown-provider",
    };

    await expect(verifyAgentProviders([agent])).rejects.toThrow(
      'Unknown auth provider "unknown-provider".',
    );
  });

  it("throws when Claude credentials are missing", async () => {
    if (process.platform === "darwin") {
      return;
    }
    const agent: AgentDefinition = BASE_AGENT;

    const scratchDir = mkdtempSync(join(os.tmpdir(), "voratiq-claude-test-"));
    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = scratchDir;
    try {
      await expect(verifyAgentProviders([agent])).rejects.toThrow(
        "Claude authentication failed. Authenticate directly via Claude before continuing.",
      );
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
      }
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it("verifies Claude provider when API key exists", async () => {
    if (process.platform === "darwin") {
      return;
    }
    const agent: AgentDefinition = BASE_AGENT;

    const scratchHome = mkdtempSync(
      join(os.tmpdir(), "voratiq-claude-apikey-test-"),
    );
    writeFileSync(
      join(scratchHome, ".claude.json"),
      JSON.stringify({ primaryApiKey: "sk-test-api-key" }),
      "utf8",
    );

    const previousHome = process.env.HOME;
    process.env.HOME = scratchHome;
    try {
      await expect(verifyAgentProviders([agent])).resolves.toBeUndefined();
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      rmSync(scratchHome, { recursive: true, force: true });
    }
  });

  it("fails fast when mac login keychain is missing", async () => {
    const agent: AgentDefinition = BASE_AGENT;

    const scratchHome = mkdtempSync(
      join(os.tmpdir(), "voratiq-macos-keychain-test-"),
    );

    const runtimeSpy = jest
      .spyOn(authRuntime, "buildAuthRuntimeContext")
      .mockImplementation(() => ({
        platform: "darwin",
        env: { ...process.env },
        homeDir: scratchHome,
        username: "voratiq-test",
      }));

    try {
      await expect(verifyAgentProviders([agent])).rejects.toThrow(
        "Claude authentication failed. Authenticate directly via Claude before continuing.",
      );
    } finally {
      runtimeSpy.mockRestore();
      rmSync(scratchHome, { recursive: true, force: true });
    }
  });

  it("throws when Codex credentials are missing", async () => {
    const agent: AgentDefinition = {
      ...BASE_AGENT,
      id: "codex-agent",
      provider: "codex",
    };

    const scratchDir = mkdtempSync(join(os.tmpdir(), "voratiq-codex-test-"));
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = scratchDir;
    try {
      await expect(verifyAgentProviders([agent])).rejects.toThrow(
        "Codex authentication failed. Authenticate directly via Codex before continuing.",
      );
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it("verifies Codex provider when auth exists", async () => {
    const agent: AgentDefinition = {
      ...BASE_AGENT,
      id: "codex-agent",
      provider: "codex",
    };

    const scratchDir = mkdtempSync(join(os.tmpdir(), "voratiq-codex-test-"));
    writeFileSync(
      join(scratchDir, "auth.json"),
      JSON.stringify({ access_token: "test-token" }),
      "utf8",
    );

    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = scratchDir;
    try {
      await expect(verifyAgentProviders([agent])).resolves.toBeUndefined();
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it("throws when Gemini credentials are missing", async () => {
    const agent: AgentDefinition = {
      ...BASE_AGENT,
      id: "gemini-agent",
      provider: "gemini",
    };

    const scratchHome = mkdtempSync(join(os.tmpdir(), "voratiq-gemini-test-"));
    const previousHome = process.env.HOME;
    process.env.HOME = scratchHome;
    const runtimeSpy = jest
      .spyOn(authRuntime, "buildAuthRuntimeContext")
      .mockImplementation(() => ({
        platform: process.platform,
        env: { ...process.env },
        homeDir: scratchHome,
        username: "voratiq-test",
      }));
    try {
      await expect(verifyAgentProviders([agent])).rejects.toThrow(
        "Gemini authentication failed. Authenticate directly via Gemini before continuing.",
      );
    } finally {
      runtimeSpy.mockRestore();
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      rmSync(scratchHome, { recursive: true, force: true });
    }
  });

  it("verifies Gemini provider when auth exists", async () => {
    const agent: AgentDefinition = {
      ...BASE_AGENT,
      id: "gemini-agent",
      provider: "gemini",
    };

    const scratchHome = mkdtempSync(join(os.tmpdir(), "voratiq-gemini-test-"));
    const dotGemini = join(scratchHome, ".gemini");
    mkdirSync(dotGemini, { recursive: true });
    writeFileSync(
      join(dotGemini, "oauth_creds.json"),
      '{"token":"test"}\n',
      "utf8",
    );
    writeFileSync(
      join(dotGemini, "google_accounts.json"),
      '{"accounts":[]}\n',
      "utf8",
    );
    writeFileSync(
      join(dotGemini, "settings.json"),
      '{"security":{"auth":{"selectedType":"oauth"}}}\n',
      "utf8",
    );
    writeFileSync(join(dotGemini, "state.json"), '{"session":"abc"}\n', "utf8");

    const previousHome = process.env.HOME;
    process.env.HOME = scratchHome;
    const runtimeSpy = jest
      .spyOn(authRuntime, "buildAuthRuntimeContext")
      .mockImplementation(() => ({
        platform: process.platform,
        env: { ...process.env },
        homeDir: scratchHome,
        username: "voratiq-test",
      }));
    try {
      await expect(verifyAgentProviders([agent])).resolves.toBeUndefined();
    } finally {
      runtimeSpy.mockRestore();
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      rmSync(scratchHome, { recursive: true, force: true });
    }
  });

  it("verifies Gemini provider when API key exists", async () => {
    const agent: AgentDefinition = {
      ...BASE_AGENT,
      id: "gemini-agent",
      provider: "gemini",
    };

    const scratchHome = mkdtempSync(
      join(os.tmpdir(), "voratiq-gemini-apikey-"),
    );
    const previousHome = process.env.HOME;
    const previousKey = process.env.GEMINI_API_KEY;
    process.env.HOME = scratchHome;
    process.env.GEMINI_API_KEY = "test-api-key";
    const runtimeSpy = jest
      .spyOn(authRuntime, "buildAuthRuntimeContext")
      .mockImplementation(() => ({
        platform: process.platform,
        env: { ...process.env },
        homeDir: scratchHome,
        username: "voratiq-test",
      }));
    try {
      await expect(verifyAgentProviders([agent])).resolves.toBeUndefined();
    } finally {
      runtimeSpy.mockRestore();
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousKey;
      }
      rmSync(scratchHome, { recursive: true, force: true });
    }
  });
});
