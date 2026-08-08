import assert from "node:assert/strict";
import test from "node:test";
import { lifecycleDigest, type MutationPlanV1 } from "../../packages/lifecycle/src/contract.js";
import type { FreshAuthorizationResult } from "../../packages/lifecycle/src/ports.js";
import {
  NOW,
  approvalFixture,
  authorizationFixture,
  createHarness,
  digest,
  planFixture,
  rollbackPlanFixture,
  rollbackRecordFixture,
  sealPlan,
} from "./lifecycle-test-fixtures.js";

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;
type MutableAuthorization = Omit<
  FreshAuthorizationResult,
  "request" | "decision" | "authentication_context_digest"
> & {
  request: Mutable<FreshAuthorizationResult["request"]>;
  decision: Mutable<FreshAuthorizationResult["decision"]>;
  authentication_context_digest: string;
};

function resealApproval(value: Readonly<Record<string, unknown>>) {
  const base = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "approval_digest"),
  );
  return { ...base, approval_digest: lifecycleDigest(base) };
}

test("verified apply follows the exact durable lifecycle order", async () => {
  const harness = createHarness();
  const plan = planFixture();
  const result = await harness.engine.execute({
    plan,
    approval: approvalFixture(plan),
  });

  assert.equal(result.status, "succeeded");
  assert.equal(harness.authorization.calls, 1);
  assert.equal(harness.conditions.calls, plan.preconditions.length);
  assert.equal(harness.effects.calls, 1);
  assert.equal(harness.verifier.calls, 1);
  assert.deepEqual(
    harness.audit.records.map(({ stage }) => stage),
    [
      "plan.created",
      "approval.requested",
      "approval.approved",
      "authorization.evaluation_recorded",
      "authorization.decision_recorded",
      "authorization.enforcement_recorded",
      "apply.admitted",
      "execution.attempt_reserved",
      "execution.started",
      "execution.completed",
      "verification.started",
      "verification.completed",
      "result.released",
    ],
  );
  assert.equal(result.execution.aggregate_outcome, "effect_observed");
  assert.equal(result.verification.outcome, "verified");
});

test("approval denial has precedence over fresh authorization", async () => {
  const harness = createHarness();
  const plan = planFixture();
  const approval = approvalFixture(plan);
  const expired = resealApproval({
    ...structuredClone(approval),
    expires_at: NOW,
  });
  const result = await harness.engine.execute({ plan, approval: expired });

  assert.deepEqual(result, {
    status: "denied",
    code: "approval_denied",
    duplicate: false,
  });
  assert.equal(harness.authorization.calls, 0);
  assert.equal(harness.effects.calls, 0);
  assert.deepEqual(
    harness.audit.records.map(({ stage }) => stage),
    ["plan.created", "approval.requested", "approval.rejected"],
  );
});

test("self-approval denies before fresh authorization or effect", async () => {
  const harness = createHarness();
  const plan = planFixture();
  const approval = approvalFixture(plan);
  const selfApproval = resealApproval({
    ...structuredClone(approval),
    actor: {
      ...approval.actor,
      ref: plan.subject.ref,
    },
  });
  const result = await harness.engine.execute({ plan, approval: selfApproval });
  assert.deepEqual(result, {
    status: "denied",
    code: "approval_denied",
    duplicate: false,
  });
  assert.equal(harness.authorization.calls, 0);
  assert.equal(harness.effects.calls, 0);
});

