#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JEST_BIN="$ROOT_DIR/node_modules/jest/bin/jest.js"

export VORATIQ_SUPPRESS_RUN_STATUS_TABLE="${VORATIQ_SUPPRESS_RUN_STATUS_TABLE:-true}"

# Automatically flip workspace-aware test discovery on when running from a
# sandbox workspace copy so Jest doesn't ignore every test path.
if [[ "${VORATIQ_WORKSPACE_TESTS:-}" != "1" && "${ROOT_DIR}" == *"/.voratiq/runs/"* ]]; then
  export VORATIQ_WORKSPACE_TESTS=1
fi

sandbox_only=false
passthrough=()

for arg in "$@"; do
  if [[ "$arg" == "--sandbox-only" ]]; then
    sandbox_only=true
  else
    passthrough+=("$arg")
  fi
done

cmd=("node" "--experimental-vm-modules" "$JEST_BIN")

if [[ "$sandbox_only" == true ]]; then
  cmd+=("--runTestsByPath" "tests/run/agents.test.ts" "tests/run/sandbox.test.ts")
fi

if ((${#passthrough[@]})); then
  exec "${cmd[@]}" "${passthrough[@]}"
else
  exec "${cmd[@]}"
fi
