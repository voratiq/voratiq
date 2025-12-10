import eslintJs from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import eslintPluginJest from "eslint-plugin-jest";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";

const tsRecommended = tseslint.configs["recommended-type-checked"];
const jestRecommended =
  eslintPluginJest.configs["flat/recommended"] ??
  eslintPluginJest.configs.recommended;

/**
 * @param {{ files: string[]; project: string; includeJest: boolean }} options
 */
const createTsConfig = ({ files, project, includeJest }) => ({
  files,
  ignores: ["dist/**", "node_modules/**", ".voratiq/**", ".internal/**"],
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      project,
      tsconfigRootDir: import.meta.dirname,
    },
    globals: {
      ...globals.nodeBuiltin,
      NodeJS: "readonly",
      ...(includeJest ? globals.jest : {}),
    },
  },
  plugins: {
    "@typescript-eslint": tseslint,
    "simple-import-sort": simpleImportSort,
    ...(includeJest ? { jest: eslintPluginJest } : {}),
  },
  rules: {
    ...eslintJs.configs.recommended.rules,
    ...(tsRecommended?.rules ?? {}),
    ...(includeJest && jestRecommended ? jestRecommended.rules : {}),
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/no-floating-promises": "error",
    "simple-import-sort/imports": "error",
    "simple-import-sort/exports": "error",
    ...(includeJest
      ? {
          "jest/no-disabled-tests": "warn",
          "jest/no-focused-tests": "error",
        }
      : {}),
  },
});

export default [
  {
    ignores: ["dist/**", "node_modules/**", ".voratiq/**", ".internal/**"],
  },
  createTsConfig({
    files: ["src/**/*.ts"],
    project: "./tsconfig.json",
    includeJest: false,
  }),
  createTsConfig({
    files: ["tests/**/*.ts"],
    project: "./tsconfig.jest.json",
    includeJest: true,
  }),
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    ignores: ["dist/**", "node_modules/**"],
    languageOptions: {
      globals: {
        ...globals.nodeBuiltin,
        NodeJS: "readonly",
      },
    },
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      ...eslintJs.configs.recommended.rules,
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  {
    files: ["jest.config.js"],
    languageOptions: {
      globals: globals.nodeBuiltin,
    },
    rules: {
      ...eslintJs.configs.recommended.rules,
    },
    settings: {
      jest: {
        version: 30,
      },
    },
  },
];
