#!/usr/bin/env bash
set -euo pipefail

if [[ "${YUKH_RUN_CODEX_PYTHON_APP_SERVER_QUALIFICATION:-}" != "1" ]]; then
  printf '%s\n' '{"schema":1,"status":"skipped","command":"qualify codex python app-server worker","code":"YUKH-QUALIFICATION-OPT-IN-REQUIRED"}'
  exit 0
fi

qual_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
qual_repo="$(cd -- "$qual_script_dir/../.." && pwd -P)"
qual_workspace="${YUKH_CODEX_QUALIFICATION_WORKSPACE:-$qual_repo}"
qual_codex="${YUKH_CODEX_EXECUTABLE:-$(command -v codex)}"
qual_python="${PYTHON:-python3}"
qual_tmp="$(mktemp -d /tmp/yukh-codex-python-worker.XXXXXX)"
trap 'rm -rf "$qual_tmp"' EXIT

if [[ ! -x "$qual_codex" ]]; then
  printf '%s\n' '{"schema":1,"status":"error","command":"qualify codex python app-server worker","code":"YUKH-CODEX-EXECUTABLE-UNAVAILABLE"}'
  exit 1
fi

"$qual_python" -m venv "$qual_tmp/venv"
"$qual_tmp/venv/bin/python" -m pip install --quiet --upgrade pip
"$qual_tmp/venv/bin/python" -m pip install --quiet openai-codex

qual_prompt_json="$qual_tmp/worker-prompt.json"
node --import tsx --input-type=module - "$qual_repo" "$qual_prompt_json" <<'JS'
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { buildWorkerPrompt } from "./apps/team-worker/src/prompt.ts";

const [, , repo, output] = process.argv;
const contextPaths = (process.env.YUKH_CODEX_QUALIFICATION_CONTEXT_PATHS ?? "")
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean);
if (
  contextPaths.length > 4 ||
  new Set(contextPaths).size !== contextPaths.length ||
  contextPaths.some(
    (path) =>
      isAbsolute(path) ||
      path.includes("\\") ||
      path.split("/").some((part) => part.length === 0 || part === "." || part === "..") ||
      [".git", ".yukh"].includes(path.split("/")[0]),
  )
) {
  throw new TypeError("invalid qualification context paths");
}
const contextFiles = contextPaths.map((path) => ({
  path,
  content: (() => {
    const target = new URL(path, `file://${repo}/`);
    const info = lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4_096)
      throw new TypeError("invalid qualification context file");
    return readFileSync(target, "utf8");
  })(),
}));
const contextPack =
  contextFiles.length > 0
    ? (() => {
        const canonical = JSON.stringify({ schema: 1, files: contextFiles });
        return {
          schema: 1,
          digest: `sha-256:${createHash("sha256").update(canonical).digest("hex")}`,
          byte_length: Buffer.byteLength(
            contextFiles.map((file) => file.content).join(""),
            "utf8",
          ),
          paths: contextFiles.map((file) => file.path),
          files: contextFiles,
        };
      })()
    : undefined;
const agent = {
  schema: 1,
  agent_id: "worker-00000000-0000-4000-8000-000000000222",
  kind: "worker",
  coordination_agent: "agent-codex-python-qualification",
  coordination_participant: "agent:codex-python-qualification",
  team_id: "team-00000000-0000-4000-8000-000000000222",
  runtime: "codex",
  role: "codex-python-qualification",
  task: "Review only the supplied bounded context and answer whether this worker prompt completed. Do not modify files. Do not inspect additional files. Do not run commands.",
  depth: 1,
  can_spawn: false,
  token_budget: 45_000,
  required_actions: [],
  model_tool_mode: "none",
  max_commands: 0,
  timeout_ms: 120_000,
  state: "defined",
};
const prompt = buildWorkerPrompt({
  agent,
  ...(contextPack ? { contextPack } : {}),
  modelToolMode: "none",
  requiredActions: "none",
  modelUsesCoordination: false,
  modelUsesTeamControl: false,
  modelTeamTools: [],
  coordinationInstruction: "",
  teamControlInstruction: "",
  delegationInstruction: "",
  planConstraintInstruction: "",
});
writeFileSync(
  output,
  JSON.stringify(
    {
      schema: 1,
      prompt,
      prompt_bytes: Buffer.byteLength(prompt, "utf8"),
      context_digest: contextPack?.digest ?? null,
      context_bytes: contextPack?.byte_length ?? 0,
      context_paths: contextPack?.paths ?? [],
    },
    null,
    2,
  ),
);
JS

