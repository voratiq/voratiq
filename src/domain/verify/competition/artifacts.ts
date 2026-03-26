import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { VerificationResultArtifact } from "../model/types.js";

export async function writeVerificationArtifact(options: {
  root: string;
  artifactPath: string;
  artifact: VerificationResultArtifact;
}): Promise<void> {
  const absolutePath = resolve(options.root, options.artifactPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    `${JSON.stringify(options.artifact, null, 2)}\n`,
    "utf8",
  );
}
