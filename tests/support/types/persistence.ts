/**
 * Test-only re-export of persistence types from src/domain/run/persistence/adapter.ts.
 * Import from here rather than re-declaring record shapes in tests to reduce
 * drift risk when schemas change.
 */
export type {
  RunIndexEntry,
  RunIndexPayload,
  RunRecordBufferSnapshotEntry,
  RunRecordsTestHookRegistry,
  RunRecordsTestHooks,
} from "../../../src/domain/run/persistence/adapter.js";
export { RUN_RECORDS_TEST_HOOKS } from "../../../src/domain/run/persistence/adapter.js";
