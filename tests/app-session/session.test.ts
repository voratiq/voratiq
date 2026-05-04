import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeAppSessionState } from "../../src/app-session/session.js";
import { buildAppSessionPayload } from "../support/factories/app-session.js";

describe("writeAppSessionState", () => {
  it("writes a session payload", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "voratiq-app-session-"));
    const env = { ...process.env, HOME: home };
    const sessionPath = path.join(home, ".voratiq", "app-session.json");
    const payload = buildAppSessionPayload({
      accessToken: "access-token-new",
      refreshToken: "refresh-token-new",
    });

    try {
      await writeAppSessionState(payload, env);

      const stored = await readFile(sessionPath, "utf8");
      expect(JSON.parse(stored)).toEqual(payload);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("preserves the previous valid file when atomic rename fails", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "voratiq-app-session-"));
    const env = { ...process.env, HOME: home };
    const stateDir = path.join(home, ".voratiq");
    const sessionPath = path.join(stateDir, "app-session.json");
    const previousPayload = buildAppSessionPayload();
    const previousContent = `${JSON.stringify(previousPayload, null, 2)}\n`;

    await mkdir(stateDir, { recursive: true });
    await writeFile(sessionPath, previousContent, "utf8");

    const renameMock: typeof import("node:fs/promises").rename = () =>
      Promise.reject(new Error("rename failed"));

    try {
      await expect(
        writeAppSessionState(
          buildAppSessionPayload({
            accessToken: "access-token-new",
            refreshToken: "refresh-token-new",
          }),
          env,
          {
            rename: renameMock,
          },
        ),
      ).rejects.toThrow("rename failed");

      const currentContent = await readFile(sessionPath, "utf8");
      expect(currentContent).toBe(previousContent);
      expect(() => {
        JSON.parse(currentContent);
      }).not.toThrow();

      const entries = await readdir(stateDir);
      expect(entries).toEqual(["app-session.json"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("preserves the previous valid file when temp write fails", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "voratiq-app-session-"));
    const env = { ...process.env, HOME: home };
    const stateDir = path.join(home, ".voratiq");
    const sessionPath = path.join(stateDir, "app-session.json");
    const previousPayload = buildAppSessionPayload();
    const previousContent = `${JSON.stringify(previousPayload, null, 2)}\n`;

    await mkdir(stateDir, { recursive: true });
    await writeFile(sessionPath, previousContent, "utf8");
    await chmod(sessionPath, 0o600);

    const writeFileMock: typeof import("node:fs/promises").writeFile = () =>
      Promise.reject(new Error("write failed"));

    try {
      await expect(
        writeAppSessionState(
          buildAppSessionPayload({
            accessToken: "access-token-new",
            refreshToken: "refresh-token-new",
          }),
          env,
          {
            writeFile: writeFileMock,
          },
        ),
      ).rejects.toThrow("write failed");

      const currentContent = await readFile(sessionPath, "utf8");
      expect(currentContent).toBe(previousContent);
      expect(() => {
        JSON.parse(currentContent);
      }).not.toThrow();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
