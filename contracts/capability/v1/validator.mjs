import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const here = dirname(fileURLToPath(import.meta.url));
const schemaDirectory = join(here, "schemas");
const recordNames = ["definition", "request", "plan", "error", "result"];
const schemas = new Map(
  ["common", ...recordNames].map((name) => [
    name,
    JSON.parse(readFileSync(join(schemaDirectory, `${name}.schema.json`), "utf8")),
  ]),
);

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
});

for (const schema of schemas.values()) {
  ajv.addSchema(schema);
}

const validators = new Map(
  recordNames.map((name) => [name, ajv.getSchema(schemas.get(name).$id)]),
);

const forbiddenPropertyNames = new Set([
  "argv",
  "bearertoken",
  "command",
  "credential",
  "credentials",
  "executable",
  "interpreter",
  "password",
  "privatekey",
  "prototype",
  "constructor",
  "proto",
  "providermethod",
  "rawrequest",
  "script",
  "secret",
  "sessionsecret",
  "shell",
  "token",
]);

const allowedSchemaKeywords = new Set([
  "$defs",
  "$ref",
  "$schema",
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "description",
  "enum",
  "items",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "not",
  "oneOf",
  "pattern",
  "properties",
  "required",
  "title",
  "type",
  "uniqueItems",
]);

const diagnosticMessages = {
  additionalProperties: "unknown field",
  const: "value does not match the required constant",
  enum: "value is not in the allowed set",
  maxItems: "array exceeds its item bound",
  maxLength: "string exceeds its length bound",
  maxProperties: "object exceeds its property bound",
  maximum: "number exceeds its upper bound",
  minItems: "array does not meet its item bound",
  minLength: "string does not meet its length bound",
  minProperties: "object does not meet its property bound",
  minimum: "number is below its lower bound",
  not: "value matches a forbidden shape",
  oneOf: "value does not match exactly one allowed shape",
  pattern: "string does not match the required pattern",
  required: "required field is missing",
  type: "value has the wrong type",
  uniqueItems: "array items must be unique",
};

