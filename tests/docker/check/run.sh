#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="voratiq-check"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/../../.." && pwd)
DOCKERFILE="${ROOT_DIR}/tests/docker/check/Dockerfile"

echo "[voratiq] Building ${IMAGE_TAG} from ${DOCKERFILE}..." >&2
docker build -f "${DOCKERFILE}" -t "${IMAGE_TAG}" "${ROOT_DIR}"

echo "[voratiq] Running \`npm run check\`..." >&2
docker run --rm "${IMAGE_TAG}"
