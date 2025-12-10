#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="voratiq-sandbox"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/../../.." && pwd)
DOCKERFILE="${ROOT_DIR}/tests/docker/sandbox/Dockerfile"

echo "[voratiq] Building ${IMAGE_TAG} from ${DOCKERFILE}..." >&2
docker build -f "${DOCKERFILE}" -t "${IMAGE_TAG}" "${ROOT_DIR}"

echo "[voratiq] Running sandbox tests..." >&2
docker run --rm \
  --cap-add=NET_ADMIN \
  --cap-add=SYS_ADMIN \
  --security-opt apparmor=unconfined \
  --security-opt seccomp=unconfined \
  "${IMAGE_TAG}"
