import { access, constants as fsConstants, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const TARGET = resolve(process.cwd(), "hello-world.txt");
const isActive = process.env.HELLO_WORLD_SPEC === "true";

(isActive ? describe : describe.skip)("hello-world spec", () => {
  it("creates hello-world.txt in the repo root", async () => {
    await expect(access(TARGET, fsConstants.F_OK)).resolves.toBeUndefined();
  });

  it("writes the exact contents required by the spec", async () => {
    const contents = await readFile(TARGET, "utf8");
    expect(contents.trimEnd()).toBe("hello world ~");
  });
});
