import { colorize } from "../../utils/colors.js";

export interface RootLauncherAvailableAgentLine {
  label: string;
}

export interface RootLauncherUnavailableAgentLine {
  label: string;
  reasons: readonly string[];
}

export function renderRootLauncherSelectionScreen(options: {
  launchable: readonly RootLauncherAvailableAgentLine[];
  unavailable: readonly RootLauncherUnavailableAgentLine[];
}): string {
  void options.unavailable;
  const lines = [
    "Start a native agent session from this repository.",
    "",
    "Enabled agents:",
    ...options.launchable.map(
      (agent, index) => `  ${index + 1}. ${agent.label}`,
    ),
  ];

  lines.push("", "Choose one agent to launch.");
  return lines.join("\n");
}

export function renderRootLauncherSingleAgentScreen(options: {
  selected: string;
  unavailable: readonly RootLauncherUnavailableAgentLine[];
}): string {
  void options.unavailable;
  const lines = ["Start a native agent session from this repository.", ""];

  lines.push(`Using agent: ${options.selected}`);
  return lines.join("\n");
}

export function renderRootLauncherInvalidSelection(max: number): string {
  return `Choose a number from 1 to ${max}.`;
}

export function renderRootLauncherMcpInstallSuccess(): string {
  return colorize("Success!", "green");
}

export function renderRootLauncherMcpInstallStart(): string {
  return "Installing Voratiq MCP...";
}

export function renderRootLauncherLaunchStart(label: string): string {
  return `Launching ${label}...`;
}
