import { getInteractiveSessionRecordSnapshot } from "./persistence/adapter.js";

export type InteractiveSessionEnvLineage =
  | { kind: "trusted"; sessionId: string }
  | { kind: "ignore" };

// Resolve whether the VORATIQ_INTERACTIVE_SESSION_ID env value still points at
// a live interactive session. Env values inherited from a stale shell or a
// stale MCP config must not be persisted as lineage; callers treat "ignore"
// the same as "no env was set" so the original no-lineage message behavior
// applies. I/O failures fall through to "ignore" to fail safe.
export async function resolveInteractiveSessionEnvLineage(options: {
  root: string;
  envValue: string | undefined;
}): Promise<InteractiveSessionEnvLineage> {
  const envValue = options.envValue?.trim();
  if (!envValue) {
    return { kind: "ignore" };
  }

  try {
    const record = await getInteractiveSessionRecordSnapshot({
      root: options.root,
      sessionId: envValue,
    });
    if (!record || record.status !== "running") {
      return { kind: "ignore" };
    }
    return { kind: "trusted", sessionId: envValue };
  } catch {
    return { kind: "ignore" };
  }
}
