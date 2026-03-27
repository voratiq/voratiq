#!/usr/bin/env node

import { existsSync } from "node:fs";
import { cp, rename, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_BACKUP = true;

const DIRECTORY_MAPPINGS = [
  { from: "specs", to: "spec" },
  { from: "runs", to: "run" },
  { from: "verifications", to: "verify" },
  { from: "reductions", to: "reduce" },
];

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error(
    "Usage: node scripts/migrations/20260326-singularize-voratiq-operator-paths-v0.1.0-beta.17_to_v0.1.0-beta.18.mjs --voratiq-dir <repo/.voratiq> [--apply] [--backup|--no-backup]",
  );
  process.exit(1);
}

function parseArgs(argv = process.argv.slice(2)) {
  let voratiqDir;
  let apply = false;
  let backup = DEFAULT_BACKUP;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--voratiq-dir") {
      voratiqDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg?.startsWith("--voratiq-dir=")) {
      [, voratiqDir] = arg.split("=", 2);
      continue;
    }

    if (arg === "--apply") {
      apply = true;
      continue;
    }

    if (arg === "--backup") {
      backup = true;
      continue;
    }

    if (arg === "--no-backup") {
      backup = false;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      usage();
    }

    usage(`Unknown argument: ${arg}`);
  }

  if (!voratiqDir) {
    usage("Missing required --voratiq-dir");
  }

  return {
    apply,
    backup,
    voratiqDir: path.resolve(voratiqDir),
  };
}

async function pathKind(targetPath) {
  try {
    const stats = await stat(targetPath);
    if (stats.isDirectory()) {
      return "directory";
    }
    if (stats.isFile()) {
      return "file";
    }
    return "other";
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return "missing";
    }
    throw error;
  }
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    "-",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join("");
}

async function createBackup(voratiqDir) {
  const parent = path.dirname(voratiqDir);
  const base = `${path.basename(voratiqDir)}-backup-${timestamp()}`;
  let candidate = path.join(parent, base);
  let suffix = 0;

  while (existsSync(candidate)) {
    suffix += 1;
    candidate = path.join(parent, `${base}-${suffix}`);
  }

  await cp(voratiqDir, candidate, { recursive: true });
  return candidate;
}

async function buildPlan(voratiqDir) {
  const plannedMoves = [];
  const skipped = [];
  const conflicts = [];

  for (const mapping of DIRECTORY_MAPPINGS) {
    const fromPath = path.join(voratiqDir, mapping.from);
    const toPath = path.join(voratiqDir, mapping.to);
    const [fromKind, toKind] = await Promise.all([
      pathKind(fromPath),
      pathKind(toPath),
    ]);

    if (fromKind === "missing" && toKind === "directory") {
      skipped.push({
        from: mapping.from,
        to: mapping.to,
        reason: "already migrated",
      });
      continue;
    }

    if (fromKind === "missing" && toKind === "missing") {
      skipped.push({
        from: mapping.from,
        to: mapping.to,
        reason: "not present",
      });
      continue;
    }

    if (fromKind !== "directory") {
      conflicts.push({
        from: mapping.from,
        to: mapping.to,
        reason:
          fromKind === "missing"
            ? "unexpected destination state"
            : `source is a ${fromKind}, expected directory`,
      });
      continue;
    }

    if (toKind === "missing") {
      plannedMoves.push({
        from: mapping.from,
        fromPath,
        to: mapping.to,
        toPath,
      });
      continue;
    }

    conflicts.push({
      from: mapping.from,
      to: mapping.to,
      reason:
        toKind === "directory"
          ? "destination already exists"
          : `destination is a ${toKind}`,
    });
  }

  return { plannedMoves, skipped, conflicts };
}

function printPlan(plan, options) {
  const { apply, backup } = options;

  console.log(
    apply
      ? `Apply mode${backup ? " with backup" : " without backup"}`
      : "Dry run mode",
  );

  if (plan.plannedMoves.length > 0) {
    console.log("Planned moves:");
    for (const move of plan.plannedMoves) {
      console.log(`- ${move.from} -> ${move.to}`);
    }
  } else {
    console.log("Planned moves:");
    console.log("- none");
  }

  if (plan.skipped.length > 0) {
    console.log("Skipped:");
    for (const entry of plan.skipped) {
      console.log(`- ${entry.from} -> ${entry.to}: ${entry.reason}`);
    }
  }

  if (plan.conflicts.length > 0) {
    console.log("Conflicts:");
    for (const conflict of plan.conflicts) {
      console.log(`- ${conflict.from} -> ${conflict.to}: ${conflict.reason}`);
    }
  }
}

function printSummary(summary) {
  console.log("Summary:");

  if (summary.backupPath) {
    console.log(`- backup: ${summary.backupPath}`);
  }

  console.log(
    `- moved paths: ${summary.moved.length > 0 ? summary.moved.join(", ") : "none"}`,
  );
  console.log(
    `- skipped paths: ${summary.skipped.length > 0 ? summary.skipped.join(", ") : "none"}`,
  );
  console.log(
    `- conflicts/errors: ${summary.errors.length > 0 ? summary.errors.join(", ") : "none"}`,
  );
}

async function main() {
  const options = parseArgs();
  const voratiqDirKind = await pathKind(options.voratiqDir);

  if (voratiqDirKind !== "directory") {
    usage(
      `--voratiq-dir must point to an existing .voratiq directory, got ${options.voratiqDir}`,
    );
  }

  const plan = await buildPlan(options.voratiqDir);
  printPlan(plan, options);

  const summary = {
    moved: [],
    skipped: plan.skipped.map(
      (entry) => `${entry.from} -> ${entry.to} (${entry.reason})`,
    ),
    errors: plan.conflicts.map(
      (entry) => `${entry.from} -> ${entry.to} (${entry.reason})`,
    ),
    backupPath: null,
  };

  if (plan.conflicts.length > 0) {
    printSummary(summary);
    process.exit(1);
  }

  if (!options.apply) {
    printSummary(summary);
    return;
  }

  if (plan.plannedMoves.length === 0) {
    printSummary(summary);
    return;
  }

  if (options.backup) {
    summary.backupPath = await createBackup(options.voratiqDir);
    console.log(`Backup created: ${summary.backupPath}`);
  }

  for (const move of plan.plannedMoves) {
    await rename(move.fromPath, move.toPath);
    summary.moved.push(`${move.from} -> ${move.to}`);
    console.log(`Moved ${move.from} -> ${move.to}`);
  }

  printSummary(summary);
}

main().catch((error) => {
  const message =
    error instanceof Error
      ? error.message
      : `Unexpected error: ${String(error)}`;
  console.error(message);
  process.exit(1);
});
