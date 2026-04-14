import { Command } from "commander";

import { CliError } from "../cli/errors.js";
import {
  type DoctorFixMode,
  executeDoctorDiagnosis,
  executeDoctorFix,
  resolveDoctorFixMode,
} from "../commands/doctor/command.js";
import { PREFLIGHT_HINT } from "../competition/shared/preflight.js";
import { resolveCliContext } from "../preflight/index.js";
import { renderCliError } from "../render/utils/errors.js";
import { colorize } from "../utils/colors.js";
import { isInteractiveShell } from "../utils/terminal.js";
import { createConfirmationWorkflow } from "./confirmation.js";
import { NonInteractiveShellError } from "./errors.js";
import { type CommandOutputWriter, writeCommandOutput } from "./output.js";

export interface DoctorCommandOptions {
  fix?: boolean;
  writeOutput?: CommandOutputWriter;
}

export interface RunDoctorCommandResult {
  body: string;
  exitCode: number;
}

export async function runDoctorCommand(
  options: DoctorCommandOptions = {},
): Promise<RunDoctorCommandResult> {
  const { writeOutput = writeCommandOutput } = options;
  const { root } = await resolveCliContext({ requireWorkspace: false });
  const diagnosis = await executeDoctorDiagnosis({ root });

  if (options.fix) {
    if (diagnosis.healthy) {
      return {
        body: renderHealthyDoctorBody(),
        exitCode: 0,
      };
    }

    const assumeYes = !isInteractiveShell();
    const confirmation = createConfirmationWorkflow({
      assumeYes,
      onUnavailable: () => {
        throw new NonInteractiveShellError();
      },
    });

    try {
      const mode = await resolveDoctorFixMode(root);
      writeOutput({
        alerts: [
          {
            severity: "info",
            message: renderDoctorFixPathMessage(mode),
          },
        ],
      });

      await executeDoctorFix({
        root,
        mode,
        bootstrapOptions: {
          preset: "pro",
          interactive: confirmation.interactive,
          assumeYes,
          confirm: confirmation.confirm,
          prompt: confirmation.prompt,
        },
      });
      const postFixDiagnosis = await executeDoctorDiagnosis({ root });
      if (postFixDiagnosis.healthy) {
        return {
          body: renderHealthyDoctorBody(),
          exitCode: 0,
        };
      }

      return {
        body: renderDoctorIssues(postFixDiagnosis),
        exitCode: 1,
      };
    } finally {
      confirmation.close();
    }
  }

  if (diagnosis.healthy) {
    return {
      body: renderHealthyDoctorBody(),
      exitCode: 0,
    };
  }

  return {
    body: renderDoctorIssues(diagnosis),
    exitCode: 1,
  };
}

interface DoctorCommandActionOptions {
  fix?: boolean;
}

export function createDoctorCommand(): Command {
  return new Command("doctor")
    .description("Diagnose workspace and preflight setup issues")
    .option("--fix", "Apply safe workspace and managed-config repairs")
    .allowExcessArguments(false)
    .action(async (options: DoctorCommandActionOptions) => {
      const result = await runDoctorCommand({
        fix: Boolean(options.fix),
      });
      writeCommandOutput({
        body: result.body,
        exitCode: result.exitCode,
      });
    });
}

function renderDoctorFixPathMessage(mode: DoctorFixMode): string {
  if (mode === "bootstrap-workspace") {
    return "Workspace missing. This will bootstrap workspace and managed config.";
  }

  return "Workspace found. This will repair structure and reconcile managed config.";
}

function renderHealthyDoctorBody(): string {
  return [
    colorize("Workspace healthy, no issues found.", "green"),
    "",
    "Still having issues? Please reach out to support@voratiq.com.",
  ].join("\n");
}

function renderDoctorIssues(diagnosis: {
  issueLines: readonly string[];
}): string {
  const detailLines =
    diagnosis.issueLines.length > 1 ? diagnosis.issueLines : [];
  const headline =
    diagnosis.issueLines.length === 1
      ? stripDoctorIssuePrefix(
          diagnosis.issueLines[0] ?? "Workspace check failed.",
        )
      : "Workspace check failed.";

  return renderCliError(new CliError(headline, detailLines, [PREFLIGHT_HINT]));
}

function stripDoctorIssuePrefix(line: string): string {
  return line.replace(/^- /u, "").trim();
}
