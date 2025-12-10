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
python3 - <<'PY'
from pathlib import Path
import sys

config_path = Path(".voratiq/agents.yaml")
needles = [
  (
    "  - id: gpt-5-1-codex-max\n    provider: codex\n    model: gpt-5.1-codex-max",
    "  - id: gpt-5-1-codex-mini\n    provider: codex\n    model: gpt-5.1-codex-mini",
  ),
  (
    "  - id: gpt-5-1-codex\n    provider: codex\n    model: gpt-5.1-codex",
    "  - id: gpt-5-1-codex-mini\n    provider: codex\n    model: gpt-5.1-codex-mini",
  ),
]

try:
  content = config_path.read_text(encoding="utf-8")
except FileNotFoundError as exc:
  raise SystemExit(f"{config_path} missing: {exc}") from exc

for needle, replacement in needles:
  if needle in content:
    config_path.write_text(content.replace(needle, replacement, 1), encoding="utf-8")
    break
else:
  raise SystemExit("Codex default block not found in .voratiq/agents.yaml")
PY

if ! grep -q "provider: codex" .voratiq/agents.yaml; then
  die "Codex provider entry missing from .voratiq/agents.yaml"
fi

if ! grep -q "binary: /usr/local/bin/codex" .voratiq/agents.yaml; then
  die "Codex binary was not resolved to /usr/local/bin/codex"
fi

log "Running spec: tests/fixtures/specs/hello-world.md..."
voratiq run --spec tests/fixtures/specs/hello-world.md

exit 0
