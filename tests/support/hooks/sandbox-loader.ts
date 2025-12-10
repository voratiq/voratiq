/**
 * Opts into sandbox loader test hooks explicitly so production builds never
 * register globals. Helpers call the opt-in functions on first use.
 */
import type {
  LoadSandboxNetworkConfigOptions,
  SandboxNetworkConfig,
} from "../../../src/configs/sandbox/loader.js";
type SandboxLoaderModule =
  typeof import("../../../src/configs/sandbox/loader.js");
type TestHookControllerModule =
  typeof import("../../../src/testing/test-hooks.js");

const SANDBOX_LOADER_TEST_HOOKS = Symbol.for(
  "voratiq.configs.sandbox.loader.testHooks",
);

type SandboxLoaderTestHooks = {
  clearCache: () => void;
  loadNetworkConfig: (
    options: LoadSandboxNetworkConfigOptions,
  ) => SandboxNetworkConfig;
};

type SandboxLoaderTestHookRegistry = Partial<
  Record<typeof SANDBOX_LOADER_TEST_HOOKS, SandboxLoaderTestHooks>
>;

let testHookRegistrationOptedIn = false;
let sandboxLoaderHooksRegistered = false;

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

function ensureSandboxLoaderHooksRegistered(): void {
  if (sandboxLoaderHooksRegistered) {
    return;
  }
  const loaderModule: SandboxLoaderModule = jest.requireActual(
    "../../../src/configs/sandbox/loader.js",
  );
  if (typeof loaderModule.enableSandboxLoaderTestHooks !== "function") {
    throw new Error(
      "Sandbox loader test hooks cannot be enabled in this build; update the helper opt-in sequence.",
    );
  }
  loaderModule.enableSandboxLoaderTestHooks();
  sandboxLoaderHooksRegistered = true;
}

function getSandboxLoaderTestHooks(): SandboxLoaderTestHooks {
  ensureTestHookRegistration();
  ensureSandboxLoaderHooksRegistered();
  const hooks = (globalThis as SandboxLoaderTestHookRegistry)[
    SANDBOX_LOADER_TEST_HOOKS
  ];

  if (!hooks) {
    throw new Error(
      "Sandbox loader test hooks are unavailable; call enableSandboxLoaderTestHooks() before accessing helpers.",
    );
  }

  return hooks;
}

export function clearSandboxConfigurationCache(): void {
  getSandboxLoaderTestHooks().clearCache();
}

export function loadSandboxNetworkConfig(
  options: LoadSandboxNetworkConfigOptions,
): SandboxNetworkConfig {
  return getSandboxLoaderTestHooks().loadNetworkConfig(options);
}