test("fresh apply authorization is distinct, explicit, and binding exact", async (t) => {
  await t.test("deny wins after a valid approval", async () => {
    const harness = createHarness();
    harness.authorization.effect = "deny";
    const plan = planFixture();
    const result = await harness.engine.execute({ plan, approval: approvalFixture(plan) });
    assert.equal(result.status, "denied");
    assert.equal(result.status === "denied" && result.code, "authorization_denied");
    assert.equal(harness.effects.calls, 0);
    assert.equal(harness.audit.records.at(-1)?.stage, "authorization.enforcement_recorded");
  });

  for (const [name, mutate] of [
    [
      "subject",
      (result: MutableAuthorization) => {
        result.request.subject.ref = "subject_other001";
      },
    ],
    [
      "capability definition",
      (result: MutableAuthorization) => {
        result.decision.action.definition_digest = digest("other-definition");
      },
    ],
    [
      "authentication context",
      (result: MutableAuthorization) => {
        result.authentication_context_digest = digest("other-authentication-context");
      },
    ],
    [
      "scope",
      (result: MutableAuthorization) => {
        result.request.resource.refs = ["setting-example-02"];
      },
    ],
    [
      "environment",
      (result: MutableAuthorization) => {
        result.request.environment.ref = "staging";
      },
    ],
    [
      "policy snapshot",
      (result: MutableAuthorization) => {
        result.request.policy.revision = 18;
      },
    ],
  ] as const) {
    await t.test(`${name} substitution denies`, async () => {
      const harness = createHarness();
      harness.authorization.mutate = (result) => {
        const changed: MutableAuthorization = {
          ...result,
          request: structuredClone(result.request) as MutableAuthorization["request"],
          decision: structuredClone(result.decision) as MutableAuthorization["decision"],
        };
        mutate(changed);
        return changed;
      };
      const plan = planFixture();
      const result = await harness.engine.execute({ plan, approval: approvalFixture(plan) });
      assert.deepEqual(result, {
        status: "denied",
        code: "authorization_binding_mismatch",
        duplicate: false,
      });
      assert.equal(harness.effects.calls, 0);
    });
  }

  await t.test("internally valid substituted authorization still denies", async () => {
    const harness = createHarness();
    const plan = planFixture();
    const changedPlan = sealPlan({
      ...structuredClone(plan),
      subject: {
        ...plan.subject,
        ref: "subject_other001",
      },
    });
    harness.authorization.mutate = () => authorizationFixture(changedPlan, 99);
    const result = await harness.engine.execute({ plan, approval: approvalFixture(plan) });
    assert.deepEqual(result, {
      status: "denied",
      code: "authorization_binding_mismatch",
      duplicate: false,
    });
    assert.equal(harness.effects.calls, 0);
  });

  await t.test("authorization issued before approval is not fresh apply authority", async () => {
    const harness = createHarness();
    const plan = planFixture();
    const stale = structuredClone(authorizationFixture(plan, 98)) as MutableAuthorization;
    stale.request.request_context.requested_at = "2026-08-08T07:00:30Z";
    const requestBase = Object.fromEntries(
      Object.entries(stale.request).filter(([key]) => key !== "request_digest"),
    );
    stale.request.request_digest = lifecycleDigest(requestBase);
    stale.decision.request_digest = stale.request.request_digest;
    stale.decision.issued_at = "2026-08-08T07:00:31Z";
    const decisionBase = Object.fromEntries(
      Object.entries(stale.decision).filter(([key]) => key !== "decision_digest"),
    );
    stale.decision.decision_digest = lifecycleDigest(decisionBase);
    harness.authorization.mutate = () => stale;
    const result = await harness.engine.execute({ plan, approval: approvalFixture(plan) });
    assert.deepEqual(result, {
      status: "denied",
      code: "authorization_binding_mismatch",
      duplicate: false,
    });
    assert.equal(harness.effects.calls, 0);
  });
});

test("every pre-effect health, capacity, precondition, and audit failure calls no effect", async (t) => {
  const cases = [
    {
      name: "audit health",
      configure: (harness: ReturnType<typeof createHarness>) => {
        harness.audit.ready = false;
      },
      code: "audit_unavailable",
    },
    {
      name: "reservation capacity",
      configure: (harness: ReturnType<typeof createHarness>) => {
        harness.ledger.ready = false;
      },
      code: "reservation_unavailable",
    },
    {
      name: "precondition mismatch",
      configure: (harness: ReturnType<typeof createHarness>) => {
        harness.conditions.mismatch = true;
      },
      code: "precondition_failed",
    },
    {
      name: "precondition unavailable",
      configure: (harness: ReturnType<typeof createHarness>) => {
        harness.conditions.unavailable = true;
      },
      code: "precondition_failed",
    },
    {
      name: "stale precondition observation",
      configure: (harness: ReturnType<typeof createHarness>) => {
        harness.conditions.observedAt = "2026-08-08T07:00:00Z";
      },
      code: "precondition_failed",
    },
    {
      name: "admission audit",
      configure: (harness: ReturnType<typeof createHarness>) => {
        harness.audit.failStage = "apply.admitted";
      },
      code: "audit_unavailable",
    },
    {
      name: "reservation audit",
      configure: (harness: ReturnType<typeof createHarness>) => {
        harness.audit.failStage = "execution.attempt_reserved";
      },
      code: "audit_unavailable",
    },
  ] as const;
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const harness = createHarness();
      fixture.configure(harness);
      const plan = planFixture();
      const result = await harness.engine.execute({ plan, approval: approvalFixture(plan) });
      assert.equal(result.status, "denied");
      assert.equal(result.status === "denied" && result.code, fixture.code);
      assert.equal(harness.effects.calls, 0);
      assert.equal(harness.verifier.calls, 0);
    });
  }
});

