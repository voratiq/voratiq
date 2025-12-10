import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";

import { geminiAuthProvider } from "../../../src/auth/providers/gemini.js";
import { SANDBOX_DIRNAME } from "../../../src/workspace/structure.js";

describe("geminiAuthProvider.stage", () => {
  it("stages sandbox home and env variables for Gemini", async () => {
    const agentRoot = await mkdtemp(
      join(os.tmpdir(), "voratiq-gemini-stage-agent-"),
    );
    const hostHome = await mkdtemp(
      join(os.tmpdir(), "voratiq-gemini-host-home-"),
    );
    const geminiHome = join(hostHome, ".gemini");
    await mkdir(geminiHome, { recursive: true });
    await writeFile(
      join(geminiHome, "oauth_creds.json"),
      JSON.stringify({ client_id: "test" }),
      "utf8",
    );
    await writeFile(
      join(geminiHome, "google_accounts.json"),
      JSON.stringify({ accounts: [] }),
      "utf8",
    );
    await writeFile(
      join(geminiHome, "settings.json"),
      JSON.stringify({ security: { auth: { selectedType: "oauth" } } }),
      "utf8",
    );
    await writeFile(
      join(geminiHome, "state.json"),
      JSON.stringify({ session: "abc" }),
      "utf8",
    );
    await writeFile(
      join(geminiHome, "installation_id"),
      "installation-id",
      "utf8",
    );
    await writeFile(join(geminiHome, "GEMINI.md"), "docs", "utf8");
    const tmpDir = join(geminiHome, "tmp");
    await mkdir(tmpDir, { recursive: true });
    await writeFile(join(tmpDir, "history.json"), "{}", "utf8");

    let stageResult:
      | Awaited<ReturnType<typeof geminiAuthProvider.stage>>
      | undefined;
    try {
      stageResult = await geminiAuthProvider.stage({
        agentId: "gemini",
        agentRoot,
        runtime: {
          platform: process.platform,
          env: { ...process.env },
          homeDir: hostHome,
          username: "voratiq-test",
        },
      });

      const sandboxHome = join(agentRoot, SANDBOX_DIRNAME);
      const sandboxGemini = join(sandboxHome, ".gemini");
      expect(stageResult.sandboxPath).toBe(sandboxHome);
      expect(stageResult.env).toEqual({ HOME: sandboxHome });

      await expect(access(sandboxGemini)).resolves.toBeUndefined();
      const oauthPath = join(sandboxGemini, "oauth_creds.json");
      const googlePath = join(sandboxGemini, "google_accounts.json");
      const settingsPath = join(sandboxGemini, "settings.json");
      const statePath = join(sandboxGemini, "state.json");
      await expect(access(oauthPath)).resolves.toBeUndefined();
      await expect(access(googlePath)).resolves.toBeUndefined();
      await expect(access(settingsPath)).resolves.toBeUndefined();
      await expect(access(statePath)).resolves.toBeUndefined();
      const optionalFiles = ["installation_id", "GEMINI.md"] as const;
      await expect(
        access(join(sandboxGemini, "installation_id")),
      ).resolves.toBeUndefined();
      await expect(
        access(join(sandboxGemini, "GEMINI.md")),
      ).resolves.toBeUndefined();
      await expect(
        access(join(sandboxGemini, "tmp", "history.json")),
      ).resolves.toBeUndefined();

      const firstRead = await readFile(oauthPath, "utf8");
      const secondRead = await readFile(oauthPath, "utf8");
      expect(secondRead).toBe(firstRead);

      const requiredFiles = [
        "oauth_creds.json",
        "google_accounts.json",
        "settings.json",
        "state.json",
      ];
      for (const filename of requiredFiles) {
        const stagedPath = join(sandboxGemini, filename);
        const fifoStats = await lstat(stagedPath);
        expect(fifoStats.isFile()).toBe(true);
        expect(fifoStats.mode & 0o777).toBe(0o600);
      }
      for (const filename of optionalFiles) {
        const fileStats = await stat(join(sandboxGemini, filename));
        expect(fileStats.isFile()).toBe(true);
        expect(fileStats.mode & 0o777).toBe(0o600);
      }

      const workspaceGemini = join(agentRoot, "workspace", ".gemini");
      await expect(access(workspaceGemini)).rejects.toThrow();
    } finally {
      if (stageResult && typeof geminiAuthProvider.teardown === "function") {
        await geminiAuthProvider.teardown({
          sandboxPath: stageResult.sandboxPath,
        });
      }
      await rm(agentRoot, { recursive: true, force: true });
      await rm(hostHome, { recursive: true, force: true });
    }
  });
});

