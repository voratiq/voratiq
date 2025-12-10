import { access, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const DIST_DIR = join(ROOT, "dist");
const SHIM_DIR = join(DIST_DIR, "commands", "run", "shim");
const COMPILED_SHIM_PATH = join(SHIM_DIR, "run-agent-shim.js");
const SHIM_ENTRY_PATH = join(SHIM_DIR, "run-agent-shim.mjs");

await access(COMPILED_SHIM_PATH);

const stub = [
  'import { main } from "./run-agent-shim.js";',
  "",
  "try {",
  "  const exitCode = await main();",
  "  process.exit(exitCode);",
  "} catch (error) {",
  "  const detail = error instanceof Error ? error.message : String(error);",
  "  console.error(`[voratiq] Unexpected error: ${detail}`);",
  "  process.exit(1);",
  "}",
  "",
].join("\n");

try {
  await writeFile(SHIM_ENTRY_PATH, stub, { encoding: "utf8" });
} catch (error) {
  if (error && typeof error === "object" && "code" in error) {
    const code = error.code;
    if (code === "EPERM") {
      console.warn(
        `[voratiq] Skipping shim rewrite at ${SHIM_ENTRY_PATH} (read-only target).`,
      );
    } else {
      throw error;
    }
  } else {
    throw error;
  }
}
