import { CliError } from "../../cli/errors.js";

export class AutoPreflightError extends CliError {
  constructor(
    issues: ReadonlyArray<
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
        }
    >,
  ) {
    const detailLines = issues.map((issue) => {
      switch (issue.kind) {
        case "missing-config-entry":
          return `Missing selector rubric \`${issue.template}\` in \`.voratiq/verification.yaml\` for ${issue.stage}-stage auto resolution.`;
        case "missing-template":
          return `Missing selector template \`${issue.templatePath}/\` for ${issue.stage}-stage auto resolution.`;
        case "incomplete-template":
          return `Incomplete selector template \`${issue.templatePath}/\` for ${issue.stage}-stage auto resolution; missing ${issue.missingFiles.map((file) => `\`${file}\``).join(", ")}.`;
      }
    });

    super("Preflight failed. Aborting auto.", detailLines, [
      "Run `voratiq init` from the repository root, then retry.",
    ]);
    this.name = "AutoPreflightError";
  }
}
