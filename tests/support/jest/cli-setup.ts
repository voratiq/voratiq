let originalExitCode: typeof process.exitCode;

beforeEach(() => {
  originalExitCode = process.exitCode;
});

afterEach(() => {
  process.exitCode = originalExitCode ?? undefined;
});
