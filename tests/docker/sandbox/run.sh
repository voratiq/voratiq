#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="voratiq-sandbox"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/../../.." && pwd)
DOCKERFILE="${ROOT_DIR}/tests/docker/sandbox/Dockerfile"

log() {
  echo "[voratiq] $*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

command -v docker >/dev/null || die "docker CLI not found."

log "Building ${IMAGE_TAG} from ${DOCKERFILE}..."
docker build -f "${DOCKERFILE}" -t "${IMAGE_TAG}" "${ROOT_DIR}"

log "Running npm run test:sandbox..."
docker run --rm \
  --cap-add=NET_ADMIN \
  --cap-add=SYS_ADMIN \
  --security-opt apparmor=unconfined \
  --security-opt seccomp=unconfined \
  "${IMAGE_TAG}"
