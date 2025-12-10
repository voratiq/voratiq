#!/usr/bin/env bash
set -euo pipefail

log() {
  echo "[voratiq] $*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

CODEX_ROOT="${CODEX_ROOT:-/codex/root}"
CODEX_HOME_SRC="${CODEX_HOME_SRC:-/codex/home-src}"
CODEX_BIN="${CODEX_BIN:-${CODEX_ROOT}/bin/codex}"

[[ -x "${CODEX_BIN}" ]] || die "Codex binary not found at ${CODEX_BIN}."

mkdir -p /root/.codex
[[ -f "${CODEX_HOME_SRC}/auth.json" ]] || die "${CODEX_HOME_SRC}/auth.json missing."
install -m 0600 "${CODEX_HOME_SRC}/auth.json" /root/.codex/auth.json
if [[ -f "${CODEX_HOME_SRC}/config.toml" ]]; then
  install -m 0600 "${CODEX_HOME_SRC}/config.toml" /root/.codex/config.toml
fi

cat >/usr/local/bin/codex <<'EOF_SH'
#!/usr/bin/env bash
exec /codex/root/bin/codex "$@"
EOF_SH
chmod +x /usr/local/bin/codex
