import { describe, expect, it } from "@jest/globals";

import { SandboxConfigurationError } from "../../../src/configs/sandbox/errors.js";
import { validateSandboxOverrides } from "../../../src/configs/sandbox/schemas.js";

describe("validateSandboxOverrides", () => {
  it("parses valid override documents", () => {
    const doc = {
      providers: {
        claude: {
          allowedDomains: ["api.example.com"],
        },
      },
    };

    const parsed = validateSandboxOverrides(
      doc,
      "/repo",
      "/repo/.voratiq/sandbox.yaml",
    );
    expect(parsed.providers.claude.allowedDomains).toEqual(["api.example.com"]);
  });

  it("throws SandboxConfigurationError with scoped path details", () => {
    const doc = { providers: { claude: { allowedDomains: [] } } };

    expect(() =>
      validateSandboxOverrides(doc, "/repo", "/repo/.voratiq/sandbox.yaml"),
    ).toThrow(SandboxConfigurationError);
  });
});