test("a durable reservation is idempotent and conflicting reuse is denied", async () => {
  const harness = createHarness();
  const plan = planFixture();
  const approval = approvalFixture(plan);
  const first = await harness.engine.execute({ plan, approval });
  assert.equal(first.status, "succeeded");
  const duplicate = await harness.engine.execute({ plan, approval });
  assert.equal(duplicate.status, "succeeded");
  assert.equal(duplicate.duplicate, true);
  assert.equal(harness.effects.calls, 1);

  const changed = sealPlan({
    ...structuredClone(plan),
    plan_id: "plan_conflict001",
    request: {
      ...plan.request,
      request_id: "request_conflict001",
      request_digest: digest("conflicting-request"),
    },
    planning_authorization: {
      ...plan.planning_authorization,
      request_id: "authreq_conflict001",
      request_digest: digest("conflicting-planning-request"),
      decision_id: "decision_conflict001",
      decision_digest: digest("conflicting-planning-decision"),
    },
  });
  const conflictingApproval = approvalFixture(changed, {
    approval_id: "approval_conflict001",
    nonce_digest: approval.nonce_digest,
  });
  const conflict = await harness.engine.execute({
    plan: changed,
    approval: conflictingApproval,
  });
  assert.equal(conflict.status, "denied");
  assert.equal(conflict.status === "denied" && conflict.code, "reservation_conflict");
  assert.equal(harness.effects.calls, 1);
});

test("effect-port return cannot become success without matching verification", async (t) => {
  await t.test("verification failure withholds success", async () => {
    const harness = createHarness();
    harness.verifier.status = "failed";
    const plan = planFixture();
    const result = await harness.engine.execute({ plan, approval: approvalFixture(plan) });
    assert.equal(result.status, "failed");
    assert.equal(result.status === "failed" && result.code, "verification_failed");
    assert.equal(
      result.status === "failed" && result.execution.aggregate_outcome,
      "effect_observed",
    );
    assert.equal(harness.audit.records.at(-1)?.stage, "result.withheld");
  });

  test("effect timeout and post-start clock failure remain completion unknown", async (t) => {
    await t.test("timeout aborts the port and never verifies or retries", async () => {
      const harness = createHarness();
      const plan = sealPlan({
        ...structuredClone(planFixture()),
        timeout_ms: 5,
      });
      harness.effects.apply = async ({ signal }) => {
        harness.effects.calls += 1;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
        throw new Error("unreachable");
      };
      const result = await harness.engine.execute({ plan, approval: approvalFixture(plan) });
      assert.equal(result.status, "completion_unknown");
      assert.equal(harness.effects.calls, 1);
      assert.equal(harness.verifier.calls, 0);
    });

    await t.test("clock failure after effect journals recovery and withholds success", async () => {
      const harness = createHarness();
      const apply = harness.effects.apply.bind(harness.effects);
      harness.effects.apply = async (input) => {
        const result = await apply(input);
        harness.clock.now = () => {
          throw new Error("clock unavailable");
        };
        return result;
      };
      const plan = planFixture();
      const result = await harness.engine.execute({ plan, approval: approvalFixture(plan) });
      assert.equal(result.status, "completion_unknown");
      assert.equal(result.status === "completion_unknown" && result.recovery, "journaled");
      assert.equal(harness.effects.calls, 1);
      assert.equal(harness.verifier.calls, 0);
    });

    await t.test("verification timeout is inconclusive and never releases success", async () => {
      const harness = createHarness();
      const plan = sealPlan({
        ...structuredClone(planFixture()),
        timeout_ms: 5,
      });
      harness.verifier.verify = async ({ signal }) => {
        harness.verifier.calls += 1;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
        throw new Error("unreachable");
      };
      const result = await harness.engine.execute({ plan, approval: approvalFixture(plan) });
      assert.equal(result.status, "failed");
      assert.equal(result.status === "failed" && result.code, "verification_inconclusive");
      assert.equal(harness.effects.calls, 1);
      assert.equal(harness.verifier.calls, 1);
      assert.equal(
        harness.audit.records.some(({ stage }) => stage === "result.released"),
        false,
      );
    });
  });

  await t.test("verifier mismatch is inconclusive and never released", async () => {
    const harness = createHarness();
    harness.verifier.mutate = (observations) =>
      observations.map((observation) => ({
        ...observation,
        condition_ref: "condition_substituted",
      }));
    const plan = planFixture();
    const result = await harness.engine.execute({ plan, approval: approvalFixture(plan) });
    assert.equal(result.status, "failed");
    assert.equal(result.status === "failed" && result.code, "verification_inconclusive");
    assert.equal(
      harness.audit.records.some(({ stage }) => stage === "result.released"),
      false,
    );
  });
});

