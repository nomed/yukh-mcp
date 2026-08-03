import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildAuthorizationEvidence, buildAuthorizationRequest, combineAuthorization,
  createDecisionEnforcer, validateAuthorizationRecord,
} from "../../contracts/authorization/v1/authorization.mjs";

const definition = JSON.parse(readFileSync(new URL("../../contracts/capability/v1/examples/read-definition.json", import.meta.url)));
const zero = `sha256:${"0".repeat(64)}`;
const one = `sha256:${"1".repeat(64)}`;

function request(overrides = {}) {
  return buildAuthorizationRequest({
    authorization_request_id: "authreq_example001",
    subject: { ref: "subject_example001", kind: "workload", authentication_context_ref: "authctx_example001", authentication_strength: "workload_attested" },
    definition,
    resource: { kind: "node", refs: ["node-example-01"], attributes_digest: zero },
    environment: { ref: "development", attributes_digest: one },
    normalized_input: { include: ["health"] }, risk: "low", requested_at: "2026-08-03T00:00:00Z",
    policy: { bundle_ref: "policy_example001", revision: 17, digest: zero },
    attributes: { snapshot_ref: "attrs_example001", digest: one, observed_at: "2026-08-03T00:00:00Z" },
    ...overrides,
  });
}

function evaluation(req, statements) {
  return { evaluation_version: 1, authorization_request_id: req.authorization_request_id, request_digest: req.request_digest,
    policy: structuredClone(req.policy), evaluator_ref: "impl_evaluator_reference001", evaluated_at: "2026-08-03T00:00:01Z", statements };
}

function statement(effect, reason_code, extra = {}) {
  return { statement_ref: `stmt_${effect}_${reason_code}`, effect, reason_code, constraints: [], obligations: [], ...extra };
}

function decide(req, evaln, id = "decision_example001") {
  return combineAuthorization({ request: req, evaluation: evaln, decision_id: id, issued_at: "2026-08-03T00:00:02Z", expires_at: "2026-08-03T00:00:30Z" });
}

test("an exact explicit allow authorizes", () => {
  const req = request();
  const decision = decide(req, evaluation(req, [statement("allow", "policy_allow_read")]));
  assert.equal(decision.effect, "allow");
  assert.deepEqual(validateAuthorizationRecord("decision", decision), { valid: true, diagnostics: [] });
});

test("explicit deny overrides allow independent of order", () => {
  const req = request();
  const allow = statement("allow", "policy_allow_read");
  const deny = statement("deny", "policy_deny_scope");
  for (const statements of [[allow, deny], [deny, allow]]) {
    const decision = decide(req, evaluation(req, statements));
    assert.equal(decision.effect, "deny"); assert.equal(decision.basis, "explicit");
    assert.equal(validateAuthorizationRecord("decision", decision).valid, true);
  }
});

test("no applicable allow is default deny", () => {
  const req = request();
  const decision = decide(req, evaluation(req, []));
  assert.deepEqual([decision.effect, decision.basis], ["deny", "default"]);
  assert.equal(validateAuthorizationRecord("decision", decision).valid, true);
});

test("malformed or mismatched evaluation fails closed", () => {
  const req = request();
  const evaln = evaluation(req, [statement("allow", "policy_allow_read")]);
  evaln.request_digest = one;
  const decision = decide(req, evaln);
  assert.deepEqual([decision.effect, decision.basis], ["deny", "error"]);
  assert.equal(validateAuthorizationRecord("decision", decision).valid, true);
});

test("multi-resource authorization is all-or-nothing", () => {
  const req = request({ resource: { kind: "node", refs: ["node-a", "node-b"], attributes_digest: zero } });
  const evaln = evaluation(req, [statement("allow", "policy_allow_a", { resource_refs: ["node-a"] })]);
  assert.deepEqual([decide(req, evaln).effect, decide(req, evaln).basis], ["deny", "default"]);
  evaln.statements.push(statement("allow", "policy_allow_b", { resource_refs: ["node-b"] }));
  assert.equal(decide(req, evaln).effect, "allow");
});

test("constraints intersect and obligations accumulate at strongest value", () => {
  const req = request();
  const evaln = evaluation(req, [
    statement("allow", "policy_allow_one", { constraints: [{ type: "output_fields", value: ["health", "uptime"] }], obligations: [{ type: "redaction_profile", value: "standard" }] }),
    statement("allow", "policy_allow_two", { constraints: [{ type: "output_fields", value: ["health"] }], obligations: [{ type: "redaction_profile", value: "strict" }] }),
  ]);
  const decision = decide(req, evaln);
  assert.deepEqual(decision.constraints, [{ type: "output_fields", value: ["health"] }]);
  assert.deepEqual(decision.obligations, [{ type: "redaction_profile", value: "strict" }]);
});

