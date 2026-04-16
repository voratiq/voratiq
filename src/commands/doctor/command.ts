import { formatPreflightIssueLines } from "../../competition/shared/preflight.js";
import {
  EnvironmentConfigParseError,
  MissingEnvironmentConfigError,
} from "../../configs/environment/errors.js";
import { loadEnvironmentConfig } from "../../configs/environment/loader.js";
import { prepareConfiguredOperatorReadiness } from "../../preflight/operator.js";
import { toErrorMessage } from "../../utils/errors.js";
import { pathExists } from "../../utils/fs.js";
import {
  WorkspaceError,
  WorkspaceMissingEntryError,
} from "../../workspace/errors.js";
import { formatWorkspacePath } from "../../workspace/path-formatters.js";
import { resolveWorkspacePath } from "../../workspace/path-resolvers.js";
import {
  repairWorkspaceStructure,
  validateWorkspace,
} from "../../workspace/setup.js";
import { executeDoctorBootstrap } from "./fix.js";
import type { DoctorReconcileResult } from "./fix-types.js";
import { executeDoctorReconcile } from "./reconcile.js";

export interface DoctorDiagnosisResult {
  readonly healthy: boolean;
  readonly issueLines: readonly string[];
}

export type DoctorFixMode = "bootstrap-workspace" | "repair-and-reconcile";

export interface DoctorFixResult {
  readonly mode: DoctorFixMode;
  readonly reconcileResult?: DoctorReconcileResult;
}

export interface ExecuteDoctorDiagnosisInput {
  readonly root: string;
}

export interface ExecuteDoctorFixInput {
  readonly root: string;
  readonly mode?: DoctorFixMode;
  readonly bootstrapOptions?: Pick<
    Parameters<typeof executeDoctorBootstrap>[0],
    "preset" | "interactive" | "assumeYes" | "confirm" | "prompt"
  >;
}

const DOCTOR_PREFLIGHT_UNLABELED_AGENT_IDS = ["settings"] as const;

export async function executeDoctorDiagnosis(
  input: ExecuteDoctorDiagnosisInput,
): Promise<DoctorDiagnosisResult> {
  const { root } = input;
  const issueLines: string[] = [];

  const workspacePresent = await pathExists(resolveWorkspacePath(root));
  if (!workspacePresent) {
    const missingWorkspaceIssue = new WorkspaceMissingEntryError(
      `${formatWorkspacePath()}/`,
    );
    issueLines.push(`- ${missingWorkspaceIssue.headline}`);
    return {
      healthy: false,
      issueLines,
    };
  }

  try {
    await validateWorkspace(root);
  } catch (error) {
    issueLines.push(...formatDoctorIssueLines(error));
    return {
      healthy: false,
      issueLines,
    };
  }

  try {
    const diagnostics = await prepareConfiguredOperatorReadiness({ root });
    if (diagnostics.noAgentsEnabled) {
      issueLines.push("- No agents are enabled in `agents.yaml`.");
    }

    issueLines.push(
      ...formatPreflightIssueLines(diagnostics.issues, {
        unlabeledAgentIds: DOCTOR_PREFLIGHT_UNLABELED_AGENT_IDS,
      }),
    );
  } catch (error) {
    issueLines.push(...formatDoctorIssueLines(error));
  }

  try {
    loadEnvironmentConfig({ root });
  } catch (error) {
    if (error instanceof MissingEnvironmentConfigError) {
      issueLines.push(`- ${error.headline}`);
    } else if (error instanceof EnvironmentConfigParseError) {
      issueLines.push(`- ${error.headline}`);
    } else {
      issueLines.push(`- ${toErrorMessage(error)}`);
    }
  }

  return {
    healthy: issueLines.length === 0,
    issueLines,
  };
}

export async function resolveDoctorFixMode(
  root: string,
): Promise<DoctorFixMode> {
  const workspacePresent = await pathExists(resolveWorkspacePath(root));
  return workspacePresent ? "repair-and-reconcile" : "bootstrap-workspace";
}

export async function executeDoctorFix(
  input: ExecuteDoctorFixInput,
): Promise<DoctorFixResult> {
  const mode = input.mode ?? (await resolveDoctorFixMode(input.root));

  if (mode === "bootstrap-workspace") {
    const bootstrapOptions = input.bootstrapOptions;
    await executeDoctorBootstrap({
      root: input.root,
      preset: bootstrapOptions?.preset ?? "pro",
      interactive: bootstrapOptions?.interactive ?? false,
      assumeYes: bootstrapOptions?.assumeYes,
      confirm: bootstrapOptions?.confirm,
      prompt: bootstrapOptions?.prompt,
    });
    return { mode };
  }

  await repairWorkspaceStructure(input.root);
  const reconcileResult = await executeDoctorReconcile({ root: input.root });

  return {
    mode,
    reconcileResult,
  };
}

function formatDoctorIssueLines(error: unknown): string[] {
  if (error instanceof WorkspaceError) {
    return [`- ${error.headline}`];
  }

  if (error instanceof Error && error.message.length > 0) {
    return [`- ${error.message}`];
  }

  return [`- ${toErrorMessage(error)}`];
}
