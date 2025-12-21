#!/usr/bin/env bash
set -euo pipefail

log() {
  echo "[voratiq] $*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

log "Starting hello-world test..."

/app/tests/docker/hello-world/stage-codex.sh

command -v voratiq >/dev/null || die "voratiq command not found."

log "Initializing workspace..."
voratiq init --yes

log "Switching Codex agent to gpt-5.1-codex-mini..."
node <<'NODE'
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  sanitizeAgentIdFromModel,
} from "/app/dist/configs/agents/defaults.js";

const configPath = path.resolve(".voratiq/agents.yaml");
const desiredModel = "gpt-5.1-codex-mini";
const desiredId = sanitizeAgentIdFromModel(desiredModel);
const content = fs.readFileSync(configPath, "utf8");
const doc = yaml.load(content);

if (!doc || typeof doc !== "object" || !Array.isArray(doc.agents)) {
  throw new Error("Unexpected .voratiq/agents.yaml shape");
}

const codexAgent = doc.agents.find((agent) => agent?.provider === "codex");
if (!codexAgent) {
  throw new Error("Codex provider entry missing from .voratiq/agents.yaml");
}

codexAgent.id = desiredId;
codexAgent.model = desiredModel;

fs.writeFileSync(
  configPath,
  yaml.dump(doc, { lineWidth: -1, noCompatMode: true }),
  "utf8",
);
NODE

if ! grep -q "provider: codex" .voratiq/agents.yaml; then
  die "Codex provider entry missing from .voratiq/agents.yaml"
fi

if ! grep -q "binary: /usr/local/bin/codex" .voratiq/agents.yaml; then
  die "Codex binary was not resolved to /usr/local/bin/codex"
fi

log "Running spec: tests/fixtures/specs/hello-world.md..."
voratiq run --spec tests/fixtures/specs/hello-world.md

exit 0
