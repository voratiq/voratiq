import { describe, expect, it, jest } from "@jest/globals";

import {
  parseYamlDocument,
  type YamlParseErrorDetail,
} from "../../src/utils/yaml-reader.js";

describe("parseYamlDocument", () => {
  it("returns the provided empty value when content is blank", () => {
    const onEmpty = jest.fn();
    const result = parseYamlDocument("\n   \t", {
      emptyValue: { sentinel: true },
      onEmpty,
      formatError: () => new Error("should not parse"),
    });

    expect(result).toEqual({ sentinel: true });
    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  it("surfaces YAMLException locations when parsing fails", () => {
    const formatError = jest.fn<(detail: YamlParseErrorDetail) => Error>(
      () => new Error("yaml failed"),
    );

    expect(() =>
      parseYamlDocument("agents:\n  - id: [", {
        formatError,
      }),
    ).toThrow("yaml failed");

    expect(formatError).toHaveBeenCalledTimes(1);
    const detail = formatError.mock.calls[0]?.[0];
    expect(detail).toBeDefined();
    expect(detail?.isYamlError).toBe(true);
    expect(detail?.line).toBeGreaterThanOrEqual(1);
    expect(detail?.column).toBeGreaterThanOrEqual(1);
  });
});
