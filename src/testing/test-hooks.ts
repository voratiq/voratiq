let testHookRegistrationEnabled = false;

/**
 * Explicit opt-in for test-only global hooks. Calling this keeps production
 * bundles clean while giving Jest helpers a single switch to flip.
 */
export function enableTestHookRegistration(): void {
  testHookRegistrationEnabled = true;
}

export function isTestHookRegistrationEnabled(): boolean {
  return testHookRegistrationEnabled;
}

export function assertTestHookRegistrationEnabled(feature: string): void {
  if (!testHookRegistrationEnabled) {
    throw new Error(
      `Test hooks for ${feature} are unavailable. Call enableTestHookRegistration() before accessing ${feature} helpers.`,
    );
  }
}