function pointerToken(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function errorPath(error) {
  if (error.keyword === "required") {
    return `${error.instancePath}/${pointerToken(error.params.missingProperty)}`;
  }
  if (error.keyword === "additionalProperties") {
    return `${error.instancePath}/${pointerToken(error.params.additionalProperty)}`;
  }
  return error.instancePath || "";
}

function ajvDiagnostics(errors) {
  return (errors ?? []).map((error) => ({
    code: `schema_${error.keyword}`,
    path: errorPath(error),
    message: diagnosticMessages[error.keyword] ?? "schema constraint failed",
  }));
}

function add(diagnostics, code, path, message) {
  diagnostics.push({ code, path, message });
}

function normalizePropertyName(name) {
  return name.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function inspectEmbeddedSchema(schema, basePath, diagnostics) {
  const seen = new Set();
  let nodes = 0;

  if (schema?.type !== "object") {
    add(diagnostics, "schema_profile_root_object", `${basePath}/type`, "embedded schema root must be an object");
  }

  function visit(node, path, depth) {
    nodes += 1;
    if (nodes > 512) {
      add(diagnostics, "schema_profile_node_limit", basePath, "schema exceeds the node limit");
      return;
    }
    if (depth > 16) {
      add(diagnostics, "schema_profile_depth_limit", path, "schema exceeds the nesting limit");
      return;
    }
    if (node === true || node === false) {
      add(diagnostics, "schema_profile_boolean_schema", path, "boolean schemas are not supported");
      return;
    }
    if (node === null || typeof node !== "object" || Array.isArray(node)) {
      add(diagnostics, "schema_profile_invalid_node", path, "schema node must be an object");
      return;
    }
    if (seen.has(node)) return;
    seen.add(node);

    for (const keyword of Object.keys(node)) {
      if (!allowedSchemaKeywords.has(keyword)) {
        add(diagnostics, "schema_profile_unknown_keyword", `${path}/${pointerToken(keyword)}`, "schema keyword is not supported");
      }
    }

    if (typeof node.$ref === "string" && !node.$ref.startsWith("#/$defs/")) {
      add(diagnostics, "schema_profile_remote_ref", `${path}/$ref`, "only local $defs references are supported");
    }
    if (typeof node.pattern === "string" && (
      node.pattern.length > 128 ||
      node.pattern.includes("(?") ||
      /\\[1-9]/.test(node.pattern) ||
      /\.(?:\*|\+)/.test(node.pattern) ||
      /\([^)]*(?:\*|\+|\{[0-9]+(?:,[0-9]*)?\})[^)]*\)(?:\*|\+|\{)/.test(node.pattern) ||
      /(?:\*|\+|\{[0-9]+(?:,[0-9]*)?\})(?:\*|\+|\{)/.test(node.pattern)
    )) {
      add(diagnostics, "schema_profile_unsafe_pattern", `${path}/pattern`, "pattern is outside the bounded regular-expression profile");
    }

    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (types.includes("object") || node.properties) {
      if (node.additionalProperties !== false) {
        add(diagnostics, "schema_profile_open_object", `${path}/additionalProperties`, "object schemas must deny unknown fields");
      }
      if (node.properties && Object.keys(node.properties).length > 128) {
        add(diagnostics, "schema_profile_property_limit", `${path}/properties`, "object schema exceeds the property limit");
      }
      for (const [name, child] of Object.entries(node.properties ?? {})) {
        if (forbiddenPropertyNames.has(normalizePropertyName(name))) {
          add(diagnostics, "schema_profile_forbidden_input", `${path}/properties/${pointerToken(name)}`, "field name can carry executable or credential authority");
        }
        visit(child, `${path}/properties/${pointerToken(name)}`, depth + 1);
      }
    }

    if (types.includes("string") && !Number.isInteger(node.maxLength)) {
      add(diagnostics, "schema_profile_unbounded_string", `${path}/maxLength`, "string schemas require maxLength");
    }
    if (types.includes("array")) {
      if (!Number.isInteger(node.maxItems)) {
        add(diagnostics, "schema_profile_unbounded_array", `${path}/maxItems`, "array schemas require maxItems");
      }
      if (!node.items) {
        add(diagnostics, "schema_profile_missing_items", `${path}/items`, "array schemas require an item schema");
      } else {
        visit(node.items, `${path}/items`, depth + 1);
      }
    }
    if (types.includes("number") || types.includes("integer")) {
      if (typeof node.minimum !== "number" || typeof node.maximum !== "number") {
        add(diagnostics, "schema_profile_unbounded_number", path, "numeric schemas require minimum and maximum");
      }
    }

    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      if (Array.isArray(node[keyword])) {
        node[keyword].forEach((child, index) => visit(child, `${path}/${keyword}/${index}`, depth + 1));
      }
    }
    if (node.not) visit(node.not, `${path}/not`, depth + 1);
    for (const [name, child] of Object.entries(node.$defs ?? {})) {
      visit(child, `${path}/$defs/${pointerToken(name)}`, depth + 1);
    }
  }

  visit(schema, basePath, 0);

  const definitions = schema?.$defs ?? {};
  const graph = new Map(Object.keys(definitions).map((name) => [name, new Set()]));
  function collectReferences(node, references) {
    if (!node || typeof node !== "object") return;
    if (typeof node.$ref === "string" && node.$ref.startsWith("#/$defs/")) {
      references.add(node.$ref.slice("#/$defs/".length).split("/")[0]);
    }
    for (const value of Object.values(node)) collectReferences(value, references);
  }
  for (const [name, definition] of Object.entries(definitions)) {
    collectReferences(definition, graph.get(name));
  }
  const visiting = new Set();
  const visited = new Set();
  function hasCycle(name) {
    if (visiting.has(name)) return true;
    if (visited.has(name) || !graph.has(name)) return false;
    visiting.add(name);
    for (const target of graph.get(name)) if (hasCycle(target)) return true;
    visiting.delete(name);
    visited.add(name);
    return false;
  }
  for (const name of graph.keys()) {
    if (hasCycle(name)) {
      add(diagnostics, "schema_profile_cyclic_ref", `${basePath}/$defs/${pointerToken(name)}`, "schema references must be acyclic");
      break;
    }
  }
}

function definitionDiagnostics(definition) {
  const diagnostics = [];
  const operation = definition.operation;
  const mutation = definition.mutation;
  const approval = definition.approval;
  const execution = definition.execution;
  const idempotency = definition.idempotency;
  const retry = definition.retry;
  const verification = definition.verification;
  const rollback = definition.rollback;
  const risk = definition.risk;

  if (!operation || !mutation || !approval || !execution || !idempotency || !retry || !verification || !rollback || !risk) {
    return diagnostics;
  }

  const reservedSegments = new Set(["command", "exec", "interpreter", "proxy", "script", "shell"]);
  for (const segment of definition.capability?.id?.split(/[._-]/) ?? []) {
    if (reservedSegments.has(segment)) {
      add(diagnostics, "definition_unrestricted_execution_identity", "/capability/id", "capability identity names execution machinery");
      break;
    }
  }

  if (operation.class === "read") {
    if (operation.effects.some((effect) => effect !== "observe")) {
      add(diagnostics, "definition_read_effect", "/operation/effects", "read capabilities may declare only observe effects");
    }
    if (mutation.mode !== "none" || mutation.destructive) {
      add(diagnostics, "definition_read_mutation", "/mutation", "read capabilities cannot declare mutation");
    }
    if (rollback.mode !== "not_applicable") {
      add(diagnostics, "definition_read_rollback", "/rollback/mode", "read capabilities use not_applicable rollback");
    }
  }

  if (operation.class === "mutate") {
    if (mutation.mode === "none") {
      add(diagnostics, "definition_mutation_mode", "/mutation/mode", "mutating capabilities require a mutation mode");
    }
    if (!operation.effects.some((effect) => effect !== "observe")) {
      add(diagnostics, "definition_mutation_effect", "/operation/effects", "mutating capabilities require a mutating effect");
    }
    if (verification.mode !== "required") {
      add(diagnostics, "definition_mutation_verification", "/verification/mode", "mutating capabilities require verification");
    }
    if (rollback.mode === "not_applicable") {
      add(diagnostics, "definition_mutation_rollback", "/rollback/mode", "mutating capabilities must declare rollback behavior");
    }
  }

  if (approval.mode === "never" && (operation.class !== "read" || mutation.destructive)) {
    add(diagnostics, "definition_approval_never", "/approval/mode", "approval never is limited to non-destructive reads");
  }
  if (mutation.destructive && (
    operation.class !== "mutate" || approval.mode !== "explicit" ||
    execution.max_attempts !== 1 || retry.policy !== "never"
  )) {
    add(diagnostics, "definition_destructive_controls", "/mutation/destructive", "destructive mutation requires explicit approval, one attempt, and no retry");
  }
  if (rollback.mode === "unavailable") {
    if (!new Set(["high", "critical"]).has(risk.level) || approval.mode !== "explicit" || execution.max_attempts !== 1 || retry.policy !== "never") {
      add(diagnostics, "definition_unavailable_rollback_controls", "/rollback/mode", "unavailable rollback requires elevated risk controls");
    }
    for (const field of ["rationale", "recovery", "stop_conditions"]) {
      if (rollback[field] === undefined) {
        add(diagnostics, "definition_unavailable_rollback_field", `/rollback/${field}`, "unavailable rollback requires recovery metadata");
      }
    }
  }
  if (idempotency.classification === "keyed" && idempotency.key === "forbidden") {
    add(diagnostics, "definition_idempotency_key", "/idempotency/key", "keyed idempotency requires a key");
  }
  if (idempotency.classification !== "keyed" && idempotency.key !== "forbidden") {
    add(diagnostics, "definition_idempotency_key", "/idempotency/key", "only keyed idempotency accepts a key");
  }
  if (idempotency.classification === "non_idempotent" && (execution.max_attempts !== 1 || retry.policy !== "never")) {
    add(diagnostics, "definition_non_idempotent_retry", "/retry/policy", "non-idempotent capabilities allow one attempt and no retry");
  }
  if (execution.concurrency === "unrestricted_read" && operation.class !== "read") {
    add(diagnostics, "definition_concurrency", "/execution/concurrency", "unrestricted_read concurrency is limited to read capabilities");
  }

  for (const [field, schema] of [["input", definition.input?.schema], ["output", definition.output?.schema]]) {
    const before = diagnostics.length;
    inspectEmbeddedSchema(schema, `/${field}/schema`, diagnostics);
    if (diagnostics.length === before) {
      try {
        new Ajv2020({ allErrors: true, strict: true }).compile(schema);
      } catch {
        add(diagnostics, "schema_profile_compile_error", `/${field}/schema`, "schema does not compile under the supported profile");
      }
    }
  }
  return diagnostics;
}

function sortDiagnostics(diagnostics) {
  return diagnostics
    .map((diagnostic, index) => ({ ...diagnostic, index }))
    .sort((left, right) =>
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code) ||
      left.index - right.index,
    )
    .slice(0, 64)
    .map(({ index: _index, ...diagnostic }) => diagnostic);
}