describe("geminiAuthProvider optional files", () => {
  it("skips missing optional files without failing", async () => {
    const agentRoot = await mkdtemp(
      join(os.tmpdir(), "voratiq-gemini-stage-optional-"),
    );
    const hostHome = await mkdtemp(
      join(os.tmpdir(), "voratiq-gemini-host-optional-"),
    );
    const geminiHome = join(hostHome, ".gemini");
    await mkdir(geminiHome, { recursive: true });
    await writeFile(
      join(geminiHome, "oauth_creds.json"),
      JSON.stringify({ client_id: "test" }),
      "utf8",
    );
    await writeFile(
      join(geminiHome, "google_accounts.json"),
      JSON.stringify({ accounts: [] }),
      "utf8",
    );
    await writeFile(
      join(geminiHome, "settings.json"),
      JSON.stringify({ security: { auth: { selectedType: "oauth" } } }),
      "utf8",
    );
    await writeFile(
      join(geminiHome, "state.json"),
      JSON.stringify({ session: "abc" }),
      "utf8",
    );

    let stageResult:
      | Awaited<ReturnType<typeof geminiAuthProvider.stage>>
      | undefined;
    try {
      stageResult = await geminiAuthProvider.stage({
        agentId: "gemini",
        agentRoot,
        runtime: {
          platform: process.platform,
          env: { ...process.env },
          homeDir: hostHome,
          username: "voratiq-test",
        },
      });

      expect(stageResult.env).toEqual({ HOME: stageResult.sandboxPath });
      const sandboxGemini = join(stageResult.sandboxPath, ".gemini");
      await expect(
        access(join(sandboxGemini, "installation_id")),
      ).rejects.toThrow();
      await expect(access(join(sandboxGemini, "GEMINI.md"))).rejects.toThrow();
      await expect(access(join(sandboxGemini, "tmp"))).rejects.toThrow();

      const stagedSecret = await readFile(
        join(sandboxGemini, "oauth_creds.json"),
        "utf8",
      );
      expect(stagedSecret).toContain("client_id");

      await expect(
        access(join(agentRoot, "workspace", ".gemini")),
      ).rejects.toThrow();
    } finally {
      if (stageResult && typeof geminiAuthProvider.teardown === "function") {
        await geminiAuthProvider.teardown({
          sandboxPath: stageResult.sandboxPath,
        });
      }
      await rm(agentRoot, { recursive: true, force: true });
      await rm(hostHome, { recursive: true, force: true });
    }
  });
});

describe("geminiAuthProvider settings guard", () => {
  it("fails with login hint when settings.json is invalid", async () => {
    const agentRoot = await mkdtemp(
      join(os.tmpdir(), "voratiq-gemini-stage-invalid-settings-"),
    );
    const hostHome = await mkdtemp(
      join(os.tmpdir(), "voratiq-gemini-host-invalid-settings-"),
    );
    const geminiHome = join(hostHome, ".gemini");
    await mkdir(geminiHome, { recursive: true });
    await writeFile(join(geminiHome, "oauth_creds.json"), "{}", "utf8");
    await writeFile(join(geminiHome, "google_accounts.json"), "{}", "utf8");
    await writeFile(join(geminiHome, "settings.json"), "not json", "utf8");
    await writeFile(join(geminiHome, "state.json"), "{}", "utf8");

    await expect(
      geminiAuthProvider.stage({
        agentId: "gemini",
        agentRoot,
        runtime: {
          platform: process.platform,
          env: { ...process.env },
          homeDir: hostHome,
          username: "voratiq-test",
        },
      }),
    ).rejects.toThrow(
      "Gemini authentication failed. Authenticate directly via Gemini before continuing.",
    );

    await rm(agentRoot, { recursive: true, force: true });
    await rm(hostHome, { recursive: true, force: true });
  });

  it("fails when selectedType is missing", async () => {
    const agentRoot = await mkdtemp(
      join(os.tmpdir(), "voratiq-gemini-stage-missing-selected-type-"),
    );
    const hostHome = await mkdtemp(
      join(os.tmpdir(), "voratiq-gemini-host-missing-selected-type-"),
    );
    const geminiHome = join(hostHome, ".gemini");
    await mkdir(geminiHome, { recursive: true });
    await writeFile(join(geminiHome, "oauth_creds.json"), "{}", "utf8");
    await writeFile(join(geminiHome, "google_accounts.json"), "{}", "utf8");
    await writeFile(join(geminiHome, "settings.json"), "{}", "utf8");
    await writeFile(join(geminiHome, "state.json"), "{}", "utf8");

    await expect(
      geminiAuthProvider.verify({
        agentId: "gemini",
        runtime: {
          platform: process.platform,
          env: { ...process.env },
          homeDir: hostHome,
          username: "voratiq-test",
        },
      }),
    ).rejects.toThrow(
      "Gemini authentication failed. Authenticate directly via Gemini before continuing.",
    );

    await rm(agentRoot, { recursive: true, force: true });
    await rm(hostHome, { recursive: true, force: true });
  });
});

describe("geminiAuthProvider API key mode", () => {
  it("verifies with GEMINI_API_KEY without .gemini files", async () => {
    const agentRoot = await mkdtemp(
      join(os.tmpdir(), "voratiq-gemini-apikey-agent-"),
    );
    const hostHome = await mkdtemp(
      join(os.tmpdir(), "voratiq-gemini-apikey-home-"),
    );

    const previousKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-api-key";

    let stageResult:
      | Awaited<ReturnType<typeof geminiAuthProvider.stage>>
      | undefined;
    try {
      stageResult = await geminiAuthProvider.stage({
        agentId: "gemini",
        agentRoot,
        runtime: {
          platform: process.platform,
          env: { ...process.env },
          homeDir: hostHome,
          username: "voratiq-test",
        },
      });

      expect(stageResult.env.GEMINI_API_KEY).toBe("test-api-key");
      expect(stageResult.env.GOOGLE_API_KEY).toBe("test-api-key");
      expect(stageResult.env.HOME).toBeDefined();
    } finally {
      if (previousKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousKey;
      }
      if (stageResult && typeof geminiAuthProvider.teardown === "function") {
        await geminiAuthProvider.teardown({
          sandboxPath: stageResult.sandboxPath,
        });
      }
      await rm(agentRoot, { recursive: true, force: true });
      await rm(hostHome, { recursive: true, force: true });
    }
  });
});
