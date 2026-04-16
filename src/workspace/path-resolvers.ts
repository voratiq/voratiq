import { resolvePathWithinRoot } from "../utils/path.js";
import { VORATIQ_DIR } from "./constants.js";

export function resolveWorkspacePath(
  root: string,
  ...segments: string[]
): string {
  return resolvePathWithinRoot(root, [VORATIQ_DIR, ...segments]);
}
