import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "../../../agents/runtime/shim/run-agent-shim.js";

export { main };

const modulePath = fileURLToPath(import.meta.url);
const invokedScript = process.argv[1]
  ? resolvePath(process.argv[1])
  : undefined;

if (invokedScript && modulePath === invokedScript) {
  void main().then(
    (exitCode) => {
      process.exit(exitCode);
    },
    (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[voratiq] Unexpected error: ${detail}`);
      process.exit(1);
    },
  );
}
