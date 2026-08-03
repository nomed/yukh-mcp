import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateOutputAgainstDefinition,
  validateRecord,
  validateResultAgainstDefinition,
  validateRequestAgainstDefinition,
} from "../../contracts/capability/v1/validator.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const contractRoot = join(repositoryRoot, "contracts/capability/v1");
const examples = join(contractRoot, "examples");

function load(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

function pointerParts(pointer) {
  return pointer.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function setPointer(document, pointer, value) {
  const parts = pointerParts(pointer);
  const key = parts.pop();
  let parent = document;
  for (const part of parts) parent = parent[part];
  parent[key] = value;
}

function deletePointer(document, pointer) {
  const parts = pointerParts(pointer);
  const key = parts.pop();
  let parent = document;
  for (const part of parts) parent = parent[part];
  delete parent[key];
}

const validRecords = [
  ["definition", "read-definition.json"],
  ["definition", "mutation-definition.json"],
  ["request", "read-request.json"],
  ["request", "mutation-request.json"],
  ["plan", "plan.json"],
  ["result", "result.json"],
  ["error", "error.json"],
];

for (const [kind, filename] of validRecords) {
  test(`${filename} validates as ${kind}`, () => {
    assert.deepEqual(validateRecord(kind, load(join(examples, filename))), {
      valid: true,
      diagnostics: [],
    });
  });
}

test("read request validates against its exact definition", () => {
  const result = validateRequestAgainstDefinition(
    load(join(examples, "read-request.json")),
    load(join(examples, "read-definition.json")),
  );
  assert.deepEqual(result, { valid: true, diagnostics: [] });
});

test("mutation request requires its idempotency key", () => {
  const request = load(join(examples, "mutation-request.json"));
  delete request.idempotency_key;
  const result = validateRequestAgainstDefinition(
    request,
    load(join(examples, "mutation-definition.json")),
  );
  assert.equal(result.valid, false);
  assert(result.diagnostics.some(({ code }) => code === "request_idempotency_key_required"));
});

test("many-resource requests enforce the definition bound", () => {
  const definition = load(join(examples, "read-definition.json"));
  definition.resource = { kinds: ["node"], cardinality: "many", max_items: 2 };
  const request = load(join(examples, "read-request.json"));
  request.resource = { kind: "node", refs: ["node-example-01", "node-example-02"] };
  assert.equal(validateRequestAgainstDefinition(request, definition).valid, true);

  request.resource.refs.push("node-example-03");
  const invalid = validateRequestAgainstDefinition(request, definition);
  assert.equal(invalid.valid, false);
  assert(invalid.diagnostics.some(({ code }) => code === "request_resource_limit"));
});

test("request and output bytes remain within definition bounds", () => {
  const definition = load(join(examples, "read-definition.json"));
  const request = load(join(examples, "read-request.json"));
  definition.execution.max_input_bytes = 2;
  assert(validateRequestAgainstDefinition(request, definition).diagnostics.some(
    ({ code }) => code === "request_input_byte_limit",
  ));

  definition.execution.max_input_bytes = 2048;
  definition.execution.max_output_bytes = 2;
  assert.deepEqual(validateOutputAgainstDefinition(
    { health: "healthy", freshness_seconds: 2 },
    definition,
  ), {
    valid: false,
    diagnostics: [{ code: "output_byte_limit", path: "/output", message: "output exceeds the capability byte limit" }],
  });
});

test("provider output is validated before release", () => {
  const definition = load(join(examples, "read-definition.json"));
  assert.deepEqual(validateOutputAgainstDefinition(
    { health: "healthy", freshness_seconds: 2 },
    definition,
  ), { valid: true, diagnostics: [] });

  const invalid = validateOutputAgainstDefinition(
    { health: "healthy", freshness_seconds: 2, provider_body: "not allowed" },
    definition,
  );
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.diagnostics, [{
    code: "schema_additionalProperties",
    path: "/output/provider_body",
    message: "unknown field",
  }]);
});

test("mutating success requires verified postconditions", () => {
  const definition = load(join(examples, "mutation-definition.json"));
  const result = load(join(examples, "result.json"));
  result.capability = clone(definition.capability);
  delete result.capability.summary;
  delete result.capability.stability;
  result.resource_ref = "setting-example-01";
  result.output = { changed: true, version: 8 };
  result.verification = { status: "inconclusive", evidence_refs: ["evidence_example2ad4"] };
  result.error = {
    error_version: 1,
    code: "verification_inconclusive",
    phase: "verify",
    retry: "operator_review",
    message: "verification is inconclusive",
    diagnostics: [],
  };
  result.status = "failed";
  assert.equal(validateResultAgainstDefinition(result, definition).valid, true);

  result.status = "succeeded";
  result.error = null;
  const invalid = validateResultAgainstDefinition(result, definition);
  assert.equal(invalid.valid, false);
  assert(invalid.diagnostics.some(({ code }) => code === "schema_enum"));
});

test("negative fixtures fail with their stable expected code", () => {
  const cases = load(join(contractRoot, "fixtures/negative-cases.json"));
  for (const fixture of cases) {
    const value = clone(load(join(examples, fixture.base)));
    for (const [pointer, replacement] of Object.entries(fixture.set ?? {})) {
      setPointer(value, pointer, replacement);
    }
    for (const pointer of fixture.delete ?? []) deletePointer(value, pointer);

    const first = validateRecord(fixture.record, value);
    const second = validateRecord(fixture.record, clone(value));
    assert.equal(first.valid, false, fixture.name);
    assert(first.diagnostics.some(({ code }) => code === fixture.expected_code), fixture.name);
    assert.equal(JSON.stringify(first), JSON.stringify(second), `${fixture.name}: diagnostics changed`);
  }
});

test("diagnostic ordering is independent of object property order", () => {
  const left = { request_version: 2, unexpected: true };
  const right = { unexpected: true, request_version: 2 };
  assert.deepEqual(validateRecord("request", left), validateRecord("request", right));
});

test("unknown record kinds fail without exposing input", () => {
  assert.throws(() => validateRecord("provider", { secret: "example" }), {
    name: "TypeError",
    message: "unsupported record kind: provider",
  });
});
