import { join } from "node:path";

import type { VerificationConfig } from "../../configs/verification/types.js";
import { HintedError } from "../../utils/errors.js";
import { isDirectory, isFile } from "../../utils/fs.js";
import { VORATIQ_VERIFICATION_TEMPLATES_DIR } from "../../workspace/constants.js";
import { formatWorkspacePath } from "../../workspace/path-formatters.js";
import { resolveWorkspacePath } from "../../workspace/path-resolvers.js";
import { AutoPreflightError } from "./errors.js";

interface RequiredAutoSelector {
  stage: "spec" | "run";
  template: "spec-verification" | "run-verification";
}

interface AutoSelectorValidationCommandInput {
  description?: string;
  specPath?: string;
  apply?: boolean;
  commit?: boolean;
}

type AutoPreflightIssue =
  | {
      kind: "missing-config-entry";
      stage: "spec" | "run";
      template: "spec-verification" | "run-verification";
    }
  | {
      kind: "missing-template";
      stage: "spec" | "run";
      template: "spec-verification" | "run-verification";
      templatePath: string;
    }
  | {
      kind: "incomplete-template";
      stage: "spec" | "run";
      template: "spec-verification" | "run-verification";
      templatePath: string;
      missingFiles: readonly string[];
    };

export async function validateAutoVerificationConfig(options: {
  root: string;
  command: AutoSelectorValidationCommandInput;
  verificationConfig: VerificationConfig;
}): Promise<void> {
  const requiredSelectors = resolveRequiredAutoSelectors(options.command);
  const issues: AutoPreflightIssue[] = [];

  for (const requirement of requiredSelectors) {
    if (!hasSelectorTemplate(options.verificationConfig, requirement)) {
      issues.push({
        kind: "missing-config-entry",
        stage: requirement.stage,
        template: requirement.template,
      });
      continue;
    }

    const templateIssue = await resolveTemplateIssue(options.root, requirement);
    if (templateIssue) {
      issues.push(templateIssue);
    }
  }

  if (issues.length > 0) {
    throw new AutoPreflightError(issues);
  }
}

export function validateAutoCommandOptions(
  options: AutoSelectorValidationCommandInput,
): void {
  const hasSpecPath =
    typeof options.specPath === "string" && options.specPath.trim().length > 0;
  const hasDescription =
    typeof options.description === "string" &&
    options.description.trim().length > 0;

  if (hasSpecPath === hasDescription) {
    throw new HintedError(
      "Exactly one of `--spec` or `--description` is required.",
      {
        hintLines: ["Pass exactly one."],
      },
    );
  }

  if (options.commit && !options.apply) {
    throw new HintedError("Option `--commit` requires `--apply`.", {
      hintLines: ["Add `--apply` when using `--commit`."],
    });
  }
}

function resolveRequiredAutoSelectors(
  command: AutoSelectorValidationCommandInput,
): RequiredAutoSelector[] {
  if (
    typeof command.description === "string" &&
    command.description.trim().length > 0
  ) {
    return [
      { stage: "spec", template: "spec-verification" },
      { stage: "run", template: "run-verification" },
    ];
  }

  if (
    typeof command.specPath === "string" &&
    command.specPath.trim().length > 0
  ) {
    return [{ stage: "run", template: "run-verification" }];
  }

  return [];
}

function hasSelectorTemplate(
  verificationConfig: VerificationConfig,
  requirement: RequiredAutoSelector,
): boolean {
  const stageRubrics =
    requirement.stage === "spec"
      ? verificationConfig.spec.rubric
      : verificationConfig.run.rubric;

  return stageRubrics.some(
    (rubric) => rubric.template === requirement.template,
  );
}

async function resolveTemplateIssue(
  root: string,
  requirement: RequiredAutoSelector,
): Promise<AutoPreflightIssue | undefined> {
  const templateRoot = resolveWorkspacePath(
    root,
    join(VORATIQ_VERIFICATION_TEMPLATES_DIR, requirement.template),
  );
  const templatePath = formatWorkspacePath(
    VORATIQ_VERIFICATION_TEMPLATES_DIR,
    requirement.template,
  );

  if (!(await isDirectory(templateRoot))) {
    return {
      kind: "missing-template",
      stage: requirement.stage,
      template: requirement.template,
      templatePath,
    };
  }

  const requiredFiles = ["prompt.md", "rubric.md", "schema.yaml"] as const;
  const missingFiles: string[] = [];

  for (const file of requiredFiles) {
    if (!(await isFile(join(templateRoot, file)))) {
      missingFiles.push(file);
    }
  }

  if (missingFiles.length === 0) {
    return undefined;
  }

  return {
    kind: "incomplete-template",
    stage: requirement.stage,
    template: requirement.template,
    templatePath,
    missingFiles,
  };
}
