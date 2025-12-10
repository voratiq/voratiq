import { spawnSync } from "node:child_process";

export function detectBinary(command: string): string | undefined {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], {
    encoding: "utf8",
  });

  if (result.status === 0) {
    const path = result.stdout.trim();
    if (path.length > 0) {
      return path;
    }
  }

  return undefined;
}
