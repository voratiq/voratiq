#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="voratiq-hello-world"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/../../.." && pwd)
DOCKERFILE="${ROOT_DIR}/tests/docker/hello-world/Dockerfile"

log() {
  echo "[voratiq] $*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

require_env_path() {
  local value="$1"
  local message="$2"
  [[ -n "${value}" ]] || die "${message}"
}

CODEX_BIN="${CODEX_BIN:-}"
CODEX_HOME="${CODEX_HOME:-}"

require_env_path "${CODEX_BIN}" "Set CODEX_BIN=/path/to/codex before running this script."
require_env_path "${CODEX_HOME}" "Set CODEX_HOME=/path/to/.codex before running this script."

[[ -x "${CODEX_BIN}" ]] || die "Codex binary not executable at ${CODEX_BIN}."
[[ -d "${CODEX_HOME}" ]] || die "Codex home directory not found at ${CODEX_HOME}."
[[ -f "${CODEX_HOME}/auth.json" ]] || die "${CODEX_HOME}/auth.json missing (run 'codex login')."

# Derive the Codex install root (one level above the binary's directory).
CODEX_ROOT=$(python3 - <<'PY'
import os
path = os.environ["CODEX_BIN"]
abs_path = os.path.abspath(path)
root = os.path.abspath(os.path.join(os.path.dirname(abs_path), os.pardir))
print(root)
PY
)

[[ -d "${CODEX_ROOT}" ]] || die "Unable to derive Codex root from ${CODEX_BIN}."

log "Building ${IMAGE_TAG} from ${DOCKERFILE}..."
docker build -f "${DOCKERFILE}" -t "${IMAGE_TAG}" "${ROOT_DIR}"

log "Running hello-world test with Codex..."
docker run --rm \
  --cap-add=NET_ADMIN \
  --cap-add=SYS_ADMIN \
  --security-opt apparmor=unconfined \
  --security-opt seccomp=unconfined \
  --mount type=bind,src="${CODEX_ROOT}",target=/codex/root,readonly \
  --mount type=bind,src="${CODEX_HOME}",target=/codex/home-src,readonly \
  "${IMAGE_TAG}"
