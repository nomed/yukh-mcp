import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { validateAuditCandidate, type AuditCandidate } from "../../packages/audit/src/contract.js";
import { openRepositoryLocalAuditProfileForQualification } from "../../packages/audit/src/repository-local.js";
import { AUDIT_GENESIS_HASH, AuditWriter } from "../../packages/audit/src/writer.js";
import {
  createLifecycleAuditCandidateFactory,
  createAuditWriterLifecyclePort,
} from "../../packages/lifecycle/src/audit-adapter.js";
import { LifecycleEngine } from "../../packages/lifecycle/src/engine.js";
import {
  LifecyclePortError,
  type LifecycleAuditRecord,
} from "../../packages/lifecycle/src/ports.js";
import {
  NOW,
  FakeAuthorization,
  FakeConditions,
  FakeEffects,
  FakeVerifier,
  FixedClock,
  MemoryLedger,
  approvalFixture,
  digest,
  planFixture,
  sealPlan,
} from "./lifecycle-test-fixtures.js";

const scratchRoot = path.join(process.cwd(), ".audit-test-scratch");
const D1 = digest("audit-definition");
const D2 = digest("audit-resources");
const D3 = digest("audit-request");
const D4 = digest("audit-decision");
const PLAN = digest("audit-plan");
const NULL_CORRELATION = {
  trace_ref: null,
  request_ref: null,
  authorization_request_ref: null,
  authorization_decision_ref: null,
  plan_ref: null,
  approval_ref: null,
  execution_ref: null,
  verification_ref: null,
  rollback_ref: null,
};

async function repositoryRoot(prefix: string): Promise<string> {
  await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
  await chmod(scratchRoot, 0o700);
  const root = await mkdtemp(path.join(scratchRoot, prefix));
  await chmod(root, 0o700);
  return root;
}

function candidate(overrides: Readonly<Record<string, unknown>>): AuditCandidate {
  return validateAuditCandidate({
    audit_candidate_version: 1,
    event_id: "event_request",
    event_type: "request.accepted.v1",
    occurred_at: NOW,
    producer: {
      component_ref: "component.gateway",
      instance_ref: "instance.lifecycle-test",
    },
    correlation: {
      ...NULL_CORRELATION,
      trace_ref: "trace_lifecycle001",
      request_ref: "request_lifecycle001",
    },
    causation: { parent_event_refs: [] },
    subject: { ref: "subject_lifecycle001", kind: "workload" },
    capability: {
      id: "example.setting.update",
      version: "1.0.0",
      definition_digest: D1,
    },
    scope: {
      resource_kind: "example_setting",
      resource_set_ref: "resources_lifecycle001",
      resource_set_digest: D2,
      environment_ref: "development",
    },
    outcome: { status: "accepted", reason_codes: ["accepted"] },
    payload: { request_digest: D3 },
    ...overrides,
  });
}

function stream(): AuditCandidate {
  return candidate({
    event_id: "event_stream",
    event_type: "audit.stream_opened.v1",
    producer: {
      component_ref: "component.audit-writer",
      instance_ref: "instance.lifecycle-test",
    },
    correlation: NULL_CORRELATION,
    subject: { ref: "service_audit001", kind: "system" },
    capability: {
      id: "audit.writer",
      version: "1.0.0",
      definition_digest: D1,
    },
    scope: {
      resource_kind: "security-domain",
      resource_set_ref: "resources_audit001",
      resource_set_digest: D2,
      environment_ref: "development",
    },
    payload: { genesis_hash: AUDIT_GENESIS_HASH },
  });
}

function evaluation(): AuditCandidate {
  return candidate({
    event_id: "event_evaluation",
    event_type: "authorization.evaluation_recorded.v1",
    correlation: {
      ...NULL_CORRELATION,
      trace_ref: "trace_lifecycle001",
      request_ref: "request_lifecycle001",
      authorization_request_ref: "authreq_planning001",
    },
    causation: { parent_event_refs: ["event_request"] },
    payload: {
      authorization_request_digest: D3,
      attribute_snapshot_ref: "attributes_lifecycle001",
      attribute_snapshot_digest: D2,
      evaluator_ref: "evaluator_lifecycle001",
      authorization_phase: "planning",
      plan_digest: null,
    },
  });
}

