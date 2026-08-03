import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const policy = readFileSync(new URL("../../.yukh/project.yaml", import.meta.url), "utf8");
const plan = JSON.parse(readFileSync(new URL("../../docs/reference/project-5-area-phase-a-plan-v1.json", import.meta.url), "utf8"));
const snapshot = readFileSync(new URL("../../docs/reference/project-5-schema-snapshot-v1.json", import.meta.url));

test("Area plan is non-executable and preserves Component and Status", () => {
  assert.equal(plan.schema, 1);
  assert.equal(plan.phase, "read_only_plan");
  assert.equal(plan.executable, false);
  assert.deepEqual(plan.preserve, ["Component", "Status"]);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].field, "Area");
  assert.equal(plan.operations[0].kind, "create_project_single_select_field");
  assert.equal(plan.transport_budget.retries, 0);
});

test("Area option plan is derived exactly from repository policy order", () => {
  const areaBlock = policy.match(/^  area:\n(?<body>(?:    .+\n)+)/mu)?.groups?.body;
  assert.ok(areaBlock);
  assert.match(areaBlock, /^    project_field: Area$/mu);
  assert.match(areaBlock, /^    ownership: extension$/mu);
  assert.doesNotMatch(areaBlock, /Component/u);
  const values = [...areaBlock.matchAll(/^      [A-Za-z_]+: (?<display>[A-Za-z ]+)$/gmu)].map((match) => match.groups.display);
  assert.deepEqual(plan.operations[0].options, values);
});

test("Area plan retains closed rate and ambiguity boundaries", () => {
  assert.equal(plan.transport_budget.phase_b_request_ceiling, 3);
  assert.equal(plan.transport_budget.phase_b_minimum_remaining_reserve, 1000);
  assert.deepEqual(plan.stop_conditions, [
    "schema_changed",
    "field_type_conflict",
    "case_fold_name_conflict",
    "option_conflict",
    "incomplete_snapshot",
    "rate_reserve_reached",
    "ambiguous_provider_result"
  ]);
});

test("Area plan binds the exact canonical redacted snapshot", () => {
  const parsed = JSON.parse(snapshot);
  assert.equal(parsed.total_count, 20);
  assert.equal(parsed.fields.some((field) => field.name === "Area"), false);
  assert.equal(parsed.fields.find((field) => field.name === "Component").type, "SINGLE_SELECT");
  assert.equal(parsed.fields.find((field) => field.name === "Status").type, "SINGLE_SELECT");
  assert.equal(createHash("sha256").update(snapshot).digest("hex"), plan.snapshot.canonical_schema_sha256);
});
