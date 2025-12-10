import { describe, expect, test } from "@jest/globals";

import { createConfigLoader } from "../../../src/configs/shared/loader-factory.js";

interface TestLoaderOptions {
  root?: string;
  filePath?: string;
  readFile?: (path: string) => string;
}

const TEST_ROOT = "/repo";
const DEFAULT_PATH = `${TEST_ROOT}/config.yaml`;

const baseLoader = createConfigLoader<string, TestLoaderOptions>({
  resolveFilePath: (root, options) => options.filePath ?? `${root}/config.yaml`,
  selectReadFile: (options) => options.readFile,
  handleMissing: () => "missing",
  parse: (content) => content,
});

describe("createConfigLoader", () => {
  test("returns fallback result when ENOENT occurs", () => {
    const error = new Error("missing") as NodeJS.ErrnoException;
    error.code = "ENOENT";

    const result = baseLoader({
      root: TEST_ROOT,
      readFile: () => {
        throw error;
      },
    });

    expect(result).toBe("missing");
  });

  test("honors custom readFile override", () => {
    const readFile = jest.fn<string, [string]>(() => "custom contents");

    const result = baseLoader({
      root: TEST_ROOT,
      readFile,
    });

    expect(readFile).toHaveBeenCalledWith(DEFAULT_PATH);
    expect(result).toBe("custom contents");
  });

  test("allows prepareContent hooks to transform data", () => {
    const trimmingLoader = createConfigLoader<string, TestLoaderOptions>({
      resolveFilePath: (root, options) =>
        options.filePath ?? `${root}/config.yaml`,
      selectReadFile: (options) => options.readFile,
      handleMissing: () => "missing",
      prepareContent: (content) => content.trim(),
      parse: (content) => content,
    });

    const result = trimmingLoader({
      root: TEST_ROOT,
      readFile: () => "  data  ",
    });

    expect(result).toBe("data");
  });
});
