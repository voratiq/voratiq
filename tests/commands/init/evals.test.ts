import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configureEvals } from "../../../src/commands/init/evals.js";
import type { EnvironmentConfig } from "../../../src/configs/environment/types.js";
import { readEvalsConfig } from "../../../src/configs/evals/loader.js";
import type {
  EvalsConfig,
  EvalSlug,
} from "../../../src/configs/evals/types.js";
import type { ConfirmationOptions } from "../../../src/render/interactions/confirmation.js";
import { buildDefaultEvalsTemplate } from "../../../src/workspace/templates.js";

describe("configureEvals", () => {
  let repoRoot: string;
  const nodeEnvironment: EnvironmentConfig = {
    node: { dependencyRoots: [] },
  };
  const pythonEnvironment: EnvironmentConfig = {
    python: { path: ".venv" },
  };
  const mixedEnvironment: EnvironmentConfig = {
    node: { dependencyRoots: [] },
    python: { path: ".venv" },
  };

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "voratiq-evals-"));
    await mkdir(join(repoRoot, ".voratiq"), { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("applies node suggestions during non-interactive runs", async () => {
    await writeDefaultEvalsConfig(repoRoot);
    await writePackageJson(repoRoot, {
      scripts: {
        "format:check": "prettier --check .",
        lint: "eslint .",
        test: "jest",
      },
      devDependencies: {
        typescript: "^5.0.0",
      },
    });
    await writeFile(join(repoRoot, "tsconfig.typecheck.json"), "{}", "utf8");

    const summary = await configureEvals(
      repoRoot,
      { interactive: false },
      nodeEnvironment,
    );

    expect(summary.configuredEvals).toEqual([
      "format",
      "lint",
      "typecheck",
      "tests",
    ]);
    expect(summary.configUpdated).toBe(true);

    const content = await readFile(
      join(repoRoot, ".voratiq", "evals.yaml"),
      "utf8",
    );
    expect(content.trim()).toBe(
      [
        'format: "npm run format:check"',
        'lint: "npm run lint"',
        'typecheck: "npx tsc --project tsconfig.typecheck.json --noEmit"',
        'tests: "npm run test"',
      ].join("\n"),
    );

    const config = readEvalsConfig(content);
    expect(getCommand(config, "format")).toBe("npm run format:check");
    expect(getCommand(config, "lint")).toBe("npm run lint");
    expect(getCommand(config, "typecheck")).toBe(
      "npx tsc --project tsconfig.typecheck.json --noEmit",
    );
    expect(getCommand(config, "tests")).toBe("npm run test");
  });

  it("respects interactive declines for detected commands", async () => {
    await writeDefaultEvalsConfig(repoRoot);
    await writePackageJson(repoRoot, {
      scripts: {
        lint: "eslint .",
      },
    });
    const confirm = jest.fn<Promise<boolean>, [ConfirmationOptions]>(() =>
      Promise.resolve(false),
    );

    const summary = await configureEvals(
      repoRoot,
      { interactive: true, confirm },
      nodeEnvironment,
    );

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(summary.configuredEvals).toEqual([]);
    expect(summary.configUpdated).toBe(false);

    const updated = await readFile(
      join(repoRoot, ".voratiq", "evals.yaml"),
      "utf8",
    );
    expect(updated.trim()).toBe(buildDefaultEvalsTemplate().trim());

    const config = readEvalsConfig(updated);
    expect(getCommand(config, "format")).toBeUndefined();
    expect(getCommand(config, "lint")).toBeUndefined();
    expect(getCommand(config, "typecheck")).toBeUndefined();
    expect(getCommand(config, "tests")).toBeUndefined();
  });

  it("applies python suggestions when accepted", async () => {
    await writeDefaultEvalsConfig(repoRoot);
    await writeFile(join(repoRoot, "poetry.lock"), "", "utf8");
    await writeFile(
      join(repoRoot, "pyproject.toml"),
      [
        "[tool.poetry.dependencies]",
        'python = "^3.11"',
        'ruff = "^0.5.0"',
        'pytest = "^8.0.0"',
        'pyright = "^1.1.0"',
      ].join("\n"),
      "utf8",
    );

    const confirm = jest.fn<Promise<boolean>, [ConfirmationOptions]>(() =>
      Promise.resolve(true),
    );

    const summary = await configureEvals(
      repoRoot,
      { interactive: true, confirm },
      pythonEnvironment,
    );

    expect(summary.configuredEvals).toEqual([
      "format",
      "lint",
      "typecheck",
      "tests",
    ]);
    expect(summary.configUpdated).toBe(true);

    const content = await readFile(
      join(repoRoot, ".voratiq", "evals.yaml"),
      "utf8",
    );
    expect(content.trim()).toBe(
      [
        'format: "uv run ruff format --check"',
        'lint: "uv run ruff check"',
        'typecheck: "uv run pyright"',
        'tests: "uv run pytest"',
      ].join("\n"),
    );

    const config = readEvalsConfig(content);
    expect(getCommand(config, "format")).toBe("uv run ruff format --check");
    expect(getCommand(config, "lint")).toBe("uv run ruff check");
    expect(getCommand(config, "typecheck")).toBe("uv run pyright");
    expect(getCommand(config, "tests")).toBe("uv run pytest");
  });

  it("prompts for node suggestions before python suggestions in mixed stacks", async () => {
    await writeDefaultEvalsConfig(repoRoot);
    await writePackageJson(repoRoot, {
      scripts: {
        lint: "eslint .",
      },
    });
    await writeFile(join(repoRoot, "poetry.lock"), "", "utf8");
    await writeFile(
      join(repoRoot, "pyproject.toml"),
      '[tool.poetry.dependencies]\npytest = "^8.0.0"',
      "utf8",
    );

    const order: string[] = [];
    const confirm = jest.fn<Promise<boolean>, [ConfirmationOptions]>((opts) => {
      order.push(opts.prefaceLines?.join("\n") ?? "");
      return Promise.resolve(false);
    });

    await configureEvals(
      repoRoot,
      { interactive: true, confirm },
      mixedEnvironment,
    );

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(order[0]).toContain("`lint` command detected: `npm run lint`");
    expect(order[0]).toContain("Configuring evals…");
    expect(order[1]).toContain("`tests` command detected: `uv run pytest`");
  });

  it("skips suggestions when the relevant environment is disabled", async () => {
    await writeDefaultEvalsConfig(repoRoot);
    await writePackageJson(repoRoot, {
      scripts: {
        lint: "eslint .",
      },
    });

    const summary = await configureEvals(
      repoRoot,
      { interactive: false },
      { node: false },
    );

    expect(summary.configuredEvals).toEqual([]);
    expect(summary.configUpdated).toBe(false);
  });
});

async function writeDefaultEvalsConfig(root: string): Promise<void> {
  const configPath = join(root, ".voratiq", "evals.yaml");
  const template = buildDefaultEvalsTemplate();
  await writeFile(configPath, template, "utf8");
}

async function writePackageJson(
  root: string,
  options: {
    scripts: Record<string, string>;
    devDependencies?: Record<string, string>;
  },
): Promise<void> {
  const packageJsonPath = join(root, "package.json");
  const packageJson = {
    name: "test-project",
    version: "0.0.0",
    scripts: options.scripts,
    devDependencies: options.devDependencies ?? {},
  };
  await writeFile(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2),
    "utf8",
  );
}

function getCommand(config: EvalsConfig, slug: EvalSlug): string | undefined {
  return config.find((entry) => entry.slug === slug)?.command;
}
