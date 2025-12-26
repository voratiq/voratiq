/** @type {import('jest').Config} */
const tsJestTransformer = "ts-jest";
const runningInWorkspace = process.env.VORATIQ_WORKSPACE_TESTS === "1";

const runsIgnorePattern = String.raw`/\.voratiq/runs/`;
const scratchIgnorePattern = String.raw`/\.internal/scratch/`;
const workspaceIgnorePatterns = runningInWorkspace ? [] : [runsIgnorePattern];
const sharedIgnorePatterns = runningInWorkspace
  ? [scratchIgnorePattern]
  : [...workspaceIgnorePatterns, scratchIgnorePattern, String.raw`/\.voratiq/`];

const moduleNameMapper = {
  "^chalk$": "<rootDir>/tests/support/mocks/chalk.ts",
};

function buildTestRegex(directories) {
  const group = directories
    .map((directory) => directory.replaceAll("/", "\\/"))
    .join("|");
  return `tests/(?:${group})/.+\\.test\\.ts$`;
}

const sharedTransform = {
  [String.raw`^.+\.(t|j)sx?$`]: [
    tsJestTransformer,
    {
      tsconfig: "./tsconfig.jest.json",
      astTransformers: {
        before: ["<rootDir>/tests/transformers/import-meta-to-fileurl.cjs"],
      },
    },
  ],
};

const baseSetupFiles = ["<rootDir>/tests/support/jest/setup.ts"];
const resolverPath = "<rootDir>/tests/support/jest/resolver.cjs";

function createProject(displayName, testRegex, overrides = {}) {
  const { setupFilesAfterEnv, ...rest } = overrides;
  return {
    displayName,
    testRegex: [testRegex],
    preset: "ts-jest",
    testEnvironment: "node",
    resolver: resolverPath,
    transform: sharedTransform,
    moduleNameMapper,
    testPathIgnorePatterns: sharedIgnorePatterns,
    modulePathIgnorePatterns: sharedIgnorePatterns,
    setupFilesAfterEnv: setupFilesAfterEnv ?? baseSetupFiles,
    ...rest,
  };
}

const unitProject = createProject(
  "unit",
  String.raw`tests/(?!commands|cli)[^/]+/.+\.test\.ts$`,
);

const commandsProject = createProject(
  "commands",
  buildTestRegex(["auth", "commands"]),
);

const cliProject = createProject("cli", buildTestRegex(["cli"]), {
  setupFilesAfterEnv: [
    ...baseSetupFiles,
    "<rootDir>/tests/support/jest/cli-setup.ts",
  ],
  detectOpenHandles: true,
  maxWorkers: 1,
  testTimeout: 120_000,
});

const config = {
  watchman: false,
  passWithNoTests: false,
  collectCoverageFrom: ["<rootDir>/src/**/*.ts"],
  coverageThreshold: {
    global: {
      statements: 60,
      branches: 50,
      functions: 60,
      lines: 60,
    },
    "./src/configs/": {
      statements: 70,
      branches: 55,
      functions: 70,
      lines: 70,
    },
    "./src/preflight/": {
      statements: 70,
      branches: 60,
      functions: 70,
      lines: 70,
    },
    "./src/status/": {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80,
    },
  },
  projects: [unitProject, commandsProject, cliProject],
};

export default config;
