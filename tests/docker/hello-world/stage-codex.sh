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

CODEX_HOME_SRC="${CODEX_HOME_SRC:-/codex/home-src}"
CODEX_BIN="${CODEX_BIN:-/usr/local/bin/codex}"

[[ -x "${CODEX_BIN}" ]] || die "Codex binary not found at ${CODEX_BIN}."

mkdir -p /root/.codex
[[ -f "${CODEX_HOME_SRC}/auth.json" ]] || die "${CODEX_HOME_SRC}/auth.json missing."
install -m 0600 "${CODEX_HOME_SRC}/auth.json" /root/.codex/auth.json
if [[ -f "${CODEX_HOME_SRC}/config.toml" ]]; then
  install -m 0600 "${CODEX_HOME_SRC}/config.toml" /root/.codex/config.toml
fi

command -v voratiq >/dev/null || die "voratiq command not found."

log "Initializing workspace..."
voratiq init --yes

log "Switching Codex agent to gpt-5.1-codex-mini..."
node <<'NODE'
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const configPath = path.resolve(".voratiq/agents.yaml");
const desiredModel = "gpt-5.1-codex-mini";
const content = fs.readFileSync(configPath, "utf8");
const doc = yaml.load(content);

if (!doc || typeof doc !== "object" || !Array.isArray(doc.agents)) {
  throw new Error("Unexpected .voratiq/agents.yaml shape");
}

const codexAgent = doc.agents.find((agent) => agent?.provider === "codex");
if (!codexAgent) {
  throw new Error("Codex provider entry missing from .voratiq/agents.yaml");
}

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
