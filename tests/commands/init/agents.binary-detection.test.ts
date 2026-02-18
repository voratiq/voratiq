import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configureAgents } from "../../../src/commands/init/agents.js";
import { getSupportedAgentDefaults } from "../../../src/configs/agents/defaults.js";
import { detectBinary } from "../../../src/utils/binaries.js";
import { buildAgentsTemplate } from "../../../src/workspace/templates.js";

jest.mock("../../../src/utils/binaries.js", () => ({
  detectBinary: jest.fn(),
}));

const detectBinaryMock = jest.mocked(detectBinary);

describe("configureAgents binary detection", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "voratiq-agents-detect-"));
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
    detectBinaryMock.mockReset();
    detectBinaryMock.mockImplementation((provider) => `/usr/bin/${provider}`);
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("calls detectBinary once per provider (not once per catalog entry)", async () => {
    await writeFile(
      join(repoRoot, ".voratiq", "agents.yaml"),
      buildAgentsTemplate("pro"),
      "utf8",
    );

    await configureAgents(repoRoot, "pro", { interactive: false });

    const uniqueProviders = [
      ...new Set(getSupportedAgentDefaults().map((entry) => entry.provider)),
    ];
    expect(detectBinaryMock).toHaveBeenCalledTimes(uniqueProviders.length);

    const calledProviders = new Set(
      detectBinaryMock.mock.calls.map(([provider]) => provider),
    );
    expect(calledProviders).toEqual(new Set(uniqueProviders));

    for (const provider of uniqueProviders) {
      const callsForProvider = detectBinaryMock.mock.calls.filter(
        ([calledProvider]) => calledProvider === provider,
      );
      expect(callsForProvider).toHaveLength(1);
    }
  });
});
