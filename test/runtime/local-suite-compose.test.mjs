import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compose = readFileSync(new URL("../../compose.suite.yaml", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
const check = readFileSync(
  new URL("../../.github/scripts/check-compose-runtime.mjs", import.meta.url),
  "utf8",
);
const previewRuntimeStatus = readFileSync(
  new URL("../../apps/control-plane-preview/src/preview-runtime-status.ts", import.meta.url),
  "utf8",
);
const guide = readFileSync(
  new URL("../../docs/how-to/run-local-suite-compose.md", import.meta.url),
  "utf8",
);
const rfc = readFileSync(
  new URL("../../.context/rfcs/RFC-0026-local-suite-compose-preview.md", import.meta.url),
  "utf8",
);

test("local suite compose starts runtime, gateway and Control Plane UI", () => {
  for (const service of ["preview-init", "nats", "coordinator", "gateway", "control-plane"]) {
    assert.match(compose, new RegExp(`^  ${service}:$`, "mu"));
  }
  assert.match(compose, /--jetstream/u);
  assert.match(
    compose,
    /openssl rand 32 \| openssl base64 -A \| tr '\+\/' '-_' \| tr -d '=' > \/run\/yukh\/supervisor\.token/u,
  );
  assert.doesNotMatch(compose, /supervisor\.token \] \|\| openssl rand -base64/u);
  assert.match(compose, /YUKH_WORKER_ACTIVITY_JETSTREAM: "1"/u);
  assert.match(compose, /YUKH_PREVIEW_RUNTIME_CHECK_SCRIPT/u);
  assert.match(compose, /dist\/apps\/control-plane-preview\/src\/main\.js/u);
});

test("local suite compose binds local ports only", () => {
  for (const port of ["14222:4222", "7443:7443", "7444:7444", "3000:3000", "7345:7345"]) {
    assert.equal(compose.includes(`"127.0.0.1:${port}"`), true, port);
  }
  assert.doesNotMatch(compose, /"0\.0\.0\.0:[0-9]+:/u);
});

test("Control Plane image carries compose runtime check and project policy", () => {
  assert.match(dockerfile, /--chmod=0755 .*check-compose-runtime\.mjs/u);
  assert.match(dockerfile, /\.yukh\/project\.yaml/u);
  assert.match(check, /YUKH_COORDINATION_SUPERVISOR_URL/u);
  assert.match(check, /NATS unavailable/u);
  assert.match(check, /status: ok/u);
  assert.match(previewRuntimeStatus, /YUKH_PREVIEW_RUNTIME_CHECK_SCRIPT/u);
  assert.doesNotMatch(
    check,
    /docker ps|DOCKER_HOST|rejectUnauthorized|authorization|supervisor\.token.*console/u,
  );
});

test("local suite docs and RFC state the current worker execution limit", () => {
  assert.match(guide, /docker compose -f compose\.suite\.yaml up -d --build/u);
  assert.match(guide, /http:\/\/127\.0\.0\.1:7345/u);
  assert.match(guide, /does not yet containerize Codex or\s+Copilot worker execution/su);
  assert.match(rfc, /^# RFC-0026 — Local suite Compose preview$/mu);
  assert.match(rfc, /SDK-based workers running inside containers/u);
  assert.match(rfc, /host runner bridge/u);
});
