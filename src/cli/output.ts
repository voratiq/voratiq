import {
  formatAlertMessage,
  formatCliOutput,
  type FormatCliOutputOptions,
  formatErrorMessage,
} from "../utils/output.js";

export function writeCommandPreface(preface: string): void {
  process.stdout.write(`\n${preface}\n`);
}

type CliWriter = Pick<NodeJS.WriteStream, "write"> & { isTTY?: boolean };

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
  readonly formatBody?: FormatCliOutputOptions;
  readonly leadingNewline?: boolean;
}

export type CommandOutputWriter = (payload: CommandOutputPayload) => void;

interface ChainedOutputState {
  stdoutTrailingNewlines: number;
  stdoutHasOutput: boolean;
}

let chainedOutputState: ChainedOutputState | null = null;

export interface ChainedCommandOutput {
  stdout: CliWriter;
  stderr: CliWriter;
  end(): void;
}

export function beginChainedCommandOutput(): ChainedCommandOutput {
  const state: ChainedOutputState = {
    stdoutTrailingNewlines: 0,
    stdoutHasOutput: false,
  };

  chainedOutputState = state;

  return {
    stdout: createTrackingWriter(process.stdout, state),
    stderr: process.stderr,
    end: () => {
      if (chainedOutputState === state) {
        chainedOutputState = null;
      }
    },
  };
}

export function writeCommandOutput(payload: CommandOutputPayload): void {
  if (chainedOutputState) {
    writeChainedCommandOutput(payload, chainedOutputState);
    return;
  }

  const hasAlerts = (payload.alerts ?? []).length > 0;
  const shouldInsertLeadingNewline = payload.leadingNewline ?? hasAlerts;

  if (shouldInsertLeadingNewline) {
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
      const formattedBody = formatCliOutput(normalizedBody, payload.formatBody);
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

function writeChainedCommandOutput(
  payload: CommandOutputPayload,
  state: ChainedOutputState,
): void {
  const alerts = payload.alerts ?? [];
  const stdoutParts: string[] = [];

  let hasStdoutAlert = false;
  for (const alert of alerts) {
    const formattedAlert = formatAlert(alert);
    if (alert.severity === "info") {
      stdoutParts.push(formattedAlert);
      hasStdoutAlert = true;
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
      if (hasStdoutAlert) {
        stdoutParts.push("\n");
      }
      const formattedBody = formatCliOutput(normalizedBody, {
        leadingNewline: false,
        trailingNewline: typeof payload.exitCode === "number",
      });
      stdoutParts.push(formattedBody);
    }
  }

  let stdoutChunk = normalizeChainedChunk(stdoutParts.join(""));
  if (stdoutChunk.length > 0 && typeof payload.exitCode === "number") {
    stdoutChunk = `${stdoutChunk}\n`;
  }
  if (stdoutChunk.length > 0) {
    writeChainedStdout(stdoutChunk, state);
  }

  if (typeof payload.exitCode === "number") {
    process.exitCode = payload.exitCode;
  }
}

function normalizeChainedChunk(value: string): string {
  if (value.length === 0) {
    return "";
  }

  const trimmedLeading = value.replace(/^\n+/, "");
  const trimmed = trimmedLeading.replace(/\n+$/, "");

  if (trimmed.length === 0) {
    return "";
  }

  return `${trimmed}\n`;
}

function writeChainedStdout(value: string, state: ChainedOutputState): void {
  const prefix = getChainedPrefix(state);
  if (prefix) {
    process.stdout.write(prefix);
    updateTrailingNewlines(state, prefix);
    state.stdoutHasOutput = true;
  }

  process.stdout.write(value);
  updateTrailingNewlines(state, value);
  state.stdoutHasOutput = true;
}

function getChainedPrefix(state: ChainedOutputState): string {
  if (!state.stdoutHasOutput) {
    return "\n";
  }

  if (state.stdoutTrailingNewlines >= 2) {
    return "";
  }

  if (state.stdoutTrailingNewlines === 1) {
    return "\n";
  }

  return "\n\n";
}

function updateTrailingNewlines(
  state: ChainedOutputState,
  value: string,
): void {
  if (value.length === 0) {
    return;
  }

  let index = value.length - 1;
  let count = 0;
  while (index >= 0 && value[index] === "\n") {
    count += 1;
    index -= 1;
  }

  if (count === value.length) {
    state.stdoutTrailingNewlines = Math.min(
      2,
      state.stdoutTrailingNewlines + count,
    );
    return;
  }

  if (count > 0) {
    state.stdoutTrailingNewlines = Math.min(2, count);
    return;
  }

  state.stdoutTrailingNewlines = 0;
}

function createTrackingWriter(
  target: CliWriter,
  state: ChainedOutputState,
): CliWriter {
  let hasWritten = false;
  return {
    isTTY: target.isTTY,
    write(chunk: string | Uint8Array): boolean {
      const text =
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      if (!hasWritten && text.length > 0) {
        hasWritten = true;
        const prefix = getChainedPrefix(state);
        if (prefix) {
          target.write(prefix as never);
          updateTrailingNewlines(state, prefix);
          state.stdoutHasOutput = true;
        }
      }

      const result = target.write(chunk as never);
      updateTrailingNewlines(state, text);
      if (text.length > 0) {
        state.stdoutHasOutput = true;
      }
      return result;
    },
  };
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
