/**
 * Tests must opt into run record hooks before using them so production builds
 * never leak globals. This helper module takes care of the opt-in steps via
 * enableTestHookRegistration() and enableRunRecordsTestHooks().
 */
import type {
  RunRecordBufferSnapshotEntry,
  RunRecordsTestHookRegistry,
  RunRecordsTestHooks,
} from "../types/persistence.js";
import { RUN_RECORDS_TEST_HOOKS } from "../types/persistence.js";

type PersistenceModule = typeof import("../../../src/records/persistence.js");
type TestHookControllerModule =
  typeof import("../../../src/testing/test-hooks.js");

type ReadRunRecordsFn = PersistenceModule["readRunRecords"];

let testHookRegistrationOptedIn = false;
let runRecordHooksRegistered = false;

function ensureTestHookRegistration(): void {
  if (testHookRegistrationOptedIn) {
    return;
  }
  const controller: TestHookControllerModule = jest.requireActual(
    "../../../src/testing/test-hooks.js",
  );
  controller.enableTestHookRegistration();
  testHookRegistrationOptedIn = true;
}

function ensureRunRecordHooksRegistered(): void {
  if (runRecordHooksRegistered) {
    return;
  }
  const persistenceModule: PersistenceModule = jest.requireActual(
    "../../../src/records/persistence.js",
  );
  if (typeof persistenceModule.enableRunRecordsTestHooks !== "function") {
    throw new Error(
      "Run records test hooks cannot be enabled in this build; update the helper opt-in sequence.",
    );
  }
  persistenceModule.enableRunRecordsTestHooks();
  runRecordHooksRegistered = true;
}

function getRunRecordsTestHooks(): RunRecordsTestHooks {
  ensureTestHookRegistration();
  ensureRunRecordHooksRegistered();
  const hooks = (globalThis as RunRecordsTestHookRegistry)[
    RUN_RECORDS_TEST_HOOKS
  ];

  if (!hooks) {
    throw new Error(
      "Run records test hooks are unavailable; call enableRunRecordsTestHooks() before accessing helpers.",
    );
  }

  return hooks;
}

export function setReadRunRecordsImplementation(
  implementation: ReadRunRecordsFn,
): void {
  getRunRecordsTestHooks().setImplementation(implementation);
}

export function resetReadRunRecordsImplementation(): void {
  getRunRecordsTestHooks().resetImplementation();
}

export function snapshotRunRecordBuffers(): RunRecordBufferSnapshotEntry[] {
  return getRunRecordsTestHooks().getBufferSnapshot();
}
