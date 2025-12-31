import {
  formatAlertMessage,
  formatCliOutput,
  formatErrorMessage,
} from "../utils/output.js";

export function writeCommandPreface(preface: string): void {
  process.stdout.write(`\n${preface}\n`);
}

export type AlertSeverity = "info" | "warn" | "error";

export interface Alert {
  readonly severity: AlertSeverity;
  readonly message: string;
}

export interface CommandOutputPayload {
  readonly body?: string | readonly string[];
  readonly alerts?: readonly Alert[];
  readonly stderr?: string | readonly string[];
  readonly exitCode?: number;
}

export function writeCommandOutput(payload: CommandOutputPayload): void {
  const hasAlerts = (payload.alerts ?? []).length > 0;
  if (hasAlerts) {
    process.stdout.write("\n");
  }

  renderCommandOutput(payload);
}

export function renderCommandOutput(payload: CommandOutputPayload): void {
  const alerts = payload.alerts ?? [];
  for (const alert of alerts) {
    const formattedAlert = formatAlert(alert);
    if (alert.severity === "info") {
      process.stdout.write(formattedAlert);
    } else {
      process.stderr.write(formattedAlert);
    }
  }

  const stderr = normalizeToArray(payload.stderr);
  for (const entry of stderr) {
    process.stderr.write(entry);
  }

  const body = payload.body;
  if (body !== undefined) {
    const normalizedBody = typeof body === "string" ? body : body.join("\n");
    if (normalizedBody.trim().length > 0) {
      const formattedBody = formatCliOutput(normalizedBody);
      process.stdout.write(formattedBody);
    }
  }

  if (typeof payload.exitCode === "number") {
    process.exitCode = payload.exitCode;
  }
}

function formatAlert(alert: Alert): string {
  let formatted: string;

  switch (alert.severity) {
    case "error":
      formatted = formatErrorMessage(alert.message);
      break;
    case "warn":
      formatted = formatAlertMessage("Warning", "yellow", alert.message);
      break;
    case "info":
      formatted = alert.message;
      break;
  }

  return `${formatted}\n`;
}

function normalizeToArray(
  value: string | readonly string[] | undefined,
): readonly string[] {
  if (value === undefined) {
    return [] as const;
  }
  if (typeof value === "string") {
    return [value] as const;
  }
  return value;
}
