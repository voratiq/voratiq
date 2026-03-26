import { copyFile, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import {
  dirname,
  join,
  relative as relativePath,
  resolve,
  sep,
} from "node:path";

import { pathExists } from "../../../utils/fs.js";
import { createDetachedWorktree, removeWorktree } from "../../../utils/git.js";
import {
  type AgentWorkspacePaths,
  buildAgentWorkspacePaths,
} from "../../../workspace/layout.js";
import { VORATIQ_VERIFICATION_SESSIONS_DIR } from "../../../workspace/structure.js";
import { aliasForCandidate } from "./blinding.js";
import type { ResolvedVerificationTarget } from "./target.js";

const BLINDED_VERIFY_SPEC_ARTIFACT_ALLOWLIST = [
  {
    sourcePathKey: "outputPath",
    stagedFilename: "spec.md",
    required: true,
  },
  {
    sourcePathKey: "dataPath",
    stagedFilename: "spec.json",
    required: false,
  },
] as const;

const BLINDED_VERIFY_RUN_ARTIFACT_ALLOWLIST = [
  {
    sourceFilename: "diff.patch",
    stagedFilename: "diff.patch",
    requiredArtifactStateKey: "diffCaptured",
  },
  {
    sourceFilename: "summary.txt",
    stagedFilename: "summary.txt",
    requiredArtifactStateKey: undefined,
  },
] as const;

export type SharedVerificationInputs =
  | {
      kind: "spec";
      sharedRootAbsolute: string;
      sharedInputsAbsolute: string;
      referenceRepoAbsolute: string;
      worktreesToRemove: readonly string[];
      candidates: readonly {
        alias: string;
        hasSpecData: boolean;
      }[];
    }
  | {
      kind: "run";
      sharedRootAbsolute: string;
      sharedInputsAbsolute: string;
      referenceRepoAbsolute: string;
      worktreesToRemove: readonly string[];
      candidates: readonly {
        alias: string;
        hasDiff: boolean;
        hasSummary: boolean;
      }[];
    }
  | {
      kind: "reduce";
      sharedRootAbsolute: string;
      sharedInputsAbsolute: string;
      referenceRepoAbsolute: string;
      worktreesToRemove: readonly string[];
      candidates: readonly {
        alias: string;
      }[];
    };

export type StagedVerificationInputs =
  | {
      kind: "spec";
      referenceRepoPath: string;
      descriptionPath: string;
      candidates: readonly {
        alias: string;
        specPath: string;
        specDataPath?: string;
      }[];
    }
  | {
      kind: "run";
      referenceRepoPath: string;
      specPath: string;
      candidates: readonly {
        alias: string;
        diffPath?: string;
        summaryPath?: string;
      }[];
    }
  | {
      kind: "reduce";
      referenceRepoPath: string;
      candidates: readonly {
        alias: string;
        reductionPath: string;
      }[];
    };

export async function prepareSharedVerificationInputs(options: {
  root: string;
  verificationId: string;
  resolvedTarget: ResolvedVerificationTarget;
  aliasMap?: Record<string, string>;
}): Promise<SharedVerificationInputs> {
  const { root, verificationId, resolvedTarget, aliasMap } = options;
  const sharedRootAbsolute = resolve(
    root,
    ".voratiq",
    VORATIQ_VERIFICATION_SESSIONS_DIR,
    verificationId,
    ".shared",
  );
  const sharedInputsAbsolute = resolve(sharedRootAbsolute, "inputs");
  const referenceRepoAbsolute = resolve(
    sharedRootAbsolute,
    "reference",
    "repo",
  );

  await mkdir(sharedInputsAbsolute, { recursive: true });
  await mkdir(dirname(referenceRepoAbsolute), { recursive: true });

  let detachedWorktreeCreated = false;
  try {
    await createDetachedWorktree({
      root,
      worktreePath: referenceRepoAbsolute,
      baseRevision: resolvedTarget.baseRevisionSha,
    });
    detachedWorktreeCreated = true;

    if ("specRecord" in resolvedTarget) {
      const descriptionAbsolute = resolve(
        sharedInputsAbsolute,
        "description.md",
      );
      await writeFile(
        descriptionAbsolute,
        `${resolvedTarget.specRecord.description.trimEnd()}\n`,
        "utf8",
      );

      const draftsDir = resolve(sharedInputsAbsolute, "drafts");
      await mkdir(draftsDir, { recursive: true });

      const candidates = await Promise.all(
        resolvedTarget.specRecord.agents
          .filter((agent) => agent.status === "succeeded" && agent.outputPath)
          .map(async (agent) => {
            const alias = aliasForCandidate(agent.agentId, aliasMap);
            const dir = resolve(draftsDir, alias);
            await mkdir(dir, { recursive: true });

            const copiedArtifacts = await Promise.all(
              BLINDED_VERIFY_SPEC_ARTIFACT_ALLOWLIST.map((artifact) =>
                copyRetainedVerificationArtifact({
                  root,
                  sourceRelativePath: agent[artifact.sourcePathKey],
                  destinationAbsolute: resolve(dir, artifact.stagedFilename),
                  ownerLabel: `Spec \`${resolvedTarget.target.sessionId}\` candidate \`${agent.agentId}\``,
                  artifactLabel: artifact.stagedFilename,
                  required: artifact.required,
                }),
              ),
            );

            if (!copiedArtifacts[0]) {
              throw new Error(
                `Spec \`${resolvedTarget.target.sessionId}\` candidate \`${agent.agentId}\` is missing required verification artifact \`spec.md\`.`,
              );
            }

            return {
              alias,
              hasSpecData: copiedArtifacts[1] !== undefined,
            };
          }),
      );

      return {
        kind: "spec",
        sharedRootAbsolute,
        sharedInputsAbsolute,
        referenceRepoAbsolute,
        worktreesToRemove: [referenceRepoAbsolute],
        candidates,
      };
    }

    if ("runRecord" in resolvedTarget) {
      const specDestination = resolve(sharedInputsAbsolute, "spec.md");
      await copyFile(
        resolve(root, resolvedTarget.runRecord.spec.path),
        specDestination,
      );

      const candidatesDir = resolve(sharedInputsAbsolute, "candidates");
      await mkdir(candidatesDir, { recursive: true });

      const candidates = await Promise.all(
        resolvedTarget.target.candidateIds.map(async (candidateId) => {
          const alias = aliasForCandidate(candidateId, aliasMap);
          const dir = resolve(candidatesDir, alias);
          await mkdir(dir, { recursive: true });

          const runPaths = buildAgentWorkspacePaths({
            root,
            runId: resolvedTarget.target.sessionId,
            agentId: candidateId,
          });

          const runAgentRecord = resolvedTarget.runRecord.agents.find(
            (agent) => agent.agentId === candidateId,
          );
          const copiedArtifacts = await Promise.all(
            BLINDED_VERIFY_RUN_ARTIFACT_ALLOWLIST.map((artifact) =>
              copyArtifactForRunCandidate({
                sourceAbsolute: resolve(
                  runPaths.artifactsPath,
                  artifact.sourceFilename,
                ),
                destinationAbsolute: resolve(dir, artifact.stagedFilename),
                required: artifact.requiredArtifactStateKey
                  ? (runAgentRecord?.artifacts?.[
                      artifact.requiredArtifactStateKey
                    ] ?? false)
                  : false,
                runId: resolvedTarget.target.sessionId,
                candidateId,
                label: artifact.stagedFilename,
              }),
            ),
          );

          return {
            alias,
            hasDiff: copiedArtifacts[0] !== undefined,
            hasSummary: copiedArtifacts[1] !== undefined,
          };
        }),
      );

      return {
        kind: "run",
        sharedRootAbsolute,
        sharedInputsAbsolute,
        referenceRepoAbsolute,
        worktreesToRemove: [referenceRepoAbsolute],
        candidates,
      };
    }

    const candidatesDir = resolve(sharedInputsAbsolute, "candidates");
    await mkdir(candidatesDir, { recursive: true });

    const candidates = await Promise.all(
      resolvedTarget.reductionRecord.reducers
        .filter(
          (reducer) => reducer.status === "succeeded" && reducer.outputPath,
        )
        .map(async (reducer) => {
          const alias = aliasForCandidate(reducer.agentId, aliasMap);
          const dir = resolve(candidatesDir, alias);
          await mkdir(dir, { recursive: true });

          await copyRetainedVerificationArtifact({
            root,
            sourceRelativePath: reducer.outputPath,
            destinationAbsolute: resolve(dir, "reduction.md"),
            ownerLabel: `Reduction \`${resolvedTarget.target.sessionId}\` candidate \`${reducer.agentId}\``,
            artifactLabel: "reduction.md",
            required: true,
          });

          return { alias };
        }),
    );

    return {
      kind: "reduce",
      sharedRootAbsolute,
      sharedInputsAbsolute,
      referenceRepoAbsolute,
      worktreesToRemove: [referenceRepoAbsolute],
      candidates,
    };
  } catch (error) {
    if (detachedWorktreeCreated) {
      await removeWorktree({
        root,
        worktreePath: referenceRepoAbsolute,
      }).catch(() => {});
    }
    await rm(sharedRootAbsolute, {
      recursive: true,
      force: true,
    }).catch(() => {});
    throw error;
  }
}

export async function cleanupSharedVerificationInputs(options: {
  root: string;
  sharedInputs: SharedVerificationInputs;
}): Promise<void> {
  const { root, sharedInputs } = options;
  for (const worktreePath of sharedInputs.worktreesToRemove) {
    await removeWorktree({ root, worktreePath }).catch(() => {});
  }
  await rm(sharedInputs.sharedRootAbsolute, {
    recursive: true,
    force: true,
  }).catch(() => {});
}

export function buildStagedVerificationInputs(options: {
  workspacePaths: AgentWorkspacePaths;
  sharedInputs: SharedVerificationInputs;
}): StagedVerificationInputs {
  const { workspacePaths, sharedInputs } = options;
  const inputsRoot = resolve(workspacePaths.workspacePath, "inputs");

  if (sharedInputs.kind === "spec") {
    return {
      kind: "spec",
      referenceRepoPath: "reference_repo",
      descriptionPath: toWorkspaceRelative(
        workspacePaths.workspacePath,
        resolve(inputsRoot, "description.md"),
      ),
      candidates: sharedInputs.candidates.map((candidate) => ({
        alias: candidate.alias,
        specPath: toWorkspaceRelative(
          workspacePaths.workspacePath,
          resolve(inputsRoot, "drafts", candidate.alias, "spec.md"),
        ),
        ...(candidate.hasSpecData
          ? {
              specDataPath: toWorkspaceRelative(
                workspacePaths.workspacePath,
                resolve(inputsRoot, "drafts", candidate.alias, "spec.json"),
              ),
            }
          : {}),
      })),
    };
  }

  if (sharedInputs.kind === "run") {
    return {
      kind: "run",
      referenceRepoPath: "reference_repo",
      specPath: toWorkspaceRelative(
        workspacePaths.workspacePath,
        resolve(inputsRoot, "spec.md"),
      ),
      candidates: sharedInputs.candidates.map((candidate) => ({
        alias: candidate.alias,
        ...(candidate.hasDiff
          ? {
              diffPath: toWorkspaceRelative(
                workspacePaths.workspacePath,
                resolve(
                  inputsRoot,
                  "candidates",
                  candidate.alias,
                  "diff.patch",
                ),
              ),
            }
          : {}),
        ...(candidate.hasSummary
          ? {
              summaryPath: toWorkspaceRelative(
                workspacePaths.workspacePath,
                resolve(
                  inputsRoot,
                  "candidates",
                  candidate.alias,
                  "summary.txt",
                ),
              ),
            }
          : {}),
      })),
    };
  }

  return {
    kind: "reduce",
    referenceRepoPath: "reference_repo",
    candidates: sharedInputs.candidates.map((candidate) => ({
      alias: candidate.alias,
      reductionPath: toWorkspaceRelative(
        workspacePaths.workspacePath,
        resolve(inputsRoot, "candidates", candidate.alias, "reduction.md"),
      ),
    })),
  };
}

export async function attachVerifierWorkspaceMounts(options: {
  workspacePath: string;
  contextPath: string;
  sharedInputsAbsolute: string;
  referenceRepoAbsolute: string;
}): Promise<void> {
  const {
    workspacePath,
    contextPath,
    sharedInputsAbsolute,
    referenceRepoAbsolute,
  } = options;
  await attachSharedInputsToVerifierWorkspace({
    workspacePath,
    sharedInputsAbsolute,
  });
  await attachWorkspaceDirectorySymlink({
    workspacePath,
    mountName: "reference_repo",
    targetAbsolutePath: referenceRepoAbsolute,
  });
  await attachWorkspaceDirectorySymlink({
    workspacePath,
    mountName: "context",
    targetAbsolutePath: contextPath,
  });
}

async function attachSharedInputsToVerifierWorkspace(options: {
  workspacePath: string;
  sharedInputsAbsolute: string;
}): Promise<void> {
  const { workspacePath, sharedInputsAbsolute } = options;
  await mkdir(workspacePath, { recursive: true });
  const verifierInputsPath = join(workspacePath, "inputs");
  await rm(verifierInputsPath, { recursive: true, force: true }).catch(
    () => {},
  );
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(sharedInputsAbsolute, verifierInputsPath, linkType);
}

async function attachWorkspaceDirectorySymlink(options: {
  workspacePath: string;
  mountName: string;
  targetAbsolutePath: string;
}): Promise<void> {
  const { workspacePath, mountName, targetAbsolutePath } = options;
  const mountPath = join(workspacePath, mountName);
  await rm(mountPath, { recursive: true, force: true }).catch(() => {});
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(targetAbsolutePath, mountPath, linkType);
}

function toWorkspaceRelative(
  workspacePath: string,
  absoluteWorkspaceFilePath: string,
): string {
  return relativePath(workspacePath, absoluteWorkspaceFilePath)
    .split(sep)
    .join("/");
}

async function copyIfExists(
  sourceAbsolute: string,
  destinationAbsolute: string,
): Promise<string | undefined> {
  if (!(await pathExists(sourceAbsolute))) {
    return undefined;
  }
  await copyFile(sourceAbsolute, destinationAbsolute);
  return destinationAbsolute;
}

async function copyRetainedVerificationArtifact(options: {
  root: string;
  sourceRelativePath?: string;
  destinationAbsolute: string;
  ownerLabel: string;
  artifactLabel: string;
  required: boolean;
}): Promise<string | undefined> {
  const {
    root,
    sourceRelativePath,
    destinationAbsolute,
    ownerLabel,
    artifactLabel,
    required,
  } = options;
  if (!sourceRelativePath) {
    if (!required) {
      return undefined;
    }
    throw new Error(
      `${ownerLabel} is missing required verification artifact \`${artifactLabel}\`.`,
    );
  }

  const sourceAbsolute = resolve(root, sourceRelativePath);
  const copied = await copyIfExists(sourceAbsolute, destinationAbsolute);
  if (copied || !required) {
    return copied;
  }

  throw new Error(
    `${ownerLabel} is missing required verification artifact \`${artifactLabel}\` (${sourceAbsolute}).`,
  );
}

async function copyArtifactForRunCandidate(options: {
  sourceAbsolute: string;
  destinationAbsolute: string;
  required: boolean;
  runId: string;
  candidateId: string;
  label: string;
}): Promise<string | undefined> {
  const {
    sourceAbsolute,
    destinationAbsolute,
    required,
    runId,
    candidateId,
    label,
  } = options;
  const copied = await copyIfExists(sourceAbsolute, destinationAbsolute);
  if (copied || !required) {
    return copied;
  }

  throw new Error(
    `Run \`${runId}\` candidate \`${candidateId}\` is missing required verification artifact \`${label}\` (${sourceAbsolute}).`,
  );
}
