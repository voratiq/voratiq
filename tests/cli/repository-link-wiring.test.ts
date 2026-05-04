import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

const repoRoot = process.cwd();

describe("repository link prompt command wiring", () => {
  it.each([
    "root-launcher",
    "spec",
    "run",
    "verify",
    "reduce",
    "message",
    "auto",
    "apply",
  ])("wires the prompt helper into %s", async (command) => {
    const source = await readCliSource(command);

    expect(source).toContain("promptForRepositoryLinkIfNeeded");
  });

  it.each(["status", "list", "doctor", "login", "mcp"])(
    "does not wire the prompt helper into %s",
    async (command) => {
      const source = await readCliSource(command);

      expect(source).not.toContain("promptForRepositoryLinkIfNeeded");
    },
  );
});

async function readCliSource(command: string): Promise<string> {
  return await readFile(path.join(repoRoot, "src", "cli", `${command}.ts`), {
    encoding: "utf8",
  });
}
