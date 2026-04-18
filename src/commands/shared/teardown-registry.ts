import { toErrorMessage } from "../../utils/errors.js";

export type ActiveSessionTerminationStatus = "failed" | "aborted";

export interface ActiveSessionTeardownRegistration {
  key: string;
  label: string;
  terminate: (
    status: ActiveSessionTerminationStatus,
    context: string,
  ) => Promise<void> | void;
}

const activeSessionTeardowns = new Map<
  string,
  ActiveSessionTeardownRegistration
>();

export function registerActiveSessionTeardown(
  registration: ActiveSessionTeardownRegistration,
): () => void {
  activeSessionTeardowns.set(registration.key, registration);
  return () => {
    const current = activeSessionTeardowns.get(registration.key);
    if (current === registration) {
      activeSessionTeardowns.delete(registration.key);
    }
  };
}

export function snapshotActiveSessionTeardowns(): ReadonlyArray<{
  key: string;
  label: string;
}> {
  return [...activeSessionTeardowns.values()].map(({ key, label }) => ({
    key,
    label,
  }));
}

export async function terminateRegisteredActiveSessions(
  status: ActiveSessionTerminationStatus,
  context: string,
): Promise<Error | null> {
  const registrations = [...activeSessionTeardowns.values()];
  const errors: Error[] = [];

  for (const registration of registrations) {
    try {
      await registration.terminate(status, context);
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(toErrorMessage(error));
      console.error(
        `[voratiq] Failed to teardown ${registration.label} after ${context}: ${toErrorMessage(error)}`,
      );
      errors.push(normalizedError);
    }
  }

  if (errors.length > 1) {
    return new AggregateError(
      errors,
      `Failed to teardown active sessions after ${context}`,
    );
  }

  return errors[0] ?? null;
}
