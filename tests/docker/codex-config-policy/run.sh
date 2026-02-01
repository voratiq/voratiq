#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="voratiq-codex-config-policy"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/../../.." && pwd)
DOCKERFILE="${ROOT_DIR}/tests/docker/codex-config-policy/Dockerfile"

log() {
  echo "[voratiq] $*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

probe_docker_socket() {
  local user_name
  user_name="$(id -un)"

  local socket
  for socket in \
    "/var/run/docker.sock" \
    "/Users/${user_name}/.docker/run/docker.sock"; do
    if [[ -S "${socket}" ]]; then
      export DOCKER_HOST="unix://${socket}"
      return 0
    fi
  done

  return 1
}

if [[ -z "${DOCKER_HOST:-}" ]]; then
  probe_docker_socket || true
fi

command -v docker >/dev/null || die "docker CLI not found."

if [[ -n "${DOCKER_HOST:-}" ]]; then
  log "Using DOCKER_HOST=${DOCKER_HOST}"
fi

log "Building ${IMAGE_TAG} from ${DOCKERFILE}..."
docker build -f "${DOCKERFILE}" -t "${IMAGE_TAG}" "${ROOT_DIR}"

log "Running codex config policy test..."
docker run --rm --network none "${IMAGE_TAG}"