export function validateRecord(kind, value) {
  const validator = validators.get(kind);
  if (!validator) {
    throw new TypeError(`unsupported record kind: ${kind}`);
  }
  const valid = validator(value);
  const diagnostics = ajvDiagnostics(validator.errors);
  if (valid && kind === "definition") {
    diagnostics.push(...definitionDiagnostics(value));
  }
  const ordered = sortDiagnostics(diagnostics);
  return { valid: ordered.length === 0, diagnostics: ordered };
}

export function validateRequestAgainstDefinition(request, definition) {
  const diagnostics = [];
  const requestResult = validateRecord("request", request);
  const definitionResult = validateRecord("definition", definition);
  diagnostics.push(...requestResult.diagnostics, ...definitionResult.diagnostics);
  if (diagnostics.length > 0) return { valid: false, diagnostics: sortDiagnostics(diagnostics) };

  if (request.capability.id !== definition.capability.id || request.capability.version !== definition.capability.version) {
    add(diagnostics, "request_capability_mismatch", "/capability", "request does not select the exact definition");
  }
  if (!definition.resource.kinds.includes(request.resource.kind)) {
    add(diagnostics, "request_resource_kind", "/resource/kind", "resource kind is outside the capability scope");
  }
  if (definition.resource.cardinality === "one" && !request.resource.ref) {
    add(diagnostics, "request_resource_cardinality", "/resource", "capability requires exactly one resource");
  }
  if (definition.resource.cardinality === "many") {
    if (!request.resource.refs) {
      add(diagnostics, "request_resource_cardinality", "/resource", "capability requires a bounded resource set");
    } else if (request.resource.refs.length > definition.resource.max_items) {
      add(diagnostics, "request_resource_limit", "/resource/refs", "resource set exceeds the capability limit");
    }
  }
  if (Buffer.byteLength(JSON.stringify(request.input), "utf8") > definition.execution.max_input_bytes) {
    add(diagnostics, "request_input_byte_limit", "/input", "input exceeds the capability byte limit");
  }
  const keyMode = definition.idempotency.key;
  if (keyMode === "required" && !request.idempotency_key) {
    add(diagnostics, "request_idempotency_key_required", "/idempotency_key", "idempotency key is required");
  }
  if (keyMode === "forbidden" && request.idempotency_key != null) {
    add(diagnostics, "request_idempotency_key_forbidden", "/idempotency_key", "idempotency key is forbidden");
  }

  const inputValidator = new Ajv2020({ allErrors: true, strict: true }).compile(definition.input.schema);
  if (!inputValidator(request.input)) {
    diagnostics.push(...ajvDiagnostics(inputValidator.errors).map((diagnostic) => ({
      ...diagnostic,
      path: `/input${diagnostic.path}`,
    })));
  }
  return { valid: diagnostics.length === 0, diagnostics: sortDiagnostics(diagnostics) };
}

