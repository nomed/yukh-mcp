import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const here = dirname(fileURLToPath(import.meta.url));
const capabilitySchemas = join(here, "../../capability/v1/schemas");
const recordNames = ["request", "evaluation", "decision", "evidence"];
const schemas = new Map();
for (const [name, path] of [
  ["capability-common", join(capabilitySchemas, "common.schema.json")],
  ["common", join(here, "schemas/common.schema.json")],
  ...recordNames.map((name) => [name, join(here, `schemas/${name}.schema.json`)]),
])
  schemas.set(name, JSON.parse(readFileSync(path, "utf8")));

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
for (const schema of schemas.values()) ajv.addSchema(schema);
const validators = new Map(recordNames.map((name) => [name, ajv.getSchema(schemas.get(name).$id)]));

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function digest(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function without(value, field) {
  const copy = structuredClone(value);
  delete copy[field];
  return copy;
}

function diagnosticPath(error) {
  if (error.keyword === "required") return `${error.instancePath}/${error.params.missingProperty}`;
  if (error.keyword === "additionalProperties")
    return `${error.instancePath}/${error.params.additionalProperty}`;
  return error.instancePath;
}

export function validateAuthorizationRecord(kind, value) {
  const validator = validators.get(kind);
  if (!validator) throw new TypeError(`unsupported authorization record kind: ${kind}`);
  const schemaValid = validator(value);
  const diagnostics = (validator.errors ?? []).map((error) => ({
    code: `schema_${error.keyword}`,
    path: diagnosticPath(error),
    message: "authorization schema constraint failed",
  }));
  if (
    schemaValid &&
    kind === "request" &&
    digest(without(value, "request_digest")) !== value.request_digest
  ) {
    diagnostics.push({
      code: "request_digest_mismatch",
      path: "/request_digest",
      message: "request digest does not match canonical content",
    });
  }
  if (schemaValid && kind === "decision") {
    if (digest(without(value, "decision_digest")) !== value.decision_digest)
      diagnostics.push({
        code: "decision_digest_mismatch",
        path: "/decision_digest",
        message: "decision digest does not match canonical content",
      });
    if (value.effect === "allow" && value.basis !== "explicit")
      diagnostics.push({
        code: "decision_effect_basis",
        path: "/basis",
        message: "only an explicit decision may allow",
      });
  }
  diagnostics.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
  return { valid: diagnostics.length === 0, diagnostics: diagnostics.slice(0, 64) };
}

export function buildAuthorizationRequest({
  authorization_request_id,
  subject,
  definition,
  resource,
  environment,
  normalized_input,
  risk,
  requested_at,
  policy,
  attributes,
}) {
  const request = {
    authorization_request_version: 1,
    authorization_request_id,
    subject: structuredClone(subject),
    action: {
      capability: { id: definition.capability.id, version: definition.capability.version },
      definition_digest: digest(definition),
      operation_class: definition.operation.class,
      effects: [...definition.operation.effects].sort(),
      approval_mode: definition.approval.mode,
    },
    resource: {
      kind: resource.kind,
      refs: [...new Set(resource.refs)].sort(),
      attributes_digest: resource.attributes_digest,
    },
    environment: structuredClone(environment),
    request_context: { normalized_input_digest: digest(normalized_input), risk, requested_at },
    policy: structuredClone(policy),
    attributes: structuredClone(attributes),
  };
  request.request_digest = digest(request);
  const result = validateAuthorizationRecord("request", request);
  if (!result.valid)
    throw new TypeError(
      `invalid authorization request: ${result.diagnostics.map(({ code }) => code).join(",")}`,
    );
  return request;
}

const obligationRanks = {
  approval_required: ["standard", "elevated", "destructive"],
  evidence_profile: ["standard_read", "standard_mutation", "enhanced"],
  verification_profile: ["schema_only", "declared_postconditions", "independent"],
  redaction_profile: ["standard", "strict", "metadata_only"],
  concurrency_profile: ["per_subject", "per_resource", "exclusive_scope"],
};
const dataRanks = ["public", "operational_metadata", "internal", "restricted"];

function intersectValues(groups) {
  return groups.reduce((left, right) =>
    left.filter((value) => right.some((candidate) => canonical(candidate) === canonical(value))),
  );
}

function combineConstraints(items) {
  const grouped = Map.groupBy(items, (item) =>
    item.type === "input_value_set" ? `${item.type}:${item.value.path}` : item.type,
  );
  const result = [];
  for (const group of grouped.values()) {
    const type = group[0].type;
    let value;
    if (
      ["max_result_items", "max_output_bytes", "decision_ttl_ms", "concurrency_limit"].includes(
        type,
      )
    )
      value = Math.min(...group.map((item) => item.value));
    else if (type === "output_data_class")
      value = dataRanks[Math.max(...group.map((item) => dataRanks.indexOf(item.value)))];
    else if (["output_fields", "allowed_resource_refs"].includes(type))
      value = intersectValues(group.map((item) => item.value));
    else if (type === "time_window")
      value = {
        not_before: group
          .map((item) => item.value.not_before)
          .sort()
          .at(-1),
        not_after: group.map((item) => item.value.not_after).sort()[0],
      };
    else if (type === "input_value_set")
      value = {
        path: group[0].value.path,
        values: intersectValues(group.map((item) => item.value.values)),
      };
    else return null;
    if (
      (Array.isArray(value) && value.length === 0) ||
      (type === "input_value_set" && value.values.length === 0) ||
      (type === "time_window" && value.not_before >= value.not_after)
    )
      return null;
    result.push({ type, value });
  }
  return result.sort(
    (a, b) => a.type.localeCompare(b.type) || canonical(a.value).localeCompare(canonical(b.value)),
  );
}

function combineObligations(items) {
  const grouped = Map.groupBy(items, (item) => item.type);
  const result = [];
  for (const [type, group] of grouped) {
    const ranks = obligationRanks[type];
    if (!ranks) return null;
    const index = Math.max(...group.map((item) => ranks.indexOf(item.value)));
    if (index < 0) return null;
    result.push({ type, value: ranks[index] });
  }
  return result.sort((a, b) => a.type.localeCompare(b.type));
}

function same(left, right) {
  return canonical(left) === canonical(right);
}

export function combineAuthorization({ request, evaluation, decision_id, issued_at, expires_at }) {
  const requestResult = validateAuthorizationRecord("request", request);
  const evaluationResult = validateAuthorizationRecord("evaluation", evaluation);
  let basis = "default";
  let reasons = ["no_applicable_allow"];
  let constraints = [];
  let obligations = [];
  let allow = false;
  const bindingValid =
    evaluationResult.valid &&
    requestResult.valid &&
    evaluation.authorization_request_id === request.authorization_request_id &&
    evaluation.request_digest === request.request_digest &&
    same(evaluation.policy, request.policy);

  if (!bindingValid) {
    basis = "error";
    reasons = ["evaluation_invalid_or_mismatched"];
  } else {
    const requested = new Set(request.resource.refs);
    const semanticInvalid = evaluation.statements.some(
      (statement) =>
        (request.resource.refs.length > 1 && !statement.resource_refs) ||
        statement.resource_refs?.some((ref) => !requested.has(ref)),
    );
    const applicable = (resourceRef) =>
      evaluation.statements.filter(
        (statement) => !statement.resource_refs || statement.resource_refs.includes(resourceRef),
      );
    const resourceGroups = request.resource.refs.map(applicable);
    if (semanticInvalid) {
      basis = "error";
      reasons = ["evaluation_invalid_or_mismatched"];
    } else if (
      resourceGroups.some((group) => group.some((statement) => statement.effect === "deny"))
    ) {
      basis = "explicit";
      reasons = evaluation.statements
        .filter((statement) => statement.effect === "deny")
        .map((statement) => statement.reason_code)
        .sort()
        .filter((v, i, a) => i === 0 || v !== a[i - 1]);
    } else if (
      resourceGroups.some((group) => !group.some((statement) => statement.effect === "allow"))
    ) {
      basis = "default";
      reasons = ["no_applicable_allow"];
    } else {
      const allows = resourceGroups.flatMap((group) =>
        group.filter((statement) => statement.effect === "allow"),
      );
      constraints = combineConstraints(allows.flatMap((statement) => statement.constraints));
      obligations = combineObligations(allows.flatMap((statement) => statement.obligations));
      if (!constraints || !obligations) {
        basis = "indeterminate";
        reasons = ["policy_result_unenforceable"];
        constraints = [];
        obligations = [];
      } else {
        allow = true;
        basis = "explicit";
        reasons = [...new Set(allows.map((statement) => statement.reason_code))].sort();
      }
    }
  }

  if (allow && request.action.approval_mode === "explicit") {
    obligations = combineObligations([
      ...obligations,
      {
        type: "approval_required",
        value: request.request_context.risk === "critical" ? "destructive" : "elevated",
      },
    ]);
  }
  const ttl = constraints?.find(({ type }) => type === "decision_ttl_ms")?.value;
  if (
    allow &&
    (!Number.isFinite(Date.parse(issued_at)) ||
      !Number.isFinite(Date.parse(expires_at)) ||
      Date.parse(expires_at) <= Date.parse(issued_at) ||
      (ttl && Date.parse(expires_at) - Date.parse(issued_at) > ttl))
  ) {
    allow = false;
    basis = "indeterminate";
    reasons = ["decision_lifetime_invalid"];
    constraints = [];
    obligations = [];
  }
  const decision = {
    authorization_decision_version: 1,
    decision_id,
    authorization_request_id: request.authorization_request_id,
    request_digest: request.request_digest,
    effect: allow ? "allow" : "deny",
    basis,
    reason_codes: reasons,
    subject_ref: request.subject.ref,
    authentication_context_ref: request.subject.authentication_context_ref,
    action: structuredClone(request.action),
    resource: { kind: request.resource.kind, refs: [...request.resource.refs] },
    environment_ref: request.environment.ref,
    policy: structuredClone(request.policy),
    attribute_snapshot_ref: request.attributes.snapshot_ref,
    constraints,
    obligations,
    issued_at,
    expires_at,
    evaluator_ref: evaluation?.evaluator_ref ?? "impl_unavailable",
  };
  decision.decision_digest = digest(decision);
  return decision;
}

function decisionMatchesRequest(decision, request) {
  return (
    decision.authorization_request_id === request.authorization_request_id &&
    decision.request_digest === request.request_digest &&
    decision.subject_ref === request.subject.ref &&
    decision.authentication_context_ref === request.subject.authentication_context_ref &&
    same(decision.action, request.action) &&
    same(decision.resource, { kind: request.resource.kind, refs: request.resource.refs }) &&
    decision.environment_ref === request.environment.ref &&
    same(decision.policy, request.policy) &&
    decision.attribute_snapshot_ref === request.attributes.snapshot_ref
  );
}

export function createDecisionEnforcer() {
  const consumed = new Set();
  return function enforce({
    decision,
    request,
    now,
    obligation_receipts = [],
    constraint_handlers = {},
    approval_receipt_verifier,
  }) {
    if (consumed.has(decision.decision_id))
      return { allowed: false, code: "decision_already_consumed" };
    consumed.add(decision.decision_id);
    if (
      !validateAuthorizationRecord("request", request).valid ||
      !validateAuthorizationRecord("decision", decision).valid ||
      !decisionMatchesRequest(decision, request)
    )
      return { allowed: false, code: "decision_binding_mismatch" };
    if (decision.effect !== "allow") return { allowed: false, code: "authorization_denied" };
    const nowMillis = Date.parse(now);
    if (
      !Number.isFinite(nowMillis) ||
      nowMillis < Date.parse(decision.issued_at) ||
      nowMillis >= Date.parse(decision.expires_at)
    )
      return { allowed: false, code: "decision_stale" };
    const window = decision.constraints.find(({ type }) => type === "time_window")?.value;
    if (window) {
      const notBefore = Date.parse(window.not_before);
      const notAfter = Date.parse(window.not_after);
      if (
        !Number.isFinite(notBefore) ||
        !Number.isFinite(notAfter) ||
        nowMillis < notBefore ||
        nowMillis >= notAfter
      ) {
        return { allowed: false, code: "constraint_failed" };
      }
    }
    for (const constraint of decision.constraints) {
      if (constraint.type === "time_window") continue;
      const handler = constraint_handlers[constraint.type];
      if (typeof handler !== "function") {
        return { allowed: false, code: "constraint_unenforceable" };
      }
      try {
        if (handler(structuredClone(constraint.value)) !== true)
          return { allowed: false, code: "constraint_unenforceable" };
      } catch {
        return { allowed: false, code: "constraint_unenforceable" };
      }
    }
    if (new Set(obligation_receipts.map(({ type }) => type)).size !== obligation_receipts.length)
      return { allowed: false, code: "obligation_pending" };
    const receipts = new Map(obligation_receipts.map((receipt) => [receipt.type, receipt]));
    for (const obligation of decision.obligations) {
      const receipt = receipts.get(obligation.type);
      if (
        !receipt ||
        receipt.decision_id !== decision.decision_id ||
        receipt.value !== obligation.value
      )
        return { allowed: false, code: "obligation_pending" };
      if (obligation.type === "approval_required") {
        if (typeof approval_receipt_verifier !== "function")
          return { allowed: false, code: "obligation_pending" };
        try {
          if (approval_receipt_verifier(receipt, decision, request) !== true)
            return { allowed: false, code: "obligation_pending" };
        } catch {
          return { allowed: false, code: "obligation_pending" };
        }
      }
    }
    return { allowed: true, code: "authorized" };
  };
}

export function buildAuthorizationEvidence({
  evidence_id,
  request,
  decision,
  evaluation,
  enforcement,
  obligation_receipt_refs = [],
}) {
  return {
    authorization_evidence_version: 1,
    evidence_id,
    authorization_request_id: request.authorization_request_id,
    request_digest: request.request_digest,
    decision_id: decision.decision_id,
    decision_digest: decision.decision_digest,
    effect: decision.effect,
    basis: decision.basis,
    reason_codes: [...decision.reason_codes],
    subject_ref: request.subject.ref,
    authentication_context_ref: request.subject.authentication_context_ref,
    action: structuredClone(request.action),
    resource: { kind: request.resource.kind, refs: [...request.resource.refs] },
    environment_ref: request.environment.ref,
    policy: structuredClone(request.policy),
    attribute_snapshot_ref: request.attributes.snapshot_ref,
    attribute_snapshot_digest: request.attributes.digest,
    constraints_digest: digest(decision.constraints),
    obligations: structuredClone(decision.obligations),
    evaluator_ref: decision.evaluator_ref,
    evaluated_at: evaluation.evaluated_at,
    enforcement,
    obligation_receipt_refs: [...obligation_receipt_refs].sort(),
  };
}
