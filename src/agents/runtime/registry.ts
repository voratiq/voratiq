import type { StagedAuthContext } from "./auth.js";
import { teardownAuthContext } from "./auth.js";

const registry = new Map<string, Set<StagedAuthContext>>();

export function registerStagedAuthContext(
  sessionId: string,
  context: StagedAuthContext,
): void {
  const existing = registry.get(sessionId);
  if (existing) {
    existing.add(context);
    return;
  }
  registry.set(sessionId, new Set([context]));
}

export async function teardownRegisteredAuthContext(
  sessionId: string,
  context: StagedAuthContext | undefined,
): Promise<void> {
  if (!context) {
    return;
  }
  await teardownAuthContext(context);
  removeContext(sessionId, context);
}

export async function teardownSessionAuth(
  sessionId: string | undefined,
): Promise<void> {
  if (!sessionId) {
    return;
  }

  const contexts = registry.get(sessionId);
  if (!contexts || contexts.size === 0) {
    registry.delete(sessionId);
    return;
  }

  const failures: unknown[] = [];
  const stagedContexts = Array.from(contexts);
  for (const context of stagedContexts) {
    try {
      await teardownAuthContext(context);
      removeContext(sessionId, context);
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
      `Failed to teardown ${failures.length} auth contexts for session ${sessionId}`,
    );
  }
}

function removeContext(sessionId: string, context: StagedAuthContext): void {
  const contexts = registry.get(sessionId);
  if (!contexts) {
    return;
  }
  contexts.delete(context);
  if (contexts.size === 0) {
    registry.delete(sessionId);
  }
}
