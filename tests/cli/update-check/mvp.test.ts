import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { fs, vol } from "memfs";

import {
  readCache,
  startUpdateCheck,
  writeCache,
} from "../../../src/update-check/mvp.js";

jest.mock("node:fs", () => fs);

describe("readCache / writeCache", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vol.reset();
  });

  it("returns undefined when cache file does not exist", () => {
    expect(readCache("/tmp/voratiq/update-state.json")).toBeUndefined();
  });

  it("returns undefined when cache file is invalid JSON", () => {
    vol.fromJSON({ "/tmp/voratiq/update-state.json": "not json" });
    expect(readCache("/tmp/voratiq/update-state.json")).toBeUndefined();
  });

  it("returns undefined when cache is missing required fields", () => {
    vol.fromJSON({
      "/tmp/voratiq/update-state.json": JSON.stringify({ foo: "bar" }),
    });
    expect(readCache("/tmp/voratiq/update-state.json")).toBeUndefined();
  });

  it("reads a valid cache file", () => {
    vol.fromJSON({
      "/tmp/voratiq/update-state.json": JSON.stringify({
        lastCheckedAt: "2025-01-01T00:00:00.000Z",
        latestVersion: "0.5.0",
      }),
    });
    const result = readCache("/tmp/voratiq/update-state.json");
    expect(result).toEqual({
      lastCheckedAt: "2025-01-01T00:00:00.000Z",
      latestVersion: "0.5.0",
    });
  });

  it("writes a cache file and creates directories", () => {
    writeCache("/tmp/voratiq-new/update-state.json", {
      lastCheckedAt: "2025-01-01T00:00:00.000Z",
      latestVersion: "0.5.0",
    });
    const result = readCache("/tmp/voratiq-new/update-state.json");
    expect(result).toEqual({
      lastCheckedAt: "2025-01-01T00:00:00.000Z",
      latestVersion: "0.5.0",
    });
  });
});

