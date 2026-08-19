#!/usr/bin/env bash
set -euo pipefail

runtime="${YUKH_PREVIEW_RUNTIME:-$HOME/.yukh/local-preview}"
coordination_root="${YUKH_COORDINATION_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)/yukh-coordination}"
launcher="${YUKH_COORDINATION_LAUNCHER:-$coordination_root/.github/scripts/yukh-local-agent.py}"

problems=0
warnings=0

report() {
  printf '%s\n' "$*"
}

problem() {
  problems=$((problems + 1))
  report "problem: $*"
}

warning() {
  warnings=$((warnings + 1))
  report "warning: $*"
}

report "yukh-preview-runtime-check"
report "runtime: $runtime"
report "launcher: $launcher"

[[ -d "$runtime" ]] || problem "runtime directory missing"
if [[ -d "$runtime" ]]; then
  mode="$(stat -c '%a' "$runtime" 2>/dev/null || stat -f '%Lp' "$runtime" 2>/dev/null || true)"
  report "runtime_mode: ${mode:-unknown}"
  [[ "$mode" == "700" ]] || problem "runtime directory must be mode 0700 for local custody"
fi

for file in bin/yukh-coordination server.crt supervisor.token agent-a.root agent-b.root; do
  [[ -f "$runtime/$file" ]] || problem "missing $runtime/$file"
done

if [[ -f "$runtime/server.crt" ]]; then
  if openssl x509 -checkend 21600 -noout -in "$runtime/server.crt" >/dev/null 2>&1; then
    report "tls: ok"
  else
    problem "preview TLS certificate is expired or expires within 6 hours"
  fi
fi

if command -v docker >/dev/null 2>&1; then
  if docker ps >/dev/null 2>&1; then
    report "docker: ok"
  elif command -v sudo >/dev/null 2>&1 && sudo -n docker ps >/dev/null 2>&1; then
    report "docker: sudo-required"
  else
    problem "docker daemon unavailable to current user"
  fi
else
  problem "docker command missing"
fi

if [[ -x "$launcher" && -d "$runtime" ]]; then
  if YUKH_PREVIEW_RUNTIME="$runtime" "$launcher" agent-a events replay >/dev/null 2>&1; then
    report "coordination_replay: ok"
  else
    warning "coordination_replay: unavailable"
    report "hint: run agent bootstrap/join after the coordinator is reachable; if replay returns YKC-TRANSCRIPT-001, start with a join event instead of deleting state."
  fi
else
  problem "coordination launcher unavailable"
fi

if (( problems > 0 )); then
  report "status: attention-required"
  exit 2
elif (( warnings > 0 )); then
  report "status: ok-with-warnings"
else
  report "status: ok"
fi
