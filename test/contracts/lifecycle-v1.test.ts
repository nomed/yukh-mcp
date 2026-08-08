import assert from "node:assert/strict";
import test from "node:test";
import {
  LifecycleContractError,
  lifecycleDigest,
  validateApprovalReceipt,
  validateExecutionRecord,
  validateLifecycleRecord,
  validateMutationPlan,
  validateRollbackRecord,
  validateVerificationRecord,
  type ExecutionRecordV1,
  type MutationPlanV1,
  type VerificationRecordV1,
} from "../../packages/lifecycle/src/contract.js";
import {
  LATER,
  NOW,
  approvalFixture,
  digest,
  planFixture,
  rollbackPlanFixture,
  rollbackRecordFixture,
  sealPlan,
} from "../runtime/lifecycle-test-fixtures.js";

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

function mutable<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

function resealRecord(value: Record<string, unknown>, digestKey: string) {
  const base = Object.fromEntries(Object.entries(value).filter(([key]) => key !== digestKey));
  return { ...base, [digestKey]: lifecycleDigest(base) };
}

function executionFixture(plan: MutationPlanV1): ExecutionRecordV1 {
  const base = {
    execution_record_version: 1 as const,
    execution_ref: "execution_example001",
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    authorization_request_id: "authreq_apply001",
    authorization_request_digest: digest("apply-request"),
    authorization_decision_id: "decision_apply001",
    authorization_decision_digest: digest("apply-decision"),
    approval_id: "approval_example001",
    approval_digest: digest("approval"),
    reservation_ref: "reservation_example001",
    reservation_digest: digest("reservation"),
    attempt: 1,
    started_at: NOW,
    completed_at: LATER,
    steps: [
      {
        step_id: plan.operations[0]?.step_id,
        state: "effect_observed",
        reason_code: "effect_observed",
        evidence_refs: ["evidence_effect001"],
      },
    ],
    aggregate_outcome: "effect_observed",
  };
  return validateExecutionRecord({ ...base, execution_digest: lifecycleDigest(base) }, plan);
}

function verificationFixture(
  plan: MutationPlanV1,
  execution: ExecutionRecordV1,
): VerificationRecordV1 {
  const base = {
    verification_record_version: 1 as const,
    verification_ref: "verification_example001",
    execution_ref: execution.execution_ref,
    execution_digest: execution.execution_digest,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    verifier_ref: plan.verification.verifier_ref,
    profile: plan.verification.profile,
    started_at: LATER,
    completed_at: "2026-08-08T07:07:00Z",
    observations: plan.postconditions.map((condition) => ({
      condition_ref: condition.condition_ref,
      status: "verified" as const,
      observation_digest: condition.expected_digest,
      evidence_ref: "evidence_verification001",
      observed_at: LATER,
    })),
    outcome: "verified" as const,
  };
  return validateVerificationRecord(
    { ...base, verification_digest: lifecycleDigest(base) },
    execution,
    plan,
  );
}

test("closed lifecycle records validate canonical digests and freeze deeply", () => {
  const plan = planFixture();
  const approval = approvalFixture(plan);
  const execution = executionFixture(plan);
  const verification = verificationFixture(plan, execution);
  const rollbackPlan = rollbackPlanFixture(plan, execution);
  const rollback = rollbackRecordFixture(rollbackPlan);

  assert.deepEqual(validateLifecycleRecord("plan", plan), plan);
  assert.deepEqual(validateLifecycleRecord("approval", approval), approval);
  assert.deepEqual(validateLifecycleRecord("execution", execution), execution);
  assert.deepEqual(validateLifecycleRecord("verification", verification), verification);
  assert.deepEqual(validateLifecycleRecord("rollback", rollback), rollback);
  assert(Object.isFrozen(plan));
  assert(Object.isFrozen(plan.operations));
  assert(Object.isFrozen(approval.bindings));
  assert.equal(
    approval.bindings.planning_authorization_request_digest,
    plan.planning_authorization.request_digest,
  );
  assert.equal(approval.bindings.normalized_input_digest, plan.request.normalized_input_digest);
});

