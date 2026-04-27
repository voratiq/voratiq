import {
  isRepoRelativePath,
  normalizePathForDisplay,
} from "../../utils/path.js";
import { stageExternalSpecCopy } from "../../workspace/run.js";

export interface NormalizeRunSpecPathInput {
  readonly root: string;
  readonly specAbsolutePath: string;
  readonly specDisplayPath: string;
}

export interface NormalizeRunSpecPathResult {
  readonly specAbsolutePath: string;
  readonly specDisplayPath: string;
}

export async function normalizeRunSpecPath(
  input: NormalizeRunSpecPathInput,
): Promise<NormalizeRunSpecPathResult> {
  const { root, specAbsolutePath, specDisplayPath } = input;
  const normalizedDisplayPath = normalizePathForDisplay(specDisplayPath);

  if (isRepoRelativePath(normalizedDisplayPath)) {
    return {
      specAbsolutePath,
      specDisplayPath: normalizedDisplayPath,
    };
  }

  const stagedSpec = await stageExternalSpecCopy({
    root,
    sourceAbsolutePath: specAbsolutePath,
  });

  return {
    specAbsolutePath: stagedSpec.absolutePath,
    specDisplayPath: stagedSpec.relativePath,
  };
}
