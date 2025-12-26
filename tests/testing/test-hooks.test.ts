const RUN_RECORDS_TEST_HOOKS = Symbol.for(
  "voratiq.records.persistence.testHooks",
);
const SANDBOX_LOADER_TEST_HOOKS = Symbol.for(
  "voratiq.configs.sandbox.loader.testHooks",
);

type HookRegistry = Record<symbol, unknown>;

describe("test hook opt-in: run records persistence", () => {
  beforeEach(() => {
    delete (globalThis as HookRegistry)[RUN_RECORDS_TEST_HOOKS];
    jest.resetModules();
  });
  afterEach(() => {
    delete (globalThis as HookRegistry)[RUN_RECORDS_TEST_HOOKS];
  });

  it("does not register hooks until tests opt in", async () => {
    await import("../../src/runs/records/persistence.js");
    expect(
      (globalThis as HookRegistry)[RUN_RECORDS_TEST_HOOKS],
    ).toBeUndefined();
  });

  it("requires enabling the shared test hook guard before registration", async () => {
    const persistence = await import("../../src/runs/records/persistence.js");
    expect(() => persistence.enableRunRecordsTestHooks()).toThrow(
      /enableTestHookRegistration/,
    );
  });

  it("registers hooks once tests explicitly opt in", async () => {
    const persistence = await import("../../src/runs/records/persistence.js");
    const testHooks = await import("../../src/testing/test-hooks.js");
    testHooks.enableTestHookRegistration();
    persistence.enableRunRecordsTestHooks();
    expect((globalThis as HookRegistry)[RUN_RECORDS_TEST_HOOKS]).toBeDefined();
  });
});

describe("test hook opt-in: sandbox loader", () => {
  beforeEach(() => {
    delete (globalThis as HookRegistry)[SANDBOX_LOADER_TEST_HOOKS];
    jest.resetModules();
  });
  afterEach(() => {
    delete (globalThis as HookRegistry)[SANDBOX_LOADER_TEST_HOOKS];
  });

  it("does not register hooks until tests opt in", async () => {
    await import("../../src/configs/sandbox/loader.js");
    expect(
      (globalThis as HookRegistry)[SANDBOX_LOADER_TEST_HOOKS],
    ).toBeUndefined();
  });

  it("requires enabling the shared guard before registration", async () => {
    const loader = await import("../../src/configs/sandbox/loader.js");
    expect(() => loader.enableSandboxLoaderTestHooks()).toThrow(
      /enableTestHookRegistration/,
    );
  });

  it("registers hooks once tests explicitly opt in", async () => {
    const loader = await import("../../src/configs/sandbox/loader.js");
    const testHooks = await import("../../src/testing/test-hooks.js");
    testHooks.enableTestHookRegistration();
    loader.enableSandboxLoaderTestHooks();
    expect(
      (globalThis as HookRegistry)[SANDBOX_LOADER_TEST_HOOKS],
    ).toBeDefined();
  });
});
