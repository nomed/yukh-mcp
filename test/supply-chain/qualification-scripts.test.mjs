import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Codex Python app-server worker qualification is explicit opt-in", async () => {
  const path = ".github/scripts/qualify-codex-python-app-server-worker.sh";
  await access(new URL(`../../${path}`, import.meta.url), constants.X_OK);
  const source = await read(path);

  assert.match(source, /YUKH_RUN_CODEX_PYTHON_APP_SERVER_QUALIFICATION/);
  assert.match(source, /YUKH_CODEX_QUALIFICATION_CONTEXT_PATHS/);
  assert.match(source, /invalid qualification context paths/);
  assert.match(source, /info\.size > 4_096/);
  assert.match(source, /YUKH-QUALIFICATION-OPT-IN-REQUIRED/);
  assert.match(source, /buildWorkerPrompt/);
  assert.match(source, /openai-codex/);
  assert.match(source, /ApprovalMode\.deny_all/);
  assert.match(source, /Sandbox\.read_only/);
  assert.match(source, /keep_current_codex_worker_floor_until_real_runner_qualification/);
});