test("ambiguous, no-effect, and partial outcomes remain distinct", async (t) => {
  await t.test("effect ambiguity is completion_unknown", async () => {
    const harness = createHarness();
    harness.effects.unavailable = true;
    const plan = planFixture();
    const result = await harness.engine.execute({ plan, approval: approvalFixture(plan) });
    assert.equal(result.status, "completion_unknown");
    assert.equal(result.status === "completion_unknown" && result.recovery, "not_required");
    assert.equal(harness.verifier.calls, 0);
  });

  await t.test("independently proven no effect is failed, not unknown", async () => {
    const harness = createHarness();
    harness.effects.steps = [
      {
        step_id: "step_update",
        state: "no_effect_proven",
        reason_code: "no_effect_proven",
        evidence_refs: ["evidence_no_effect001"],
      },
    ];
    const plan = planFixture();
    const result = await harness.engine.execute({ plan, approval: approvalFixture(plan) });
    assert.equal(result.status, "failed");
    assert.equal(result.status === "failed" && result.code, "no_effect_proven");
    assert.equal(harness.verifier.calls, 0);
  });

  await t.test("known mixed effects are partial", async () => {
    const harness = createHarness();
    const source = structuredClone(planFixture()) as unknown as Record<string, unknown>;
    const operations = structuredClone(planFixture().operations) as unknown as Record<
      string,
      unknown
    >[];
    operations.push({
      step_id: "step_emit",
      operation_digest: digest("placeholder"),
      depends_on: [],
      effect: "update",
      precondition_refs: ["condition_resource_version", "condition_capacity"],
      postcondition_refs: ["condition_value_matches"],
    });
    source.operations = operations;
    source.predicted_effects = [
      ...planFixture().predicted_effects,
      ...planFixture().predicted_effects,
    ];
    const plan = sealPlan(source);
    harness.effects.steps = [
      {
        step_id: "step_update",
        state: "effect_observed",
        reason_code: "effect_observed",
        evidence_refs: ["evidence_effect001"],
      },
      {
        step_id: "step_emit",
        state: "no_effect_proven",
        reason_code: "no_effect_proven",
        evidence_refs: ["evidence_no_effect001"],
      },
    ];
    const result = await harness.engine.execute({ plan, approval: approvalFixture(plan) });
    assert.equal(result.status, "partial_effect");
    assert.equal(
      result.status === "partial_effect" && result.execution.aggregate_outcome,
      "partial_effect",
    );
  });
});

test("post-start audit failure journals recovery and withholds success", async (t) => {
  for (const stage of [
    "execution.started",
    "execution.completed",
    "verification.completed",
    "result.released",
  ] as const) {
    await t.test(stage, async () => {
      const harness = createHarness();
      harness.audit.failStage = stage;
      const plan = planFixture();
      const result = await harness.engine.execute({ plan, approval: approvalFixture(plan) });
      assert.equal(result.status, "completion_unknown");
      assert.equal(result.status === "completion_unknown" && result.recovery, "journaled");
      assert.equal(harness.audit.recoveries, 1);
      assert.equal(harness.effects.calls, stage === "execution.started" ? 0 : 1);
    });
  }
});

