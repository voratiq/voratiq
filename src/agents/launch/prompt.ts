import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const PROMPT_TMP_PREFIX = "prompt.ephemeral";

export interface WriteStagedPromptOptions {
  runtimePath: string;
  prompt: string;
  prefix?: string;
}

export async function writeStagedPrompt(
  options: WriteStagedPromptOptions,
): Promise<string> {
  const { runtimePath, prompt, prefix = PROMPT_TMP_PREFIX } = options;
  const nonce = randomBytes(8).toString("hex");
  const path = join(runtimePath, `${prefix}.${nonce}.txt`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, prompt, { encoding: "utf8" });
  return path;
}
