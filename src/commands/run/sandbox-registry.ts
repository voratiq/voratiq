import type { StagedAuthContext } from "./agents/auth-stage.js";
import { teardownAuthContext } from "./agents/auth-stage.js";

const sandboxRegistry = new Map<string, Set<StagedAuthContext>>();

export function registerStagedSandboxContext(context: StagedAuthContext): void {
  const contexts = sandboxRegistry.get(context.runId);
  if (contexts) {
    contexts.add(context);
    return;
  }
  sandboxRegistry.set(context.runId, new Set([context]));
}

export async function teardownRegisteredSandboxContext(
  context: StagedAuthContext | undefined,
): Promise<void> {
  if (!context) {
    return;
  }
  await teardownAuthContext(context);
  removeContextFromRegistry(context);
}

export async function teardownRunSandboxes(
  runId: string | undefined,
): Promise<void> {
  if (!runId) {
    return;
  }

  const contexts = sandboxRegistry.get(runId);
  if (!contexts || contexts.size === 0) {
    sandboxRegistry.delete(runId);
    return;
  }

  const failures: unknown[] = [];
  const stagedContexts = Array.from(contexts);

  for (const context of stagedContexts) {
    try {
      await teardownAuthContext(context);
      removeContextFromRegistry(context);
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length === 1) {
    throw failures[0];
  }

  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      `Failed to teardown ${failures.length} sandbox contexts for run ${runId}`,
    );
  }
}

function removeContextFromRegistry(context: StagedAuthContext): void {
  const contexts = sandboxRegistry.get(context.runId);
  if (!contexts) {
    return;
  }
  contexts.delete(context);
  if (contexts.size === 0) {
    sandboxRegistry.delete(context.runId);
  }
}