test("approved-audit failure is not misreported as approval rejection", async () => {
  const harness = createHarness();
  harness.audit.failStage = "approval.approved";
  const plan = planFixture();
  const result = await harness.engine.execute({ plan, approval: approvalFixture(plan) });
  assert.deepEqual(result, {
    status: "denied",
    code: "audit_unavailable",
    duplicate: false,
  });
  assert.deepEqual(
    harness.audit.records.map(({ stage }) => stage),
    ["plan.created", "approval.requested"],
  );
  assert.equal(harness.effects.calls, 0);
});

test("journal failure still withholds success with a closed outcome", async () => {
  const harness = createHarness();
  harness.audit.failStage = "execution.completed";
  harness.audit.recoveryDurable = false;
  const plan = planFixture();
  const result = await harness.engine.execute({ plan, approval: approvalFixture(plan) });
  assert.equal(result.status, "completion_unknown");
  assert.equal(result.status === "completion_unknown" && result.recovery, "journal_unavailable");
});

test("rollback is a separately planned, approved, authorized, verified lifecycle", async () => {
  const harness = createHarness();
  const originalPlan = planFixture();
  const original = await harness.engine.execute({
    plan: originalPlan,
    approval: approvalFixture(originalPlan),
  });
  assert.equal(original.status, "succeeded");
  if (original.status !== "succeeded") return;

  const rollbackPlan = rollbackPlanFixture(originalPlan, original.execution);
  const rollbackApproval = approvalFixture(rollbackPlan, {
    approval_id: "approval_rollback001",
    nonce_digest: digest("rollback-approval-nonce"),
  });
  const result = await harness.engine.executeRollback({
    plan: rollbackPlan,
    approval: rollbackApproval,
    rollback: rollbackRecordFixture(rollbackPlan),
    original_plan: originalPlan,
    original_execution: original.execution,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.apply.status, "succeeded");
  assert.equal(harness.authorization.calls, 2);
  assert.equal(harness.effects.calls, 2);
  const rollbackRequested = harness.audit.records.findIndex(
    ({ stage }) => stage === "rollback.requested",
  );
  const rollbackPlanCreated = harness.audit.records.findIndex(
    ({ stage }, index) => index > rollbackRequested && stage === "plan.created",
  );
  const rollbackCompleted = harness.audit.records.findIndex(
    ({ stage }) => stage === "rollback.completed",
  );
  assert(rollbackRequested >= 0);
  assert(rollbackPlanCreated > rollbackRequested);
  assert(rollbackCompleted > rollbackPlanCreated);
});

test("rollback verification failure remains distinct from the original success", async () => {
  const harness = createHarness();
  const originalPlan = planFixture();
  const original = await harness.engine.execute({
    plan: originalPlan,
    approval: approvalFixture(originalPlan),
  });
  assert.equal(original.status, "succeeded");
  if (original.status !== "succeeded") return;

  harness.verifier.status = "failed";
  const rollbackPlan = rollbackPlanFixture(originalPlan, original.execution);
  const result = await harness.engine.executeRollback({
    plan: rollbackPlan,
    approval: approvalFixture(rollbackPlan, {
      approval_id: "approval_rollback_failed001",
      nonce_digest: digest("rollback-failed-nonce"),
    }),
    rollback: rollbackRecordFixture(rollbackPlan),
    original_plan: originalPlan,
    original_execution: original.execution,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.apply.status, "failed");
  assert.equal(harness.audit.records.at(-1)?.stage, "rollback.failed");
  assert.equal(original.status, "succeeded");
});

test("a plan that declared rollback unavailable cannot be compensated", async () => {
  const harness = createHarness();
  const source = planFixture();
  const originalPlan = sealPlan({
    ...structuredClone(source),
    rollback: { mode: "unavailable", capability: null },
  });
  const original = await harness.engine.execute({
    plan: originalPlan,
    approval: approvalFixture(originalPlan),
  });
  assert.equal(original.status, "succeeded");
  if (original.status !== "succeeded") return;

  const rollbackPlan = rollbackPlanFixture(source, original.execution);
  const result = await harness.engine.executeRollback({
    plan: rollbackPlan,
    approval: approvalFixture(rollbackPlan, {
      approval_id: "approval_rollback_unavailable001",
      nonce_digest: digest("rollback-unavailable-nonce"),
    }),
    rollback: rollbackRecordFixture(rollbackPlan),
    original_plan: originalPlan,
    original_execution: original.execution,
  });
  assert.equal(result.status, "denied");
  assert.equal(result.apply.status, "denied");
  assert.equal(harness.effects.calls, 1);
});