test("unknown fields and digest substitution fail closed for every record", () => {
  const plan = planFixture();
  const approval = approvalFixture(plan);
  const execution = executionFixture(plan);
  const verification = verificationFixture(plan, execution);
  const rollback = rollbackRecordFixture(rollbackPlanFixture(plan, execution));
  for (const [kind, record] of [
    ["plan", plan],
    ["approval", approval],
    ["execution", execution],
    ["verification", verification],
    ["rollback", rollback],
  ] as const) {
    assert.throws(
      () => validateLifecycleRecord(kind, { ...record, unexpected: true }),
      LifecycleContractError,
    );
    const digestKey = Object.keys(record).find((key) => key.endsWith("_digest"));
    assert(digestKey);
    assert.throws(
      () => validateLifecycleRecord(kind, { ...record, [digestKey]: digest("substituted") }),
      LifecycleContractError,
    );
  }
});

test("approval is bound to every exact plan security dimension", () => {
  const original = planFixture();
  const approval = approvalFixture(original);
  const variants: MutationPlanV1[] = [];

  variants.push(
    sealPlan({
      ...structuredClone(original),
      request: {
        ...original.request,
        request_digest: digest("changed-request"),
      },
    }),
  );
  variants.push(
    sealPlan({
      ...structuredClone(original),
      subject: {
        ...original.subject,
        ref: "subject_other001",
      },
    }),
  );
  variants.push(
    sealPlan({
      ...structuredClone(original),
      capability: {
        ...original.capability,
        version: "1.0.1",
      },
    }),
  );
  variants.push(
    sealPlan({
      ...structuredClone(original),
      capability: {
        ...original.capability,
        definition_digest: digest("changed-definition"),
      },
    }),
  );
  variants.push(
    sealPlan({
      ...structuredClone(original),
      scope: {
        ...original.scope,
        resource_refs: ["setting-example-02"],
        resource_set_digest: digest("changed-resource-set"),
      },
      predicted_effects: original.predicted_effects.map((effect) => ({
        ...effect,
        resource_set_digest: digest("changed-resource-set"),
      })),
    }),
  );
  variants.push(
    sealPlan({
      ...structuredClone(original),
      scope: {
        ...original.scope,
        environment_ref: "staging",
      },
    }),
  );
  variants.push(
    sealPlan({
      ...structuredClone(original),
      policy: {
        ...original.policy,
        revision: 18,
        digest: digest("changed-policy"),
      },
    }),
  );
  variants.push(
    sealPlan({
      ...structuredClone(original),
      attributes: {
        ...original.attributes,
        digest: digest("changed-attributes"),
      },
    }),
  );
  variants.push(
    sealPlan({
      ...structuredClone(original),
      target_snapshot: {
        ...original.target_snapshot,
        digest: digest("changed-target"),
      },
    }),
  );
  const changedOperation = mutable(original);
  const firstOperation = changedOperation.operations[0];
  assert(firstOperation);
  firstOperation.effect = "emit";
  changedOperation.capability.effects = ["emit"];
  const predicted = changedOperation.predicted_effects[0];
  assert(predicted);
  changedOperation.predicted_effects[0] = {
    ...predicted,
    effect: "emit",
  };
  variants.push(sealPlan(changedOperation));

  for (const variant of variants) {
    assert.throws(
      () => validateApprovalReceipt(approval, variant, NOW),
      (error: unknown) =>
        error instanceof LifecycleContractError && error.code === "approval_denied",
    );
  }
});

test("operation ordering, operation-set digest, and dependencies are authoritative", () => {
  const plan = mutable(planFixture());
  const first = plan.operations[0];
  assert(first);
  plan.operations[0] = {
    ...first,
    operation_digest: digest("wrong-operation"),
  };
  const resealed = resealRecord(plan as unknown as Record<string, unknown>, "plan_digest");
  assert.throws(() => validateMutationPlan(resealed), LifecycleContractError);

  const missingDependency = mutable(planFixture());
  const dependencyStep = missingDependency.operations[0];
  assert(dependencyStep);
  missingDependency.operations[0] = {
    ...dependencyStep,
    depends_on: ["step_future"],
  };
  assert.throws(() => sealPlan(missingDependency), LifecycleContractError);
});