describe("startUpdateCheck", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vol.reset();
  });

  const basePath = "/tmp/voratiq/update-state.json";
  const baseOpts = {
    isTty: true,
    env: {} as NodeJS.ProcessEnv,
    cachePath: basePath,
    now: () => new Date("2025-06-01T12:00:00.000Z"),
    fetchImpl: (() =>
      Promise.resolve(
        new Response(JSON.stringify({ version: "99.0.0" }), {
          status: 200,
        }),
      )) as unknown as typeof fetch,
  };

  describe("trigger gating", () => {
    it("returns undefined when not TTY", () => {
      const handle = startUpdateCheck("0.4.0", {
        ...baseOpts,
        isTty: false,
      });
      expect(handle).toBeUndefined();
    });

    it("returns undefined when CI is truthy", () => {
      const handle = startUpdateCheck("0.4.0", {
        ...baseOpts,
        env: { CI: "true" },
      });
      expect(handle).toBeUndefined();
    });

    it("returns undefined when CI is 1", () => {
      const handle = startUpdateCheck("0.4.0", {
        ...baseOpts,
        env: { CI: "1" },
      });
      expect(handle).toBeUndefined();
    });

    it("does not skip when CI is 0", () => {
      const handle = startUpdateCheck("0.4.0", {
        ...baseOpts,
        env: { CI: "0" },
      });
      expect(handle).toBeDefined();
    });

    it("does not skip when CI is false", () => {
      const handle = startUpdateCheck("0.4.0", {
        ...baseOpts,
        env: { CI: "false" },
      });
      expect(handle).toBeDefined();
    });

    it("does not skip when CI is empty string", () => {
      const handle = startUpdateCheck("0.4.0", {
        ...baseOpts,
        env: { CI: "" },
      });
      expect(handle).toBeDefined();
    });

    it("normalizes CI with trim and lowercase (TRUE with whitespace)", () => {
      const handle = startUpdateCheck("0.4.0", {
        ...baseOpts,
        env: { CI: " TRUE " },
      });
      expect(handle).toBeUndefined();
    });

    it("normalizes CI with trim and lowercase ( False )", () => {
      const handle = startUpdateCheck("0.4.0", {
        ...baseOpts,
        env: { CI: " False " },
      });
      expect(handle).toBeDefined();
    });

    it("treats CI=yes as truthy", () => {
      const handle = startUpdateCheck("0.4.0", {
        ...baseOpts,
        env: { CI: "yes" },
      });
      expect(handle).toBeUndefined();
    });

    it("does not skip when CI is undefined", () => {
      const handle = startUpdateCheck("0.4.0", {
        ...baseOpts,
        env: {},
      });
      expect(handle).toBeDefined();
    });
  });

  describe("cache gating", () => {
    it("does not fetch when cache is fresh (<24h)", async () => {
      const fetchMock = jest.fn<typeof fetch>();
      vol.fromJSON({
        [basePath]: JSON.stringify({
          lastCheckedAt: "2025-06-01T00:00:00.000Z",
          latestVersion: "0.5.0",
        }),
      });

      const handle = startUpdateCheck("0.4.0", {
        ...baseOpts,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      expect(handle).toBeDefined();
      // Give any potential async work a tick
      await new Promise((r) => setTimeout(r, 50));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("fetches when cache is stale (>24h)", async () => {
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ version: "0.6.0" }), { status: 200 }),
        );
      vol.fromJSON({
        [basePath]: JSON.stringify({
          lastCheckedAt: "2025-05-30T00:00:00.000Z",
          latestVersion: "0.5.0",
        }),
      });

      startUpdateCheck("0.4.0", {
        ...baseOpts,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("fetches when no cache exists", async () => {
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ version: "0.6.0" }), { status: 200 }),
        );

      startUpdateCheck("0.4.0", {
        ...baseOpts,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("peekNotice", () => {
    it("returns notice when cached version is newer", () => {
      vol.fromJSON({
        [basePath]: JSON.stringify({
          lastCheckedAt: "2025-06-01T00:00:00.000Z",
          latestVersion: "0.5.0",
        }),
      });

      const handle = startUpdateCheck("0.4.0", baseOpts);
      const notice = handle?.peekNotice();
      expect(notice).toBe("Update available: Voratiq 0.4.0 -> 0.5.0");
    });

    it("returns undefined when cached version is not newer", () => {
      vol.fromJSON({
        [basePath]: JSON.stringify({
          lastCheckedAt: "2025-06-01T00:00:00.000Z",
          latestVersion: "0.4.0",
        }),
      });

      const handle = startUpdateCheck("0.4.0", baseOpts);
      expect(handle?.peekNotice()).toBeUndefined();
    });

    it("returns undefined when no cache exists", () => {
      const handle = startUpdateCheck("0.4.0", baseOpts);
      expect(handle?.peekNotice()).toBeUndefined();
    });

    it("returns notice only once (consumed state)", () => {
      vol.fromJSON({
        [basePath]: JSON.stringify({
          lastCheckedAt: "2025-06-01T00:00:00.000Z",
          latestVersion: "0.5.0",
        }),
      });

      const handle = startUpdateCheck("0.4.0", baseOpts);
      expect(handle?.peekNotice()).toBeDefined();
      expect(handle?.peekNotice()).toBeUndefined();
    });
  });

  describe("failure silence", () => {
    it("swallows fetch rejection silently", async () => {
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockRejectedValue(new Error("network down"));

      const handle = startUpdateCheck("0.4.0", {
        ...baseOpts,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      expect(handle).toBeDefined();
      await new Promise((r) => setTimeout(r, 50));
      // No error thrown; handle is still usable
      expect(handle?.peekNotice()).toBeUndefined();
    });

    it("swallows non-200 responses silently", async () => {
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("Not Found", { status: 404 }));

      const handle = startUpdateCheck("0.4.0", {
        ...baseOpts,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      expect(handle).toBeDefined();
      await new Promise((r) => setTimeout(r, 50));
    });

    it("swallows invalid JSON payload silently", async () => {
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("not json", { status: 200 }));

      startUpdateCheck("0.4.0", {
        ...baseOpts,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      await new Promise((r) => setTimeout(r, 50));
      // No error; cache not written
      expect(readCache(basePath)).toBeUndefined();
    });

    it("swallows response with missing version field", async () => {
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ name: "voratiq" }), { status: 200 }),
        );

      startUpdateCheck("0.4.0", {
        ...baseOpts,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(readCache(basePath)).toBeUndefined();
    });
  });

  describe("finish", () => {
    it("finish() has no output side effects", () => {
      const stdoutSpy = jest.spyOn(process.stdout, "write");
      const stderrSpy = jest.spyOn(process.stderr, "write");

      vol.fromJSON({
        [basePath]: JSON.stringify({
          lastCheckedAt: "2025-06-01T00:00:00.000Z",
          latestVersion: "0.5.0",
        }),
      });

      const handle = startUpdateCheck("0.4.0", baseOpts);
      handle?.finish();

      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();

      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    });
  });

  describe("background cache update", () => {
    it("persists cache on successful fetch", async () => {
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ version: "0.6.0" }), { status: 200 }),
        );

      startUpdateCheck("0.4.0", {
        ...baseOpts,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      await new Promise((r) => setTimeout(r, 100));
      const cache = readCache(basePath);
      expect(cache).toBeDefined();
      expect(cache?.latestVersion).toBe("0.6.0");
      expect(cache?.lastCheckedAt).toBe("2025-06-01T12:00:00.000Z");
    });

    it("does not persist cache on fetch failure", async () => {
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockRejectedValue(new Error("fail"));

      startUpdateCheck("0.4.0", {
        ...baseOpts,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      await new Promise((r) => setTimeout(r, 100));
      expect(readCache(basePath)).toBeUndefined();
    });
  });
});
