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

test("Control Plane live activity qualification uses JetStream and fake provider", async () => {
  const path = ".github/scripts/qualify-control-plane-live-activity.sh";
  await access(new URL(`../../${path}`, import.meta.url), constants.X_OK);
  const source = await read(path);

  assert.match(source, /npm run build/);
  assert.match(source, /YUKH_NATS_URL:-nats:\/\/127\.0\.0\.1:14222/);
  assert.match(source, /WorkerActivityJetStreamBus/);
  assert.match(source, /worker\.activity\.v1-jetstream/);
  assert.match(source, /fake-codex\.mjs/);
  assert.match(source, /observed_tokens: 150/);
  assert.match(source, /api\/manager-plan\/worker-activities/);
  assert.doesNotMatch(source, /tail -f/u);
  assert.doesNotMatch(source, /YUKH_CODEX_EXECUTABLE:-\\$\\(command -v codex\\)/u);
});

test("preview runtime check is diagnostic and non-destructive", async () => {
  const path = ".github/scripts/check-preview-runtime.sh";
  await access(new URL(`../../${path}`, import.meta.url), constants.X_OK);
  const source = await read(path);

  assert.match(source, /runtime directory must be mode 0700/);
  assert.match(source, /openssl x509 -checkend 21600/);
  assert.match(source, /docker: sudo-required/);
  assert.match(source, /warnings=0/);
  assert.match(source, /warning "coordination_replay: unavailable"/);
  assert.match(source, /status: ok-with-warnings/);
  assert.match(source, /status: attention-required/);
  assert.match(source, /coordination_replay: unavailable/);
  assert.match(source, /YKC-TRANSCRIPT-001/);
  assert.doesNotMatch(source, /down --volumes/u);
  assert.doesNotMatch(source, /rm -rf/u);
});