function decision(): AuditCandidate {
  return candidate({
    event_id: "event_decision",
    event_type: "authorization.decision_recorded.v1",
    correlation: {
      ...evaluation().correlation,
      authorization_decision_ref: "decision_planning001",
    },
    causation: { parent_event_refs: ["event_evaluation"] },
    outcome: { status: "allowed", reason_codes: ["policy_allow"] },
    payload: {
      authorization_request_digest: D3,
      decision_digest: D4,
      effect: "allow",
      basis: "explicit",
      policy_revision_ref: "policy_lifecycle001",
      policy_digest: D2,
      authorization_phase: "planning",
      plan_digest: null,
    },
  });
}

function enforcement(): AuditCandidate {
  return candidate({
    event_id: "event_enforcement",
    event_type: "authorization.enforcement_recorded.v1",
    correlation: decision().correlation,
    causation: { parent_event_refs: ["event_decision"] },
    outcome: { status: "allowed", reason_codes: ["enforced"] },
    payload: {
      decision_digest: D4,
      enforcement_result: "enforced",
      authorization_phase: "planning",
      plan_digest: null,
    },
  });
}

function planCandidate(): AuditCandidate {
  return candidate({
    event_id: "event_plan",
    event_type: "plan.created.v1",
    correlation: {
      ...decision().correlation,
      plan_ref: "plan_lifecycle001",
    },
    causation: { parent_event_refs: ["event_enforcement"] },
    outcome: { status: "created", reason_codes: ["plan_created"] },
    payload: {
      plan_digest: PLAN,
      authorization_decision_digest: D4,
      observation_digest: D2,
    },
  });
}

function startedCandidate(): AuditCandidate {
  return candidate({
    event_id: "event_started_recovery",
    event_type: "execution.started.v1",
    correlation: {
      ...decision().correlation,
      authorization_request_ref: "authreq_apply001",
      authorization_decision_ref: "decision_apply001",
      plan_ref: "plan_lifecycle001",
      approval_ref: "approval_lifecycle001",
      execution_ref: "execution_lifecycle001",
    },
    causation: { parent_event_refs: ["event_reserved_recovery"] },
    outcome: { status: "started", reason_codes: ["provider_started"] },
    payload: { plan_digest: PLAN, attempt: 1 },
  });
}

function lifecycleRecord(overrides: Partial<LifecycleAuditRecord> = {}): LifecycleAuditRecord {
  return {
    audit_record_version: 1,
    stage: "plan.created",
    occurred_at: NOW,
    plan_id: "plan_lifecycle001",
    plan_digest: PLAN,
    approval_ref: null,
    approval_digest: null,
    execution_ref: null,
    verification_ref: null,
    rollback_ref: null,
    authorization_request_ref: null,
    authorization_request_digest: null,
    authorization_decision_ref: null,
    authorization_decision_digest: null,
    authorization_effect: null,
    authorization_basis: null,
    evaluator_ref: null,
    enforcement_result: null,
    attempt: null,
    execution_digest: null,
    verification_digest: null,
    verification_outcome: null,
    aggregate_outcome: null,
    final_outcome: null,
    ...overrides,
  };
}

function initialLifecycleCandidates(plan = planFixture()): readonly AuditCandidate[] {
  const operation = {
    subject: { ref: plan.subject.ref, kind: plan.subject.kind },
    capability: {
      id: plan.capability.id,
      version: plan.capability.version,
      definition_digest: plan.capability.definition_digest,
    },
    scope: {
      resource_kind: plan.scope.resource_kind,
      resource_set_ref: plan.scope.resource_set_ref,
      resource_set_digest: plan.scope.resource_set_digest,
      environment_ref: plan.scope.environment_ref,
    },
  };
  const request = candidate({
    ...operation,
    event_id: "event_lifecycle_request",
    correlation: {
      ...NULL_CORRELATION,
      trace_ref: "trace_lifecycle_engine001",
      request_ref: plan.request.request_id,
    },
    payload: { request_digest: plan.request.request_digest },
  });
  const evaluation = candidate({
    ...operation,
    event_id: "event_lifecycle_planning_evaluation",
    event_type: "authorization.evaluation_recorded.v1",
    correlation: {
      ...request.correlation,
      authorization_request_ref: plan.planning_authorization.request_id,
    },
    causation: { parent_event_refs: [request.event_id] },
    payload: {
      authorization_request_digest: plan.planning_authorization.request_digest,
      attribute_snapshot_ref: plan.attributes.snapshot_ref,
      attribute_snapshot_digest: plan.attributes.digest,
      evaluator_ref: "evaluator_lifecycle001",
      authorization_phase: "planning",
      plan_digest: null,
    },
  });
  const decision = candidate({
    ...operation,
    event_id: "event_lifecycle_planning_decision",
    event_type: "authorization.decision_recorded.v1",
    correlation: {
      ...evaluation.correlation,
      authorization_decision_ref: plan.planning_authorization.decision_id,
    },
    causation: { parent_event_refs: [evaluation.event_id] },
    outcome: { status: "allowed", reason_codes: ["policy_allow"] },
    payload: {
      authorization_request_digest: plan.planning_authorization.request_digest,
      decision_digest: plan.planning_authorization.decision_digest,
      effect: "allow",
      basis: "explicit",
      policy_revision_ref: plan.policy.bundle_ref,
      policy_digest: plan.policy.digest,
      authorization_phase: "planning",
      plan_digest: null,
    },
  });
  const enforcement = candidate({
    ...operation,
    event_id: "event_lifecycle_planning_enforcement",
    event_type: "authorization.enforcement_recorded.v1",
    correlation: decision.correlation,
    causation: { parent_event_refs: [decision.event_id] },
    outcome: { status: "allowed", reason_codes: ["enforced"] },
    payload: {
      decision_digest: plan.planning_authorization.decision_digest,
      enforcement_result: "enforced",
      authorization_phase: "planning",
      plan_digest: null,
    },
  });
  return [request, evaluation, decision, enforcement];
}

