import { readFile, stat } from "node:fs/promises";

import type { RunRecordEnhanced } from "../../runs/records/enhanced.js";
import { isFileSystemError } from "../../utils/fs.js";
import { resolvePath } from "../../utils/path.js";

export interface EligibleReviewCandidateAgent {
  agent: RunRecordEnhanced["agents"][number];
  diffSourceAbsolute: string;
}

export async function resolveEligibleReviewCandidateAgents(options: {
  root: string;
  run: RunRecordEnhanced;
}): Promise<EligibleReviewCandidateAgent[]> {
  const { root, run } = options;
  const eligible: EligibleReviewCandidateAgent[] = [];

  for (const agent of run.agents) {
    if (agent.status !== "succeeded") {
      continue;
    }

    const diffRepoRelative = agent.assets.diffPath;
    if (!diffRepoRelative) {
      continue;
    }

    const diffSourceAbsolute = resolvePath(root, diffRepoRelative);
    try {
      const stats = await stat(diffSourceAbsolute);
      if (!stats.isFile() || stats.size <= 0) {
        continue;
      }

      const diffContent = await readFile(diffSourceAbsolute);
      if (diffContent.length <= 0) {
        continue;
      }
    } catch (error) {
      if (
        isFileSystemError(error) &&
        (error.code === "ENOENT" ||
          error.code === "EACCES" ||
          error.code === "EPERM")
      ) {
        continue;
      }
      throw error;
    }

    eligible.push({ agent, diffSourceAbsolute });
  }

  return eligible;
}
