import { spawnSync } from "node:child_process";

export function detectBinary(command: string): string | undefined {
  const result = spawnSync("bash", ["-c", `command -v ${command}`], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: process.env.PATH ?? "",
    },
  });

  if (result.status === 0) {
    const path = result.stdout.trim();
    if (path.length > 0) {
      return path;
    }
  }

  return undefined;
}