test("empty constraint intersection is indeterminate deny", () => {
  const req = request();
  const evaln = evaluation(req, [
    statement("allow", "policy_allow_one", { constraints: [{ type: "output_fields", value: ["health"] }] }),
    statement("allow", "policy_allow_two", { constraints: [{ type: "output_fields", value: ["uptime"] }] }),
  ]);
  const decision = decide(req, evaln);
  assert.deepEqual([decision.effect, decision.basis], ["deny", "indeterminate"]);
  assert.equal(validateAuthorizationRecord("decision", decision).valid, true);
});

test("one-shot enforcement rejects replay and every changed binding", () => {
  const req = request();
  const evaln = evaluation(req, [statement("allow", "policy_allow_read")]);
  const variants = [
    { subject: { ...req.subject, ref: "subject_other001" } },
    { resource: { kind: "node", refs: ["node-other"], attributes_digest: req.resource.attributes_digest } },
    { environment: { ...req.environment, ref: "production" } },
    { policy: { ...req.policy, revision: 18 } },
  ];
  for (const [index, change] of variants.entries()) {
    const decision = decide(req, evaln, `decision_variant00${index}`);
    const changed = structuredClone(req); Object.assign(changed, change);
    assert.equal(createDecisionEnforcer()({ decision, request: changed, now: "2026-08-03T00:00:03Z" }).allowed, false);
  }
  const decision = decide(req, evaln, "decision_replay001");
  const enforce = createDecisionEnforcer();
  assert.equal(enforce({ decision, request: req, now: "2026-08-03T00:00:03Z" }).allowed, true);
  assert.deepEqual(enforce({ decision, request: req, now: "2026-08-03T00:00:04Z" }), { allowed: false, code: "decision_already_consumed" });
});

test("unfulfilled obligations block before invocation", () => {
  const req = request();
  const evaln = evaluation(req, [statement("allow", "policy_allow_read", { obligations: [{ type: "approval_required", value: "standard" }] })]);
  const decision = decide(req, evaln);
  assert.deepEqual(createDecisionEnforcer()({ decision, request: req, now: "2026-08-03T00:00:03Z" }), { allowed: false, code: "obligation_pending" });
  assert.deepEqual(createDecisionEnforcer()({ decision, request: req, now: "2026-08-03T00:00:03Z", obligation_receipts: [{ type: "approval_required", value: "standard", decision_id: decision.decision_id }] }), { allowed: false, code: "obligation_pending" });
});

test("a constraint without its registered handler fails closed", () => {
  const req = request();
  const evaln = evaluation(req, [statement("allow", "policy_allow_read", { constraints: [{ type: "max_output_bytes", value: 1024 }] })]);
  const decision = decide(req, evaln);
  assert.deepEqual(createDecisionEnforcer()({ decision, request: req, now: "2026-08-03T00:00:03Z" }), { allowed: false, code: "constraint_unenforceable" });
  assert.equal(createDecisionEnforcer()({ decision, request: req, now: "2026-08-03T00:00:03Z", constraint_handlers: { max_output_bytes: (value) => value === 1024 } }).allowed, true);
});

test("deny monotonicity holds across generated statement permutations", () => {
  const req = request();
  const base = [statement("allow", "policy_allow_read"), statement("allow", "policy_allow_second")];
  for (let seed = 0; seed < 32; seed++) {
    const ordered = seed % 2 ? [...base].reverse() : [...base];
    assert.equal(decide(req, evaluation(req, ordered), `decision_allow${seed}`).effect, "allow");
    ordered.splice(seed % 3, 0, statement("deny", "policy_deny_generated"));
    assert.equal(decide(req, evaluation(req, ordered), `decision_deny${seed}`).effect, "deny");
  }
});

test("sanitized evidence contains digests, not policy or attribute values", () => {
  const req = request(); const evaln = evaluation(req, []); const decision = decide(req, evaln);
  const evidence = buildAuthorizationEvidence({ evidence_id: "evidence_example001", request: req, decision, evaluation: evaln, enforcement: "denied" });
  assert.deepEqual(validateAuthorizationRecord("evidence", evidence), { valid: true, diagnostics: [] });
  assert.equal(JSON.stringify(evidence).includes("raw_attributes"), false);
});
