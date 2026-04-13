import { Command } from "commander";

import {
  type DoctorFixMode,
  executeDoctorDiagnosis,
  executeDoctorFix,
  resolveDoctorFixMode,
} from "../commands/doctor/command.js";
import { resolveCliContext } from "../preflight/index.js";
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

  if (options.fix) {
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

      const result = await executeDoctorFix({
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
      return {
        body: renderDoctorFixBody(result),
        exitCode: 0,
      };
    } finally {
      confirmation.close();
    }
  }

  const diagnosis = await executeDoctorDiagnosis({ root });
  if (diagnosis.healthy) {
    return {
      body: "healthy",
      exitCode: 0,
    };
  }

  return {
    body: [
      "issues found",
      ...diagnosis.issueLines,
      "",
      "next: `voratiq doctor --fix`",
    ].join("\n"),
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

function renderDoctorFixBody(result: {
  mode: DoctorFixMode;
  reconcileResult?: {
    orchestrationSummary: { skippedCustomized: boolean };
  };
}): string {
  const lines = ["Repair complete."];

  if (result.mode === "repair-and-reconcile") {
    if (result.reconcileResult?.orchestrationSummary.skippedCustomized) {
      lines.push(
        "`orchestration.yaml` is customized; managed config was left unchanged.",
      );
    }
  }

  return lines.join("\n");
}
