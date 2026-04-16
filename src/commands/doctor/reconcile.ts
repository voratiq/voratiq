import { readFile } from "node:fs/promises";

import { readAgentsConfig } from "../../configs/agents/loader.js";
import { buildDefaultOrchestrationTemplate } from "../../configs/orchestration/bootstrap.js";
import { pathExists } from "../../utils/fs.js";
import { readConfigSnapshot, writeConfigIfChanged } from "../../utils/yaml.js";
import { VORATIQ_ORCHESTRATION_FILE } from "../../workspace/constants.js";
import {
  computeManagedFingerprint,
  isManagedFingerprintMatch,
  readManagedState,
  updateManagedState,
} from "../../workspace/managed-state.js";
import { formatWorkspacePath } from "../../workspace/path-formatters.js";
import { resolveWorkspacePath } from "../../workspace/path-resolvers.js";
import { createWorkspace } from "../../workspace/setup.js";
import { reconcileManagedDoctorAgents } from "./agents.js";
import { reconcileDoctorEnvironment } from "./environment.js";
import type {
  DoctorReconcileInput,
  DoctorReconcileResult,
} from "./fix-types.js";

export async function executeDoctorReconcile(
  input: DoctorReconcileInput,
): Promise<DoctorReconcileResult> {
  const { root } = input;
  const workspaceDirExists = await pathExists(resolveWorkspacePath(root));
  const workspaceResult = workspaceDirExists
    ? undefined
    : await createWorkspace(root);

  const agentSummary = await reconcileManagedDoctorAgents(root);
  const environmentSummary = await reconcileDoctorEnvironment(root, {
    interactive: false,
  });

  const orchestrationSummary = await reconcileManagedOrchestration(root);

  const [agentsContent, orchestrationContent] = await Promise.all([
    readFile(resolveWorkspacePath(root, "agents.yaml"), "utf8"),
    readFile(resolveWorkspacePath(root, "orchestration.yaml"), "utf8"),
  ]);

  await updateManagedState(root, {
    ...(agentSummary.managed ? { agentsContent } : {}),
    ...(orchestrationSummary.managed
      ? {
          orchestrationContent,
          orchestrationPreset: orchestrationSummary.preset,
        }
      : {}),
  });

  return {
    workspaceBootstrapped: !workspaceDirExists,
    workspaceResult,
    agentSummary,
    environmentSummary,
    orchestrationSummary,
  };
}

async function reconcileManagedOrchestration(root: string) {
  const configPath = formatWorkspacePath(VORATIQ_ORCHESTRATION_FILE);
  const filePath = resolveWorkspacePath(root, VORATIQ_ORCHESTRATION_FILE);
  const agentsPath = resolveWorkspacePath(root, "agents.yaml");
  const [snapshot, agentsContent, managedState] = await Promise.all([
    readConfigSnapshot(filePath),
    readFile(agentsPath, "utf8"),
    readManagedState(root),
  ]);

  const agentsConfig = readAgentsConfig(agentsContent);
  const preset =
    managedState?.configs.orchestration?.preset ??
    inferManagedPreset(snapshot.content, agentsConfig) ??
    "pro";

  const desired = buildDefaultOrchestrationTemplate(agentsConfig, preset);
  const managed =
    !snapshot.exists ||
    isManagedFingerprintMatch(
      managedState?.configs.orchestration,
      snapshot.content,
    ) ||
    computeManagedFingerprint(snapshot.content) ===
      computeManagedFingerprint(desired);

  if (!snapshot.exists) {
    await writeConfigIfChanged(filePath, desired, "__missing__");
    return {
      configPath,
      configCreated: true,
      configUpdated: true,
      skippedCustomized: false,
      managed: true,
      preset,
    };
  }

  if (!managed) {
    return {
      configPath,
      configCreated: false,
      configUpdated: false,
      skippedCustomized: true,
      managed: false,
      preset,
    };
  }

  const updated = await writeConfigIfChanged(
    filePath,
    desired,
    snapshot.normalized,
  );
  return {
    configPath,
    configCreated: false,
    configUpdated: updated,
    skippedCustomized: false,
    managed: true,
    preset,
  };
}

function inferManagedPreset(
  content: string,
  agentsConfig: ReturnType<typeof readAgentsConfig>,
) {
  const normalized = computeManagedFingerprint(content);
  for (const preset of ["pro", "lite", "manual"] as const) {
    const candidate = buildDefaultOrchestrationTemplate(agentsConfig, preset);
    if (computeManagedFingerprint(candidate) === normalized) {
      return preset;
    }
  }
  return undefined;
}
