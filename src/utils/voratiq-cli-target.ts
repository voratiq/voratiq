import { realpathSync } from "node:fs";
import process from "node:process";

import { detectBinary } from "./binaries.js";

export interface VoratiqCliTarget {
  command: string;
  argsPrefix: string[];
}

export function createEntrypointVoratiqCliTarget(input: {
  cliEntrypoint: string | undefined;
  nodeExecutable?: string;
}): VoratiqCliTarget | undefined {
  const { cliEntrypoint, nodeExecutable = process.execPath } = input;
  if (!cliEntrypoint || cliEntrypoint.length === 0) {
    return undefined;
  }

  const executableScriptEntrypoint = resolveNodeScriptEntrypoint(cliEntrypoint);
  if (!executableScriptEntrypoint) {
    return {
      command: cliEntrypoint,
      argsPrefix: [],
    };
  }

  return {
    command: nodeExecutable,
    argsPrefix: [executableScriptEntrypoint],
  };
}

export function resolveVoratiqCliTarget(): VoratiqCliTarget {
  const installedBinary = detectBinary("voratiq");
  if (installedBinary) {
    const executableScriptEntrypoint =
      resolveNodeScriptEntrypoint(installedBinary);
    if (executableScriptEntrypoint) {
      return {
        command: process.execPath,
        argsPrefix: [executableScriptEntrypoint],
      };
    }
    return {
      command: installedBinary,
      argsPrefix: [],
    };
  }

  return {
    command: "voratiq",
    argsPrefix: [],
  };
}

function isNodeScriptEntrypoint(path: string): boolean {
  return path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs");
}

function resolveNodeScriptEntrypoint(path: string): string | undefined {
  if (isNodeScriptEntrypoint(path)) {
    return path;
  }

  try {
    const resolved = realpathSync(path);
    if (isNodeScriptEntrypoint(resolved)) {
      return resolved;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
