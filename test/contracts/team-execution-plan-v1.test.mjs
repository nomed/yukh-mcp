import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const schema = JSON.parse(
  readFileSync(
    new URL("../../contracts/team-execution-plan-v1.schema.json", import.meta.url),
    "utf8",
  ),
);
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const agent = {
  runtime: "codex",
  role: "backend-developer",
  mission: "Implement one bounded increment",
  model: "default",
  skills: ["testing"],
  instructions: "Inspect relevant files, implement and test.",
  task: "Deliver the increment.",
  tool_mode: "none",
  max_commands: 4,
  timeout_ms: 60_000,
  token_budget: 20_000,
};

test("team execution plan response schema uses the supported closed subset", () => {
  const unsupported = new Set([
    "uniqueItems",
    "pattern",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "minItems",
    "maxItems",
  ]);
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(unsupported.has(key), false, `unsupported response-schema keyword: ${key}`);
      visit(child);
    }
  };
  visit(schema);
  assert.match(schema.$defs.agent.properties.role.description, /never spaces/u);
  assert.equal(
    validate({
      schema: 1,
      workers: [agent],
      synthesis: { ...agent, role: "delivery-synthesizer", skills: [] },
    }),
    true,
    JSON.stringify(validate.errors),
  );
});

test("team execution plan response schema rejects unknown fields", () => {
  assert.equal(
    validate({
      schema: 1,
      workers: [{ ...agent, shell: "unrestricted" }],
      synthesis: { ...agent, role: "delivery-synthesizer" },
    }),
    false,
  );
  assert.ok(validate.errors?.some((error) => error.keyword === "additionalProperties"));
});
