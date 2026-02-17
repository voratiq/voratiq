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

log "Initializing workspace with lite preset..."
voratiq init --yes --preset lite

if ! grep -q "provider: codex" .voratiq/agents.yaml; then
  die "Codex provider entry missing from .voratiq/agents.yaml"
fi

if ! grep -q "binary: /usr/local/bin/codex" .voratiq/agents.yaml; then
  die "Codex binary was not resolved to /usr/local/bin/codex"
fi

log "Running spec: tests/fixtures/specs/hello-world.md..."
voratiq run --spec tests/fixtures/specs/hello-world.md
