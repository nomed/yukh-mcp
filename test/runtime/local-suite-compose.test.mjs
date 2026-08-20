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
const hostControl = readFileSync(
  new URL("../../.github/scripts/start-host-control-plane-macos.sh", import.meta.url),
  "utf8",
);
const rfc = readFileSync(
  new URL("../../.context/rfcs/RFC-0026-local-suite-compose-preview.md", import.meta.url),
  "utf8",
);

test("local suite compose starts runtime, gateway and Control Plane UI", () => {
  for (const service of [
    "preview-init",
    "workspace-init",
    "nats",
    "coordinator",
    "gateway",
    "control-plane",
  ]) {
    assert.match(compose, new RegExp(`^  ${service}:$`, "mu"));
  }
  assert.match(compose, /--jetstream/u);
  assert.match(
    compose,
    /\$\{YUKH_PREVIEW_RUNTIME:-\$\{HOME\}\/\.yukh\/yukh-local-suite\}:\/run\/yukh/u,
  );
  assert.match(compose, /YUKH_RUNTIME_UID: \$\{YUKH_UID:-1000\}/u);
  assert.match(compose, /YUKH_RUNTIME_GID: \$\{YUKH_GID:-1000\}/u);
  assert.match(compose, /runtime_uid="\$\$\{YUKH_RUNTIME_UID:-1000\}"/u);
  assert.match(
    compose,
    /token_invalid_chars="\$\$\(tr -d 'A-Za-z0-9_-' < \/run\/yukh\/supervisor\.token/u,
  );
  assert.match(compose, /chown -R "\$\$\{runtime_uid\}:\$\$\{runtime_gid\}" \/run\/yukh/u);
  assert.match(compose, /install -d -m 0755 \/run\/yukh/u);
  assert.match(compose, /runtime-ready\.json/u);
  assert.match(
    compose,
    /chmod 0644 \/run\/yukh\/coordinator\.json \/run\/yukh\/runtime-ready\.json \/run\/yukh\/server\.crt/u,
  );
  assert.match(
    compose,
    /chmod 0600 \/run\/yukh\/server\.key \/run\/yukh\/supervisor\.token \/run\/yukh\/receipt-signing\.key/u,
  );
  assert.match(
    compose,
    /if \[ "\$\$\{token_size\}" != "43" \] \|\| \[ "\$\$\{token_invalid_chars\}" != "0" \]/u,
  );
  assert.match(
    compose,
    /openssl rand 32 \| openssl base64 -A \| tr '\+\/' '-_' \| tr -d '=' > \/run\/yukh\/supervisor\.token/u,
  );
  assert.doesNotMatch(compose, /supervisor\.token \] \|\| openssl rand -base64/u);
  assert.match(compose, /YUKH_WORKER_ACTIVITY_JETSTREAM: "1"/u);
  assert.match(compose, /YUKH_PREVIEW_RUNTIME_CHECK_SCRIPT/u);
  assert.match(compose, /dist\/apps\/control-plane-preview\/src\/main\.js/u);
  assert.match(compose, /install -d -m 0700 -o 1000 -g 1000 \/workspace\/\.yukh/u);
  assert.match(compose, /workspace-init:\n\s+condition: service_completed_successfully/u);
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
  assert.match(check, /runtime-ready\.json/u);
  assert.match(check, /present-private/u);
  assert.match(check, /status: ok/u);
  assert.match(previewRuntimeStatus, /YUKH_PREVIEW_RUNTIME_CHECK_SCRIPT/u);
  assert.doesNotMatch(
    check,
    /docker ps|DOCKER_HOST|rejectUnauthorized|authorization|supervisor\.token.*console/u,
  );
});

test("local suite docs and host bridge explain real local worker mode", () => {
  assert.match(guide, /docker compose -f compose\.suite\.yaml up -d --build/u);
  assert.match(guide, /Real local workers from your Mac/u);
  assert.match(guide, /YUKH_PREVIEW_RUNTIME="\$HOME\/\.yukh\/yukh-local-suite"/u);
  assert.match(guide, /mkdir -p "\$YUKH_PREVIEW_RUNTIME"/u);
  assert.match(guide, /start-host-control-plane-macos\.sh/u);
  assert.match(
    guide,
    /docker compose -f compose\.suite\.yaml up -d --build nats coordinator gateway/u,
  );
  assert.match(guide, /http:\/\/127\.0\.0\.1:7345/u);
  assert.match(guide, /container UI does not launch host binaries/u);
  assert.match(hostControl, /YUKH_CODEX_EXECUTABLE/u);
  assert.match(hostControl, /YUKH_COPILOT_EXECUTABLE/u);
  assert.match(hostControl, /YUKH_COPILOT_WORKER_PROVIDER/u);
  assert.match(hostControl, /YUKH_CODEX_WORKER_PROVIDER/u);
  assert.match(hostControl, /\$HOME\/\.yukh\/yukh-local-suite/u);
  assert.match(hostControl, /YUKH_NATS_URL:-nats:\/\/127\.0\.0\.1:14222/u);
  assert.match(rfc, /^# RFC-0026 — Local suite Compose preview$/mu);
  assert.match(rfc, /SDK-based workers running inside containers/u);
  assert.match(rfc, /host runner bridge/u);
});