test("lifecycle adapter commits through the durable writer and recovery journal ports", async () => {
  const root = await repositoryRoot("lifecycle-audit-adapter-");
  try {
    const profile = await openRepositoryLocalAuditProfileForQualification({
      trustedRepositoryRoot: root,
      writerRef: "impl_audit_writer001",
      now: () => new Date(NOW),
      filesystemHooks: { filesystemKindOverride: "ext" },
    });
    const writer = new AuditWriter({
      store: profile.store,
      streamRef: "stream_lifecycle001",
      writerRef: "impl_audit_writer001",
      now: () => new Date(NOW),
    });
    for (const item of [stream(), candidate({}), evaluation(), decision(), enforcement()]) {
      assert.equal((await writer.commit(item)).durability, "durable");
    }
    const port = createAuditWriterLifecyclePort({
      writer,
      readiness: profile.readiness,
      journal: profile.journal,
      candidates: {
        candidate: () => planCandidate(),
        recoveryCandidate: () => startedCandidate(),
      },
    });
    await port.assertReady();
    assert.deepEqual(await port.commit(lifecycleRecord()), {
      durability: "durable",
      event_ref: "event_plan",
    });
    assert.deepEqual(
      await port.recover({
        recovery_id: "recovery_lifecycle001",
        record: lifecycleRecord({
          stage: "execution.started",
          execution_ref: "execution_lifecycle001",
          attempt: 1,
          aggregate_outcome: "completion_unknown",
        }),
      }),
      { durability: "durable" },
    );
    const pending: string[] = [];
    for await (const fact of profile.pendingFacts()) pending.push(fact.recovery_id);
    assert.deepEqual(pending, ["recovery_lifecycle001"]);
    await profile.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lifecycle adapter rejects a candidate substituted across stages", async () => {
  const port = createAuditWriterLifecyclePort({
    writer: {
      commit: async () => {
        throw new Error("writer must not be called");
      },
    },
    readiness: { assertReadyForProviderStart: async () => undefined },
    journal: {
      append: async () => ({ durability: "durable" as const }),
    },
    candidates: {
      candidate: () => planCandidate(),
      recoveryCandidate: () => startedCandidate(),
    },
  });
  await assert.rejects(
    port.commit(lifecycleRecord({ stage: "approval.requested" })),
    (error: unknown) => error instanceof LifecyclePortError && error.code === "audit_unavailable",
  );
});

test("full engine commits verification-gated success through the durable audit profile", async () => {
  const root = await repositoryRoot("lifecycle-audit-engine-");
  try {
    const plan = planFixture();
    const approval = approvalFixture(plan);
    const profile = await openRepositoryLocalAuditProfileForQualification({
      trustedRepositoryRoot: root,
      writerRef: "impl_audit_writer001",
      now: () => new Date(NOW),
      filesystemHooks: { filesystemKindOverride: "ext" },
    });

    const writer = new AuditWriter({
      store: profile.store,
      streamRef: "stream_lifecycle_engine001",
      writerRef: "impl_audit_writer001",
      now: () => new Date(NOW),
    });
    await writer.commit(stream());
    for (const item of initialLifecycleCandidates()) await writer.commit(item);
    const candidates = createLifecycleAuditCandidateFactory({
      plan,
      traceRef: "trace_lifecycle_engine001",
      requestRef: plan.request.request_id,
      requestEventRef: "event_lifecycle_request",
      planningEnforcementEventRef: "event_lifecycle_planning_enforcement",
      approvalRef: approval.approval_id,
      producer: {
        component_ref: "component.gateway",
        instance_ref: "instance.lifecycle-test",
      },
    });
    const audit = createAuditWriterLifecyclePort({
      writer,
      readiness: profile.readiness,
      journal: profile.journal,
      candidates,
    });
    const effects = new FakeEffects();
    const engine = new LifecycleEngine({
      clock: new FixedClock(),
      authorization: new FakeAuthorization(),
      conditions: new FakeConditions(),
      effects,
      verifier: new FakeVerifier(),
      audit,
      ledger: new MemoryLedger(),
    });
    const result = await engine.execute({ plan, approval });
    assert.equal(result.status, "succeeded");
    assert.equal(effects.calls, 1);
    const terminal = await profile.store.findById(
      validateAuditCandidate(
        candidates.candidate({
          audit_record_version: 1,
          stage: "result.released",
          occurred_at: NOW,
          plan_id: plan.plan_id,
          plan_digest: plan.plan_digest,
          approval_ref: approval.approval_id,
          approval_digest: approval.approval_digest,
          execution_ref: result.status === "succeeded" ? result.execution.execution_ref : null,
          verification_ref:
            result.status === "succeeded" ? result.verification.verification_ref : null,
          rollback_ref: null,
          authorization_request_ref: null,
          authorization_request_digest: null,
          authorization_decision_ref: null,
          authorization_decision_digest: null,
          authorization_effect: null,
          authorization_basis: null,
          evaluator_ref: null,
          enforcement_result: null,
          attempt: 1,
          execution_digest:
            result.status === "succeeded" ? result.execution.execution_digest : null,
          verification_digest:
            result.status === "succeeded" ? result.verification.verification_digest : null,
          verification_outcome: "verified",
          aggregate_outcome: "effect_observed",
          final_outcome: "succeeded",
        }),
      ).event_id,
    );
    assert(terminal);
    assert.equal(terminal.durability, "durable");
    await profile.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verified partial effect is withheld through the durable audit profile", async () => {
  const root = await repositoryRoot("lifecycle-audit-partial-");
  try {
    const source = structuredClone(planFixture()) as unknown as Record<string, unknown>;
    const operations = structuredClone(planFixture().operations) as unknown as Record<
      string,
      unknown
    >[];
    operations.push({
      step_id: "step_second",
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
    const approval = approvalFixture(plan);
    const profile = await openRepositoryLocalAuditProfileForQualification({
      trustedRepositoryRoot: root,
      writerRef: "impl_audit_writer001",
      now: () => new Date(NOW),
      filesystemHooks: { filesystemKindOverride: "ext" },
    });
    const streamRef = "stream_lifecycle_partial001";
    const writer = new AuditWriter({
      store: profile.store,
      streamRef,
      writerRef: "impl_audit_writer001",
      now: () => new Date(NOW),
    });
    await writer.commit(stream());
    for (const item of initialLifecycleCandidates(plan)) await writer.commit(item);
    const candidates = createLifecycleAuditCandidateFactory({
      plan,
      traceRef: "trace_lifecycle_engine001",
      requestRef: plan.request.request_id,
      requestEventRef: "event_lifecycle_request",
      planningEnforcementEventRef: "event_lifecycle_planning_enforcement",
      approvalRef: approval.approval_id,
      producer: {
        component_ref: "component.gateway",
        instance_ref: "instance.lifecycle-test",
      },
    });
    const effects = new FakeEffects();
    effects.steps = [
      {
        step_id: "step_update",
        state: "effect_observed",
        reason_code: "effect_observed",
        evidence_refs: ["evidence_effect001"],
      },
      {
        step_id: "step_second",
        state: "no_effect_proven",
        reason_code: "no_effect_proven",
        evidence_refs: ["evidence_no_effect001"],
      },
    ];
    const engine = new LifecycleEngine({
      clock: new FixedClock(),
      authorization: new FakeAuthorization(),
      conditions: new FakeConditions(),
      effects,
      verifier: new FakeVerifier(),
      audit: createAuditWriterLifecyclePort({
        writer,
        readiness: profile.readiness,
        journal: profile.journal,
        candidates,
      }),
      ledger: new MemoryLedger(),
    });
    const result = await engine.execute({ plan, approval });
    assert.equal(result.status, "partial_effect");
    assert.equal((await profile.store.tail(streamRef))?.event_type, "result.withheld.v1");
    await profile.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