test("future observations and stale verified evidence fail closed", () => {
  const original = planFixture();
  assert.throws(() =>
    sealPlan({
      ...structuredClone(original),
      target_snapshot: {
        ...original.target_snapshot,
        observed_at: "2026-08-08T07:00:00.001Z",
      },
      created_at: "2026-08-08T07:00:00Z",
    }),
  );

  const execution = executionFixture(original);
  const verification = mutable(verificationFixture(original, execution));
  const observation = verification.observations[0];
  assert(observation);
  verification.observations[0] = {
    ...observation,
    observation_digest: digest("substituted-postcondition"),
  };
  assert.throws(() =>
    validateVerificationRecord(
      resealRecord(verification as unknown as Record<string, unknown>, "verification_digest"),
      execution,
      original,
    ),
  );
});

test("idempotency, retry, destructive approval, and attempt ceilings fail closed", () => {
  const original = planFixture();
  assert.throws(() =>
    sealPlan({
      ...structuredClone(original),
      idempotency: {
        classification: "non_idempotent",
        key_digest: null,
        max_attempts: 2,
        retry: "safe_before_start_only",
      },
    }),
  );
  assert.throws(() =>
    sealPlan({
      ...structuredClone(original),
      predicted_effects: original.predicted_effects.map((effect) => ({
        ...effect,
        destructive: true,
      })),
      approval: { required: true, level: "elevated" },
    }),
  );
  assert.throws(() =>
    sealPlan({
      ...structuredClone(original),
      idempotency: {
        ...original.idempotency,
        max_attempts: 6,
      },
    }),
  );
});

test("expired, rejected, weak, and stale approvals cannot admit apply", () => {
  const plan = planFixture();
  assert.throws(
    () => validateMutationPlan(plan, plan.expires_at),
    (error: unknown) =>
      error instanceof LifecycleContractError && error.code === "plan_invalidated",
  );

  const valid = approvalFixture(plan);
  for (const change of [
    { decision: "reject", satisfied_level: null },
    { satisfied_level: "standard" },
    {
      actor: {
        ...valid.actor,
        authentication_strength: "bounded_session",
      },
    },
    {
      actor: {
        ...valid.actor,
        ref: plan.subject.ref,
      },
    },
    { expires_at: "2026-08-08T08:01:00Z" },
    { nonce_digest: digest("other-nonce") },
  ]) {
    const candidate = resealRecord({ ...structuredClone(valid), ...change }, "approval_digest");
    if ("nonce_digest" in change) {
      assert.doesNotThrow(() => validateApprovalReceipt(candidate, plan, NOW));
    } else {
      assert.throws(() => validateApprovalReceipt(candidate, plan, NOW));
    }
  }
  assert.throws(
    () => validateApprovalReceipt(valid, plan, valid.expires_at),
    LifecycleContractError,
  );
});

test("execution aggregate and verification outcome cannot claim false success", () => {
  const plan = planFixture();
  const execution = executionFixture(plan);
  const mismatchedExecution = resealRecord(
    { ...structuredClone(execution), aggregate_outcome: "no_effect_proven" },
    "execution_digest",
  );
  assert.throws(() => validateExecutionRecord(mismatchedExecution, plan));

  const verification = verificationFixture(plan, execution);
  const mismatchedVerification = resealRecord(
    { ...structuredClone(verification), outcome: "failed" },
    "verification_digest",
  );
  assert.throws(() => validateVerificationRecord(mismatchedVerification, execution, plan));
});

test("rollback record is an exact binding to a separate rollback plan", () => {
  const originalPlan = planFixture();
  const execution = executionFixture(originalPlan);
  const rollbackPlan = rollbackPlanFixture(originalPlan, execution);
  const rollback = rollbackRecordFixture(rollbackPlan);
  assert.deepEqual(validateRollbackRecord(rollback, rollbackPlan), rollback);

  const anotherPlan = sealPlan({
    ...structuredClone(rollbackPlan),
    plan_id: "plan_rollback002",
  });
  assert.throws(() => validateRollbackRecord(rollback, anotherPlan));
});