export function validateOutputAgainstDefinition(output, definition) {
  const definitionResult = validateRecord("definition", definition);
  if (!definitionResult.valid) return definitionResult;

  if (Buffer.byteLength(JSON.stringify(output), "utf8") > definition.execution.max_output_bytes) {
    return {
      valid: false,
      diagnostics: [{ code: "output_byte_limit", path: "/output", message: "output exceeds the capability byte limit" }],
    };
  }
  const outputValidator = new Ajv2020({ allErrors: true, strict: true }).compile(definition.output.schema);
  if (outputValidator(output)) return { valid: true, diagnostics: [] };
  return {
    valid: false,
    diagnostics: sortDiagnostics(ajvDiagnostics(outputValidator.errors).map((diagnostic) => ({
      ...diagnostic,
      path: `/output${diagnostic.path}`,
    }))),
  };
}

export function validateResultAgainstDefinition(result, definition) {
  const diagnostics = [];
  const resultResult = validateRecord("result", result);
  const definitionResult = validateRecord("definition", definition);
  diagnostics.push(...resultResult.diagnostics, ...definitionResult.diagnostics);
  if (diagnostics.length > 0) return { valid: false, diagnostics: sortDiagnostics(diagnostics) };

  if (result.capability.id !== definition.capability.id || result.capability.version !== definition.capability.version) {
    add(diagnostics, "result_capability_mismatch", "/capability", "result does not identify the exact definition");
  }
  if (result.attempts > definition.execution.max_attempts) {
    add(diagnostics, "result_attempt_limit", "/attempts", "result exceeds the definition attempt limit");
  }
  if (result.status === "succeeded" && definition.operation.class === "mutate" && result.verification.status !== "verified") {
    add(diagnostics, "result_mutation_unverified", "/verification/status", "mutating success requires verified postconditions");
  }
  if (result.output !== null) {
    diagnostics.push(...validateOutputAgainstDefinition(result.output, definition).diagnostics);
  }
  return { valid: diagnostics.length === 0, diagnostics: sortDiagnostics(diagnostics) };
}
