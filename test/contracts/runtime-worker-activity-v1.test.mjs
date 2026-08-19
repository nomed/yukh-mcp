import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const root = new URL("../..", import.meta.url);
const contractRoot = new URL("../../contracts/runtime/v1/", import.meta.url);
const schema = load(new URL("worker-activity.schema.json", contractRoot));
const example = load(new URL("examples/worker-activity.json", contractRoot));
const negativeCases = load(new URL("fixtures/worker-activity-negative-cases.json", contractRoot));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function load(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

function pointerParts(pointer) {
  return pointer
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function setPointer(document, pointer, value) {
  const parts = pointerParts(pointer);
  const key = parts.pop();
  let parent = document;
  for (const part of parts) parent = parent[part];
  parent[key] = value === "__OVERSIZED_LOG_CHUNK__" ? "x".repeat(4097) : value;
}

function deletePointer(document, pointer) {
  const parts = pointerParts(pointer);
  const key = parts.pop();
  let parent = document;
  for (const part of parts) parent = parent[part];
  delete parent[key];
}

test("worker.activity.v1 validates the runtime activity example", () => {
  assert.equal(validate(example), true, JSON.stringify(validate.errors));
});

test("worker.activity.v1 negative fixtures fail with stable schema keywords", () => {
  for (const fixture of negativeCases) {
    const value = clone(example);
    for (const [pointer, replacement] of Object.entries(fixture.set ?? {})) {
      setPointer(value, pointer, replacement);
    }
    for (const pointer of fixture.delete ?? []) deletePointer(value, pointer);

    assert.equal(validate(value), false, fixture.name);
    assert.ok(
      validate.errors?.some((error) => error.keyword === fixture.expected_keyword),
      `${fixture.name}: ${JSON.stringify(validate.errors)}`,
    );
  }
});

test("event subject policy documents bounded JetStream contracts", () => {
  const policy = readFileSync(join(root.pathname, "docs/architecture/event-subject-policy.md"), "utf8");

  for (const stream of [
    "YKP_WORK_EVENTS_V1",
    "YKO_RUN_EVENTS_V1",
    "YKC_CHANNEL_EVENTS_V1",
    "YKR_WORKER_EVENTS_V1",
  ]) {
    assert.match(policy, new RegExp(`\\b${stream}\\b`, "u"));
    assert.doesNotMatch(stream, /[\\s.*>/]/u);
  }

  assert.match(
    policy,
    /yukh\.<env>\.<tenant>\.<context>\.<aggregate_type>\.<aggregate_id>\.<event_type>\.v1/u,
  );
  assert.match(policy, /Subjects never contain prompts, user text, local paths, secrets or credentials/u);
  assert.match(policy, /Local files are preview adapters only/u);
  assert.match(policy, /NATS Object Store/u);
  assert.match(policy, /KV buckets are\s+rebuildable projections/u);
});

test("control plane topology describes JetStream as distributed runtime, not local files", () => {
  const source = readFileSync(join(root.pathname, "apps/control-plane-preview/src/topology-status.ts"), "utf8");

  assert.match(source, /bounded streams, rebuildable KV projections and object artifacts/u);
  assert.match(source, /never one shared logical contract or node-local log contract/u);
});
