import { resolve as resolveAbsolute } from "node:path";

import {
  VORATIQ_HISTORY_LOCK_FILENAME,
  VORATIQ_MESSAGE_DIR,
  VORATIQ_REDUCTION_DIR,
  VORATIQ_RUN_DIR,
  VORATIQ_RUN_FILE,
  VORATIQ_SPEC_DIR,
  VORATIQ_VERIFICATION_DIR,
} from "../../workspace/constants.js";
import { resolveWorkspacePath } from "../../workspace/path-resolvers.js";

export const SANDBOX_STAGE_IDS = [
  "spec",
  "run",
  "reduce",
  "verify",
  "message",
] as const;

export type SandboxStageId = (typeof SANDBOX_STAGE_IDS)[number];

export type SandboxGitAccessLevel = "deny-read" | "deny-read-write";
export type SandboxReadRoot = "repo-root" | "workspace-root";
export type SandboxWriteRoot = "workspace-root";
export type OperatorAccessProtectedOperatorDirKey =
  | "spec-dir"
  | "run-dir"
  | "reduce-dir"
  | "verify-dir"
  | "message-dir";
export type OperatorAccessProtectedMetadataPathKey =
  | "run-index"
  | "run-history-lock";
export type ReadonlyWorkspaceMountKey = "context" | "inputs" | "reference_repo";

export interface OperatorAccessProfile {
  readonly readRoot: SandboxReadRoot;
  readonly writeRoot: SandboxWriteRoot;
  readonly gitAccess: SandboxGitAccessLevel;
  readonly protectedOperatorDirs: readonly OperatorAccessProtectedOperatorDirKey[];
  readonly protectedMetadataPaths: readonly OperatorAccessProtectedMetadataPathKey[];
  readonly restrictRepositoryReads: boolean;
  readonly readonlyWorkspaceMounts: readonly ReadonlyWorkspaceMountKey[];
}

export const OPERATOR_ACCESS_PROFILES = {
  spec: {
    readRoot: "repo-root",
    writeRoot: "workspace-root",
    gitAccess: "deny-read",
    protectedOperatorDirs: [
      "run-dir",
      "reduce-dir",
      "verify-dir",
      "message-dir",
    ],
    protectedMetadataPaths: [],
    restrictRepositoryReads: false,
    readonlyWorkspaceMounts: [],
  },
  run: {
    readRoot: "workspace-root",
    writeRoot: "workspace-root",
    gitAccess: "deny-read-write",
    protectedOperatorDirs: [
      "spec-dir",
      "reduce-dir",
      "verify-dir",
      "message-dir",
    ],
    protectedMetadataPaths: ["run-index", "run-history-lock"],
    restrictRepositoryReads: true,
    readonlyWorkspaceMounts: [],
  },
  reduce: {
    readRoot: "workspace-root",
    writeRoot: "workspace-root",
    gitAccess: "deny-read",
    protectedOperatorDirs: ["spec-dir", "run-dir", "verify-dir", "message-dir"],
    protectedMetadataPaths: [],
    restrictRepositoryReads: true,
    readonlyWorkspaceMounts: [],
  },
  verify: {
    readRoot: "workspace-root",
    writeRoot: "workspace-root",
    gitAccess: "deny-read",
    protectedOperatorDirs: ["spec-dir", "run-dir", "reduce-dir", "message-dir"],
    protectedMetadataPaths: [],
    restrictRepositoryReads: true,
    readonlyWorkspaceMounts: ["context", "inputs", "reference_repo"],
  },
  message: {
    readRoot: "repo-root",
    writeRoot: "workspace-root",
    gitAccess: "deny-read",
    protectedOperatorDirs: ["spec-dir", "run-dir", "reduce-dir", "verify-dir"],
    protectedMetadataPaths: [],
    restrictRepositoryReads: false,
    readonlyWorkspaceMounts: [],
  },
} as const satisfies Record<SandboxStageId, OperatorAccessProfile>;

export function getOperatorAccessProfile(
  stageId: SandboxStageId,
): OperatorAccessProfile {
  return OPERATOR_ACCESS_PROFILES[stageId];
}

export function resolveProtectedOperatorDir(
  root: string,
  key: OperatorAccessProtectedOperatorDirKey,
): string {
  switch (key) {
    case "spec-dir":
      return resolveWorkspacePath(root, VORATIQ_SPEC_DIR);
    case "run-dir":
      return resolveWorkspacePath(root, VORATIQ_RUN_DIR);
    case "reduce-dir":
      return resolveWorkspacePath(root, VORATIQ_REDUCTION_DIR);
    case "verify-dir":
      return resolveWorkspacePath(root, VORATIQ_VERIFICATION_DIR);
    case "message-dir":
      return resolveWorkspacePath(root, VORATIQ_MESSAGE_DIR);
  }
}

export function resolveProtectedMetadataPath(
  root: string,
  key: OperatorAccessProtectedMetadataPathKey,
): string {
  switch (key) {
    case "run-index":
      return resolveWorkspacePath(root, VORATIQ_RUN_FILE);
    case "run-history-lock":
      return resolveWorkspacePath(
        root,
        VORATIQ_RUN_DIR,
        VORATIQ_HISTORY_LOCK_FILENAME,
      );
  }
}

export function resolveRepositoryGitPath(root: string): string {
  return resolveAbsolute(root, ".git");
}