qual_python_probe="$qual_tmp/probe.py"
cat >"$qual_python_probe" <<'PY'
import json
import os
from pathlib import Path

from openai_codex import ApprovalMode, Codex, CodexConfig, Sandbox

prompt_doc = json.loads(Path(os.environ["YUKH_QUALIFICATION_PROMPT_JSON"]).read_text())
codex_bin = os.environ["YUKH_CODEX_EXECUTABLE"]
workspace = os.environ["YUKH_CODEX_QUALIFICATION_WORKSPACE"]
turns = int(os.environ.get("YUKH_CODEX_PYTHON_QUALIFICATION_THREADS", "2"))

config = CodexConfig(
    codex_bin=codex_bin,
    cwd=workspace,
    env={
        "HOME": os.environ.get("HOME", ""),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
    },
    config_overrides=('web_search="disabled"',),
)


def breakdown(value):
    if value is None:
        return None
    return {
        name: getattr(value, name)
        for name in (
            "cached_input_tokens",
            "input_tokens",
            "output_tokens",
            "reasoning_output_tokens",
            "total_tokens",
        )
    }


records = []
with Codex(config) as codex:
    for index in range(1, turns + 1):
        thread = codex.thread_start(
            cwd=workspace,
            sandbox=Sandbox.read_only,
            approval_mode=ApprovalMode.deny_all,
            ephemeral=True,
        )
        result = thread.run(
            prompt_doc["prompt"],
            sandbox=Sandbox.read_only,
            approval_mode=ApprovalMode.deny_all,
            effort="low",
            summary="none",
        )
        records.append(
            {
                "thread_number": index,
                "thread_id": thread.id,
                "turn_id": result.id,
                "status": result.status.value,
                "duration_ms": result.duration_ms,
                "final_response_bytes": len((result.final_response or "").encode("utf-8")),
                "usage_last": breakdown(result.usage.last if result.usage else None),
                "usage_total": breakdown(result.usage.total if result.usage else None),
                "model_context_window": result.usage.model_context_window if result.usage else None,
            }
        )

totals = [
    record["usage_last"]["total_tokens"]
    for record in records
    if record["usage_last"] is not None
]
max_total = max(totals) if totals else None
print(
    json.dumps(
        {
            "schema": 1,
            "status": "ok" if totals else "error",
            "command": "qualify codex python app-server worker",
            "runtime": "codex-python-app-server",
            "workspace": workspace,
            "prompt_bytes": prompt_doc["prompt_bytes"],
            "context_digest": prompt_doc["context_digest"],
            "context_bytes": prompt_doc["context_bytes"],
            "context_paths": prompt_doc["context_paths"],
            "threads": records,
            "max_observed_total_tokens": max_total,
            "current_codex_cli_floor_tokens": 120000,
            "recommendation": "keep_current_codex_worker_floor_until_real_runner_qualification",
        },
        sort_keys=True,
    )
)
PY

YUKH_CODEX_EXECUTABLE="$qual_codex" \
YUKH_CODEX_QUALIFICATION_WORKSPACE="$qual_workspace" \
YUKH_QUALIFICATION_PROMPT_JSON="$qual_prompt_json" \
  "$qual_tmp/venv/bin/python" "$qual_python_probe"
