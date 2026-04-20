import type { ChildProcess } from "node:child_process";

import type { StagedAuthContext } from "./auth.js";
import { teardownAuthContext } from "./auth.js";

const registry = new Map<string, Set<StagedAuthContext>>();
const processRegistry = new Map<string, Set<ChildProcess>>();
const PROCESS_EXIT_WAIT_MS = 2_000;

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

export function registerSessionProcess(
  sessionId: string | undefined,
  child: ChildProcess | undefined,
): void {
  if (!sessionId || !child || child.pid === undefined) {
    return;
  }

  const existing = processRegistry.get(sessionId);
  if (existing) {
    existing.add(child);
    return;
  }

  processRegistry.set(sessionId, new Set([child]));
}

export function unregisterSessionProcess(
  sessionId: string | undefined,
  child: ChildProcess | undefined,
): void {
  if (!sessionId || !child) {
    return;
  }

  removeProcess(sessionId, child);
}

export async function terminateSessionProcesses(
  sessionId: string | undefined,
): Promise<void> {
  if (!sessionId) {
    return;
  }

  const children = processRegistry.get(sessionId);
  if (!children || children.size === 0) {
    processRegistry.delete(sessionId);
    return;
  }

  const failures: Error[] = [];
  await Promise.all(
    [...children].map(async (child) => {
      try {
        await terminateRegisteredProcess(sessionId, child);
      } catch (error) {
        failures.push(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }),
  );

  if (failures.length === 1) {
    throw failures[0];
  }

  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      `Failed to terminate ${failures.length} session processes for ${sessionId}`,
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

function removeProcess(sessionId: string, child: ChildProcess): void {
  const children = processRegistry.get(sessionId);
  if (!children) {
    return;
  }

  children.delete(child);
  if (children.size === 0) {
    processRegistry.delete(sessionId);
  }
}

async function terminateRegisteredProcess(
  sessionId: string,
  child: ChildProcess,
): Promise<void> {
  if (hasExited(child) || child.pid === undefined) {
    removeProcess(sessionId, child);
    return;
  }

  if (tryTerminateProcessGroup(child.pid, "SIGTERM")) {
    const exitedOnTerm = await waitForProcessExit(child, PROCESS_EXIT_WAIT_MS);
    if (exitedOnTerm) {
      removeProcess(sessionId, child);
      return;
    }
  } else {
    removeProcess(sessionId, child);
    return;
  }

  if (tryTerminateProcessGroup(child.pid, "SIGKILL")) {
    const exitedOnKill = await waitForProcessExit(child, PROCESS_EXIT_WAIT_MS);
    if (exitedOnKill) {
      removeProcess(sessionId, child);
      return;
    }
  } else {
    removeProcess(sessionId, child);
    return;
  }

  throw new Error(
    `Detached agent process ${child.pid} did not exit after SIGTERM and SIGKILL.`,
  );
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function tryTerminateProcessGroup(
  pid: number,
  signal: NodeJS.Signals,
): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

async function waitForProcessExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (hasExited(child)) {
    return true;
  }

  if (typeof child.once !== "function") {
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (typeof child.removeListener === "function") {
        child.removeListener("exit", handleExit);
        child.removeListener("close", handleExit);
      }
      clearTimeout(timer);
      resolve(exited);
    };

    const handleExit = () => {
      finish(true);
    };

    const timer = setTimeout(() => {
      finish(hasExited(child));
    }, timeoutMs);

    child.once("exit", handleExit);
    child.once("close", handleExit);
  });
}
