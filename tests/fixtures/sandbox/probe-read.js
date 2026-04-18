import { readFileSync } from "node:fs";

const targetPath = process.argv[2];
if (!targetPath) {
  throw new Error("missing target path");
}

process.stdout.write(readFileSync(targetPath, "utf8"));
