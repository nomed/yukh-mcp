#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

realpath_for() {
  python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"
}

CODEX_BIN="${YUKH_CODEX_EXECUTABLE:-$(command -v codex || true)}"
COPILOT_BIN="${YUKH_COPILOT_EXECUTABLE:-$(command -v copilot || true)}"
if [[ -z "$CODEX_BIN" || -z "$COPILOT_BIN" ]]; then
  printf '%s\n' "missing codex or copilot executable on PATH" >&2
  exit 2
fi

COORDINATION_REPO="${YUKH_COORDINATION_REPO:-$(cd "$ROOT/../yukh-coordination" && pwd)}"
LAUNCHER="${YUKH_COORDINATION_LAUNCHER:-$COORDINATION_REPO/.github/scripts/yukh-local-agent.py}"
if [[ ! -x "$LAUNCHER" ]]; then
  printf 'missing executable Coordination launcher: %s\n' "$LAUNCHER" >&2
  exit 2
fi

export YUKH_PREVIEW_RUNTIME="${YUKH_PREVIEW_RUNTIME:-$ROOT/.yukh/runtime/local-suite}"
export YUKH_CONVERSATION_WORKSPACE="${YUKH_CONVERSATION_WORKSPACE:-$ROOT}"
export YUKH_COORDINATION_LAUNCHER="$LAUNCHER"
export YUKH_CODEX_EXECUTABLE="$(realpath_for "$CODEX_BIN")"
export YUKH_COPILOT_EXECUTABLE="$(realpath_for "$COPILOT_BIN")"
export YUKH_NATS_URL="${YUKH_NATS_URL:-nats://127.0.0.1:14222}"
export YUKH_WORKER_ACTIVITY_JETSTREAM="${YUKH_WORKER_ACTIVITY_JETSTREAM:-1}"
export YUKH_WORKER_ACTIVITY_CREATE_STREAM="${YUKH_WORKER_ACTIVITY_CREATE_STREAM:-1}"
export YUKH_CODEX_WORKER_PROVIDER="${YUKH_CODEX_WORKER_PROVIDER:-python-app-server-workspace-write}"
export YUKH_COPILOT_WORKER_PROVIDER="${YUKH_COPILOT_WORKER_PROVIDER:-sdk}"

if [[ ! -f "$YUKH_PREVIEW_RUNTIME/coordinator.json" ]]; then
  printf 'missing compose runtime at %s; start compose first\n' "$YUKH_PREVIEW_RUNTIME" >&2
  exit 2
fi

npm run build >/dev/null

printf 'Yukh host Control Plane\n'
printf '  workspace: %s\n' "$YUKH_CONVERSATION_WORKSPACE"
printf '  runtime:   %s\n' "$YUKH_PREVIEW_RUNTIME"
printf '  codex:     %s\n' "$YUKH_CODEX_EXECUTABLE"
printf '  copilot:   %s\n' "$YUKH_COPILOT_EXECUTABLE"
printf '  url:       http://127.0.0.1:%s\n' "${YUKH_CONTROL_PORT:-7345}"

node dist/apps/control-plane-preview/src/main.js \
  --host 127.0.0.1 \
  --port "${YUKH_CONTROL_PORT:-7345}" \
  --workspace "$YUKH_CONVERSATION_WORKSPACE"
