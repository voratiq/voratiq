import { describe, expect, test } from "@jest/globals";

import {
  formatYamlErrorDetail,
  formatYamlErrorMessage,
} from "../../../src/configs/shared/yaml-error-formatter.js";
import type { YamlParseErrorDetail } from "../../../src/utils/yaml-reader.js";

describe("formatYamlErrorMessage", () => {
  const CONTEXT = "Invalid config.yaml";

  test("formats with line and column", () => {
    const detail: YamlParseErrorDetail = {
      reason: "unexpected token",
      line: 5,
      column: 10,
      error: new Error("parse failed"),
      isYamlError: true,
    };

    const result = formatYamlErrorMessage(detail, { context: CONTEXT });

    expect(result).toBe(
      "Invalid config.yaml (line 5, column 10): unexpected token",
    );
  });

  test("formats without location info", () => {
    const detail: YamlParseErrorDetail = {
      reason: "malformed input",
      error: new Error("parse failed"),
      isYamlError: true,
    };

    const result = formatYamlErrorMessage(detail, { context: CONTEXT });

    expect(result).toBe("Invalid config.yaml: malformed input");
  });

  test("uses message when reason is absent", () => {
    const detail: YamlParseErrorDetail = {
      message: "generic error",
      line: 3,
      column: 1,
      error: new Error("parse failed"),
      isYamlError: true,
    };

    const result = formatYamlErrorMessage(detail, { context: CONTEXT });

    expect(result).toBe(
      "Invalid config.yaml (line 3, column 1): generic error",
    );
  });

  test("uses fallbackReason when no reason or message", () => {
    const detail: YamlParseErrorDetail = {
      error: new Error("parse failed"),
      isYamlError: true,
    };

    const result = formatYamlErrorMessage(detail, {
      context: CONTEXT,
      fallbackReason: "unknown parse error",
    });

    expect(result).toBe("Invalid config.yaml: unknown parse error");
  });

  test("uses context as fallback message when no reason, message, or fallbackReason", () => {
    const detail: YamlParseErrorDetail = {
      error: new Error("parse failed"),
      isYamlError: true,
    };

    const result = formatYamlErrorMessage(detail, { context: CONTEXT });

    expect(result).toBe("Invalid config.yaml: Invalid config.yaml");
  });

  test("includes displayPath with location", () => {
    const detail: YamlParseErrorDetail = {
      reason: "syntax error",
      line: 2,
      column: 4,
      error: new Error("parse failed"),
      isYamlError: true,
    };

    const result = formatYamlErrorMessage(detail, {
      context: CONTEXT,
      displayPath: ".voratiq/config.yaml",
    });

    expect(result).toBe(
      "Invalid config.yaml: .voratiq/config.yaml (line 2, column 4): syntax error",
    );
  });

  test("includes displayPath without location", () => {
    const detail: YamlParseErrorDetail = {
      reason: "parse failure",
      error: new Error("parse failed"),
      isYamlError: true,
    };

    const result = formatYamlErrorMessage(detail, {
      context: CONTEXT,
      displayPath: ".voratiq/config.yaml",
    });

    expect(result).toBe(
      "Invalid config.yaml: .voratiq/config.yaml: parse failure",
    );
  });
});

describe("formatYamlErrorDetail", () => {
  test("formats with line and column", () => {
    const detail: YamlParseErrorDetail = {
      reason: "unexpected token",
      line: 5,
      column: 10,
      error: new Error("parse failed"),
      isYamlError: true,
    };

    const result = formatYamlErrorDetail(detail);

    expect(result).toBe("(line 5, column 10): unexpected token");
  });

  test("formats without location info", () => {
    const detail: YamlParseErrorDetail = {
      reason: "malformed input",
      error: new Error("parse failed"),
      isYamlError: true,
    };

    const result = formatYamlErrorDetail(detail);

    expect(result).toBe("malformed input");
  });

  test("uses message when reason is absent", () => {
    const detail: YamlParseErrorDetail = {
      message: "generic error",
      line: 3,
      column: 1,
      error: new Error("parse failed"),
      isYamlError: true,
    };

    const result = formatYamlErrorDetail(detail);

    expect(result).toBe("(line 3, column 1): generic error");
  });

  test("uses fallbackReason when no reason or message", () => {
    const detail: YamlParseErrorDetail = {
      error: new Error("parse failed"),
      isYamlError: true,
    };

    const result = formatYamlErrorDetail(detail, {
      fallbackReason: "configuration error",
    });

    expect(result).toBe("configuration error");
  });

  test("uses default fallback when no reason, message, or fallbackReason", () => {
    const detail: YamlParseErrorDetail = {
      error: new Error("parse failed"),
      isYamlError: true,
    };

    const result = formatYamlErrorDetail(detail);

    expect(result).toBe("unknown error");
  });
});
