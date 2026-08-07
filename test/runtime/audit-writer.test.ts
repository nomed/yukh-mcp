import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AUDIT_REGISTRY,
  AuditError,
  type AuditCandidate,
  createAuditCandidate,
  validateAuditCandidate,
} from "../../packages/audit/src/contract.js";
import {
  commitBeforeProviderStart,
  createRecoveryFact,
  recordAfterProviderStart,
  type RecoveryFact,
} from "../../packages/audit/src/lifecycle.js";
import {
  openRepositoryLocalAuditProfileForQualification,
  type RepositoryLocalAuditProfile,
} from "../../packages/audit/src/repository-local.js";
import type { RepositoryLocalFilesystemEvent } from "../../packages/audit/src/repository-local-filesystem.js";
import {
  AUDIT_GENESIS_HASH,
  AuditWriter,
  InMemoryAuditStore,
  canonicalAuditJson,
  computeAuditEventHash,
  verifyAuditStream,
  type AuditCommitReceipt,
} from "../../packages/audit/src/writer.js";

const D1 = `sha256:${"1".repeat(64)}`;
const D2 = `sha256:${"2".repeat(64)}`;
const D3 = `sha256:${"3".repeat(64)}`;
const D4 = `sha256:${"4".repeat(64)}`;
const D5 = `sha256:${"5".repeat(64)}`;
const D6 = `sha256:${"6".repeat(64)}`;
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

function candidate(overrides: Record<string, unknown> = {}): AuditCandidate {
  return validateAuditCandidate({
    audit_candidate_version: 1,
    event_id: "event.request",
    event_type: "request.accepted.v1",
    occurred_at: "2026-08-06T07:00:00.000Z",
    producer: {
      component_ref: "component.gateway",
      instance_ref: "instance.test",
    },
    correlation: {
      ...NULL_CORRELATION,
      trace_ref: "trace.test",
      request_ref: "request.test",
    },
    causation: { parent_event_refs: [] },
    subject: { ref: "subject.test", kind: "workload" },
    capability: {
      id: "service.restart",
      version: "1.0.0",
      definition_digest: D1,
    },
    scope: {
      resource_kind: "service",
      resource_set_ref: "resources.test",
      resource_set_digest: D2,
      environment_ref: "test",
    },
    outcome: { status: "accepted", reason_codes: ["accepted"] },
    payload: { request_digest: D3 },
    ...overrides,
  });
}

function streamCandidate(): AuditCandidate {
  return candidate({
    event_id: "event.stream-opened",
    event_type: "audit.stream_opened.v1",
    producer: {
      component_ref: "component.audit-writer",
      instance_ref: "instance.test",
    },
    correlation: NULL_CORRELATION,
    subject: { ref: "service.audit-writer", kind: "system" },
    capability: {
      id: "audit.writer",
      version: "1.0.0",
      definition_digest: D1,
    },
    scope: {
      resource_kind: "security-domain",
      resource_set_ref: "resources.audit-domain",
      resource_set_digest: D2,
      environment_ref: "test",
    },
    outcome: { status: "accepted", reason_codes: ["accepted"] },
    payload: { genesis_hash: AUDIT_GENESIS_HASH },
  });
}

function evaluationCandidate(): AuditCandidate {
  return candidate({
    event_id: "event.evaluation",
    event_type: "authorization.evaluation_recorded.v1",
    correlation: {
      ...NULL_CORRELATION,
      trace_ref: "trace.test",
      request_ref: "request.test",
      authorization_request_ref: "auth-request.test",
    },
    causation: { parent_event_refs: ["event.request"] },
    outcome: { status: "accepted", reason_codes: ["accepted"] },
    payload: {
      authorization_request_digest: D3,
      attribute_snapshot_ref: "attributes.test",
      attribute_snapshot_digest: D2,
      evaluator_ref: "evaluator.test",
      authorization_phase: "planning",
      plan_digest: null,
    },
  });
}

function authCandidate(): AuditCandidate {
  return candidate({
    event_id: "event.authorization",
    event_type: "authorization.decision_recorded.v1",
    correlation: {
      ...NULL_CORRELATION,
      trace_ref: "trace.test",
      request_ref: "request.test",
      authorization_request_ref: "auth-request.test",
      authorization_decision_ref: "auth-decision.test",
    },
    causation: { parent_event_refs: ["event.evaluation"] },
    outcome: { status: "allowed", reason_codes: ["policy_allow"] },
    payload: {
      authorization_request_digest: D3,
      decision_digest: D4,
      effect: "allow",
      basis: "explicit",
      policy_revision_ref: "policy.test",
      policy_digest: D2,
      authorization_phase: "planning",
      plan_digest: null,
    },
  });
}

function enforcementCandidate(): AuditCandidate {
  return candidate({
    event_id: "event.enforcement",
    event_type: "authorization.enforcement_recorded.v1",
    correlation: authCandidate().correlation,
    causation: { parent_event_refs: ["event.authorization"] },
    outcome: { status: "allowed", reason_codes: ["enforced"] },
    payload: {
      decision_digest: D4,
      enforcement_result: "enforced",
      authorization_phase: "planning",
      plan_digest: null,
    },
  });
}

function freshEvaluationCandidate(): AuditCandidate {
  return validateAuditCandidate({
    ...evaluationCandidate(),
    event_id: "event.fresh-evaluation",
    correlation: {
      ...evaluationCandidate().correlation,
      authorization_request_ref: "auth-request.fresh",
      plan_ref: "plan.test",
      approval_ref: "approval.test",
    },
    causation: { parent_event_refs: ["event.request", "event.plan", "event.approval"] },
    payload: {
      ...evaluationCandidate().payload,
      authorization_request_digest: D6,
      authorization_phase: "apply",
      plan_digest: D1,
    },
  });
}

function freshAuthCandidate(): AuditCandidate {
  return validateAuditCandidate({
    ...authCandidate(),
    event_id: "event.fresh-authorization",
    correlation: {
      ...freshEvaluationCandidate().correlation,
      authorization_decision_ref: "auth-decision.fresh",
    },
    causation: { parent_event_refs: ["event.fresh-evaluation"] },
    payload: {
      ...authCandidate().payload,
      authorization_request_digest: D6,
      decision_digest: D5,
      authorization_phase: "apply",
      plan_digest: D1,
    },
  });
}

function freshEnforcementCandidate(): AuditCandidate {
  return validateAuditCandidate({
    ...enforcementCandidate(),
    event_id: "event.fresh-enforcement",
    correlation: freshAuthCandidate().correlation,
    causation: { parent_event_refs: ["event.fresh-authorization"] },
    payload: {
      decision_digest: D5,
      enforcement_result: "enforced",
      authorization_phase: "apply",
      plan_digest: D1,
    },
  });
}

function planCandidate(): AuditCandidate {
  return candidate({
    event_id: "event.plan",
    event_type: "plan.created.v1",
    correlation: {
      ...authCandidate().correlation,
      plan_ref: "plan.test",
    },
    causation: { parent_event_refs: ["event.enforcement"] },
    outcome: { status: "created", reason_codes: ["plan_created"] },
    payload: {
      plan_digest: D1,
      authorization_decision_digest: D4,
      observation_digest: D2,
    },
  });
}

function approvalRequestedCandidate(): AuditCandidate {
  return candidate({
    event_id: "event.approval-requested",
    event_type: "approval.requested.v1",
    correlation: {
      ...planCandidate().correlation,
      approval_ref: "approval.test",
    },
    causation: { parent_event_refs: ["event.plan"] },
    outcome: { status: "requested", reason_codes: ["approval_requested"] },
    payload: { plan_digest: D1 },
  });
}

function approvalCandidate(): AuditCandidate {
  return candidate({
    event_id: "event.approval",
    event_type: "approval.approved.v1",
    correlation: approvalRequestedCandidate().correlation,
    causation: { parent_event_refs: ["event.approval-requested", "event.plan"] },
    outcome: { status: "approved", reason_codes: ["approval_approved"] },
    payload: { plan_digest: D1, approval_digest: D2 },
  });
}

function applyCandidate(): AuditCandidate {
  return candidate({
    event_id: "event.apply",
    event_type: "apply.admitted.v1",
    correlation: {
      ...approvalCandidate().correlation,
      authorization_request_ref: "auth-request.fresh",
      authorization_decision_ref: "auth-decision.fresh",
      approval_ref: "approval.test",
      execution_ref: "execution.test",
    },
    causation: {
      parent_event_refs: ["event.fresh-enforcement", "event.plan", "event.approval"],
    },
    outcome: { status: "admitted", reason_codes: ["apply_admitted"] },
    payload: {
      plan_digest: D1,
      fresh_authorization_decision_digest: D5,
    },
  });
}

function reservedCandidate(): AuditCandidate {
  return candidate({
    event_id: "event.reserved",
    event_type: "execution.attempt_reserved.v1",
    correlation: applyCandidate().correlation,
    causation: { parent_event_refs: ["event.apply"] },
    outcome: { status: "reserved", reason_codes: ["attempt_reserved"] },
    payload: { plan_digest: D1, attempt: 1 },
  });
}

function startedCandidate(): AuditCandidate {
  return candidate({
    event_id: "event.started",
    event_type: "execution.started.v1",
    correlation: applyCandidate().correlation,
    causation: { parent_event_refs: ["event.reserved"] },
    outcome: { status: "started", reason_codes: ["provider_started"] },
    payload: { plan_digest: D1, attempt: 1 },
  });
}

function completedCandidate(): AuditCandidate {
  return candidate({
    event_id: "event.completed",
    event_type: "execution.completed.v1",
    correlation: applyCandidate().correlation,
    causation: { parent_event_refs: ["event.started"] },
    outcome: { status: "completed", reason_codes: ["effect_observed"] },
    payload: { plan_digest: D1, attempt: 1, result: "effect_observed" },
  });
}

function preEffectCandidates(): readonly AuditCandidate[] {
  return [
    candidate(),
    evaluationCandidate(),
    authCandidate(),
    enforcementCandidate(),
    planCandidate(),
    approvalRequestedCandidate(),
    approvalCandidate(),
    freshEvaluationCandidate(),
    freshAuthCandidate(),
    freshEnforcementCandidate(),
    applyCandidate(),
    reservedCandidate(),
  ];
}

const alwaysReady = Object.freeze({
  assertReadyForProviderStart: async (): Promise<void> => undefined,
});

async function committedChain() {
  const store = new InMemoryAuditStore();
  const writer = new AuditWriter({
    store,
    streamRef: "stream.test",
    writerRef: "writer.test",
    now: () => new Date("2026-08-06T07:00:01.000Z"),
  });
  for (const item of [
    streamCandidate(),
    candidate(),
    evaluationCandidate(),
    authCandidate(),
    enforcementCandidate(),
    planCandidate(),
    approvalRequestedCandidate(),
    approvalCandidate(),
    freshEvaluationCandidate(),
    freshAuthCandidate(),
    freshEnforcementCandidate(),
    applyCandidate(),
    reservedCandidate(),
    startedCandidate(),
    completedCandidate(),
  ]) {
    await writer.commit(item);
  }
  return { store, writer, events: store.readStream("stream.test") };
}

test("structurally projects only closed typed candidates", () => {
  const parsed = candidate();
  assert.deepEqual(Object.keys(parsed.payload), ["request_digest"]);
  assert.equal(parsed.event_type, "request.accepted.v1");

  for (const field of [
    "raw_prompt",
    "credential",
    "provider_body",
    "policy_source",
    "stack_trace",
    "metadata",
  ]) {
    assert.throws(
      () =>
        validateAuditCandidate({
          ...parsed,
          payload: { request_digest: D3, [field]: "do-not-retain-this-value" },
        }),
      (error: unknown) => {
        assert(error instanceof AuditError);
        assert.equal(error.code, "audit_candidate_invalid");
        assert.equal(JSON.stringify(error).includes("do-not-retain-this-value"), false);
        return true;
      },
    );
  }

  assert.throws(
    () =>
      validateAuditCandidate({
        ...parsed,
        classification: "operational",
        credential: "do-not-retain-this-value",
      }),
    (error: unknown) =>
      error instanceof AuditError &&
      error.code === "audit_candidate_invalid" &&
      !error.message.includes("do-not-retain-this-value"),
  );
});

test("constructs typed events while the writer revalidates its trust boundary", async () => {
  const typed = createAuditCandidate({
    ...candidate(),
    event_type: "request.accepted.v1",
    event_id: "event.typed",
    payload: { request_digest: D3 },
  } as AuditCandidate<"request.accepted.v1">);
  assert.equal(typed.payload.request_digest, D3);
  assert.equal(AUDIT_REGISTRY[typed.event_type].classification, "protected");

  const store = new InMemoryAuditStore();
  const writer = new AuditWriter({
    store,
    streamRef: "stream.validation",
    writerRef: "writer.test",
  });
  await writer.commit(streamCandidate());
  await assert.rejects(
    writer.commit({
      ...typed,
      payload: { request_digest: D3, raw_prompt: "must-not-cross-writer" },
    } as unknown as AuditCandidate),
    (error: unknown) =>
      error instanceof AuditError &&
      error.code === "audit_candidate_invalid" &&
      !error.message.includes("must-not-cross-writer"),
  );
});

test("canonical serialization is object-order independent and locale independent", () => {
  const first = { z: [3, { b: 2, a: 1 }], a: "value" };
  const second = { a: "value", z: [3, { a: 1, b: 2 }] };
  const expected = '{"a":"value","z":[3,{"a":1,"b":2}]}';
  assert.equal(canonicalAuditJson(first), expected);
  assert.equal(canonicalAuditJson(second), expected);
});

test("rejects malformed versions, references, correlation, and unbounded attempts", () => {
  const cases = [
    { ...candidate(), audit_candidate_version: 2 },
    { ...candidate(), event_type: "request.accepted.v2" },
    {
      ...candidate(),
      correlation: { ...candidate().correlation, request_ref: "contains whitespace" },
    },
    { ...candidate(), occurred_at: "2026-08-06T09:00:00.000+02:00" },
    {
      ...authCandidate(),
      payload: { ...authCandidate().payload, basis: "error" },
    },
    {
      ...enforcementCandidate(),
      outcome: {
        status: "allowed",
        reason_codes: ["enforced", "policy_deny"],
      },
    },
    {
      ...candidate(),
      outcome: { status: "accepted", reason_codes: ["accepted", "accepted"] },
    },
    { ...reservedCandidate(), payload: { plan_digest: D1, attempt: 17 } },
  ];
  for (const item of cases) {
    assert.throws(
      () => validateAuditCandidate(item),
      (error: unknown) => error instanceof AuditError && error.code === "audit_candidate_invalid",
    );
  }
});

test("rejects every non-explicit allow before provider invocation", async () => {
  for (const basis of ["default", "error", "indeterminate"] as const) {
    const nonExplicitAllow = {
      ...authCandidate(),
      payload: { ...authCandidate().payload, basis },
    } as AuditCandidate;
    assert.throws(
      () => validateAuditCandidate(nonExplicitAllow),
      (error: unknown) => error instanceof AuditError && error.code === "audit_candidate_invalid",
    );

    let starts = 0;
    let commits = 0;
    const result = await commitBeforeProviderStart({
      candidates: preEffectCandidates().map((item) =>
        item.event_id === "event.authorization" ? nonExplicitAllow : item,
      ),
      writer: {
        commit: async () => {
          commits += 1;
          throw new Error("invalid authorization must not reach the writer");
        },
      },
      readiness: alwaysReady,
      startProvider: async () => {
        starts += 1;
        return "started";
      },
    });
    assert.deepEqual(result, { status: "denied", code: "audit_unavailable" });
    assert.equal(commits, 0);
    assert.equal(starts, 0);
  }
});

test("assigns deterministic per-stream order and verifies the retained chain", async () => {
  const { events } = await committedChain();
  assert.deepEqual(
    events.map((event) => event.integrity.sequence),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  );
  assert.equal(events[0]?.integrity.previous_event_hash, AUDIT_GENESIS_HASH);
  assert.equal(events[0]?.classification, "operational");
  assert.equal(events[1]?.classification, "protected");
  assert.equal(
    events[0]?.integrity.event_hash,
    "sha256:a67c9208541d1593c9ccbc087732489c4c2bcf00e874e7a64438e2faddc53a80",
  );
  assert.equal(events[1]?.integrity.previous_event_hash, events[0]?.integrity.event_hash);
  assert.deepEqual(verifyAuditStream(events), { valid: true });
});

test("serializes concurrent producers without timestamp ordering authority", async () => {
  const store = new InMemoryAuditStore();
  const writer = new AuditWriter({
    store,
    streamRef: "stream.concurrent",
    writerRef: "writer.test",
  });
  await writer.commit(streamCandidate());
  const first = candidate({
    event_id: "event.request-a",
    occurred_at: "2026-08-06T07:00:03.000Z",
  });
  const second = candidate({
    event_id: "event.request-b",
    occurred_at: "2026-08-06T07:00:02.000Z",
  });
  await Promise.all([writer.commit(first), writer.commit(second)]);
  const events = store.readStream("stream.concurrent");
  assert.deepEqual(
    events.map((event) => event.integrity.sequence),
    [0, 1, 2],
  );
  assert.deepEqual(verifyAuditStream(events), { valid: true });
});

test("returns exact duplicates and rejects conflicting event identity reuse", async () => {
  const store = new InMemoryAuditStore();
  const writer = new AuditWriter({
    store,
    streamRef: "stream.duplicate",
    writerRef: "writer.test",
  });
  await writer.commit(streamCandidate());
  const original = await writer.commit(candidate());
  const duplicate = await writer.commit(candidate());
  assert.equal(duplicate.duplicate, true);
  assert.strictEqual(duplicate.event, original.event);

  await assert.rejects(
    writer.commit(
      candidate({
        payload: { request_digest: D4 },
      }),
    ),
    (error: unknown) => error instanceof AuditError && error.code === "audit_duplicate_conflict",
  );
});

test("rejects causal type and operation substitution", async () => {
  const store = new InMemoryAuditStore();
  const writer = new AuditWriter({
    store,
    streamRef: "stream.causation",
    writerRef: "writer.test",
  });

  await writer.commit(streamCandidate());
  await writer.commit(candidate());
  await writer.commit(evaluationCandidate());
  await assert.rejects(
    writer.commit(
      authCandidate().correlation.trace_ref === "trace.test"
        ? validateAuditCandidate({
            ...authCandidate(),
            correlation: { ...authCandidate().correlation, trace_ref: "trace.substituted" },
          })
        : authCandidate(),
    ),
    (error: unknown) => error instanceof AuditError && error.code === "audit_causation_invalid",
  );

  await assert.rejects(
    writer.commit(
      validateAuditCandidate({
        ...authCandidate(),
        event_id: "event.authorization-digest-substitution",
        payload: {
          ...authCandidate().payload,
          authorization_request_digest: D4,
        },
      }),
    ),
    (error: unknown) => error instanceof AuditError && error.code === "audit_causation_invalid",
  );
});

test("prevents a denied authorization from causing enforcement or planning", async () => {
  const store = new InMemoryAuditStore();
  const writer = new AuditWriter({
    store,
    streamRef: "stream.denied",
    writerRef: "writer.test",
  });

  await writer.commit(streamCandidate());
  await writer.commit(candidate());
  await writer.commit(evaluationCandidate());
  await writer.commit(
    validateAuditCandidate({
      ...authCandidate(),
      outcome: { status: "denied", reason_codes: ["policy_deny"] },
      payload: { ...authCandidate().payload, effect: "deny" },
    }),
  );
  await assert.rejects(
    writer.commit(enforcementCandidate()),
    (error: unknown) => error instanceof AuditError && error.code === "audit_causation_invalid",
  );
});

test("binds planning to its decision and rejects stale planning authorization at apply", async () => {
  const store = new InMemoryAuditStore();
  const writer = new AuditWriter({
    store,
    streamRef: "stream.stale-apply",
    writerRef: "writer.test",
  });
  for (const item of [
    streamCandidate(),
    candidate(),
    evaluationCandidate(),
    authCandidate(),
    enforcementCandidate(),
    planCandidate(),
  ]) {
    await writer.commit(item);
  }
  await assert.rejects(
    writer.commit(freshEvaluationCandidate()),
    (error: unknown) => error instanceof AuditError && error.code === "audit_causation_invalid",
  );
  await writer.commit(approvalRequestedCandidate());
  await writer.commit(approvalCandidate());

  const staleAdmission = validateAuditCandidate({
    ...applyCandidate(),
    event_id: "event.stale-apply",
    correlation: {
      ...applyCandidate().correlation,
      authorization_request_ref: "auth-request.test",
      authorization_decision_ref: "auth-decision.test",
    },
    causation: { parent_event_refs: ["event.enforcement", "event.plan", "event.approval"] },
    payload: {
      ...applyCandidate().payload,
      fresh_authorization_decision_digest: D4,
    },
  });
  await assert.rejects(
    writer.commit(staleAdmission),
    (error: unknown) => error instanceof AuditError && error.code === "audit_causation_invalid",
  );

  let starts = 0;
  const staleLifecycle = await commitBeforeProviderStart({
    candidates: preEffectCandidates().map((item) =>
      item.event_id === "event.apply" ? staleAdmission : item,
    ),
    writer: {
      commit: async () => {
        throw new Error("stale authorization must fail before commit");
      },
    },
    readiness: alwaysReady,
    startProvider: async () => {
      starts += 1;
      return "started";
    },
  });
  assert.deepEqual(staleLifecycle, { status: "denied", code: "audit_unavailable" });
  assert.equal(starts, 0);
});

test("detects mutation, deletion, reorder, reset, and cross-stream substitution", async () => {
  const { events } = await committedChain();
  assert.deepEqual(verifyAuditStream([{} as never]), {
    valid: false,
    code: "audit_integrity_failure",
  });
  const mutation = events.map((event, index) =>
    index === 3
      ? {
          ...event,
          payload: {
            ...event.payload,
            value: { ...event.payload.value, plan_digest: D4 },
          },
        }
      : event,
  );
  assert.equal(verifyAuditStream(mutation).valid, false);

  assert.equal(verifyAuditStream(events.filter((_, index) => index !== 3)).valid, false);
  assert.equal(
    verifyAuditStream([events[0]!, events[2]!, events[1]!, ...events.slice(3)]).valid,
    false,
  );

  const reset = events.map((event, index) =>
    index === 4
      ? {
          ...event,
          integrity: { ...event.integrity, previous_event_hash: AUDIT_GENESIS_HASH },
        }
      : event,
  );
  assert.equal(verifyAuditStream(reset).valid, false);

  const substitution = events.map((event, index) =>
    index === 2
      ? {
          ...event,
          integrity: { ...event.integrity, stream_ref: "stream.other" },
        }
      : event,
  );
  assert.equal(verifyAuditStream(substitution).valid, false);

  const extraEnvelopeField = events.map((event, index) =>
    index === 2 ? { ...event, credential: "forbidden" } : event,
  );
  assert.equal(verifyAuditStream(extraEnvelopeField as unknown as typeof events).valid, false);

  for (const resetIndex of [1, 7, events.length - 1]) {
    let previousHash = AUDIT_GENESIS_HASH;
    const insertedOpening = events.map((event, index) => {
      const source = index === resetIndex ? events[0]! : event;
      const { event_hash: _eventHash, ...sourceIntegrity } = source.integrity;
      const integrity = {
        ...sourceIntegrity,
        sequence: index,
        previous_event_hash: previousHash,
      };
      const rehashed = {
        ...source,
        integrity: {
          ...integrity,
          event_hash: computeAuditEventHash({ ...source, integrity }),
        },
      };
      previousHash = rehashed.integrity.event_hash;
      return rehashed;
    });
    assert.deepEqual(verifyAuditStream(insertedOpening), {
      valid: false,
      code: "audit_integrity_failure",
      sequence: resetIndex,
    });
  }
});

test("fails closed before provider start unless every receipt is durable", async () => {
  const { writer } = await committedChain();
  let starts = 0;
  const volatile = await commitBeforeProviderStart({
    candidates: preEffectCandidates(),
    writer,
    readiness: alwaysReady,
    startProvider: async () => {
      starts += 1;
      return "started";
    },
  });
  assert.deepEqual(volatile, { status: "denied", code: "audit_unavailable" });
  assert.equal(starts, 0);

  const durableWriter = {
    commit: async (item: AuditCandidate): Promise<AuditCommitReceipt> => {
      const receipt = await writer.commit(item);
      return { ...receipt, durability: "durable" };
    },
  };
  const incomplete = await commitBeforeProviderStart({
    candidates: [candidate()],
    writer: durableWriter,
    readiness: alwaysReady,
    startProvider: async () => {
      starts += 1;
      return "started";
    },
  });
  assert.deepEqual(incomplete, { status: "denied", code: "audit_unavailable" });
  assert.equal(starts, 0);

  const durable = await commitBeforeProviderStart({
    candidates: preEffectCandidates(),
    writer: durableWriter,
    readiness: alwaysReady,
    startProvider: async () => {
      starts += 1;
      return "started";
    },
  });
  assert.deepEqual(durable, { status: "started", value: "started" });
  assert.equal(starts, 1);
});

test("final capacity and failed-health duplicates never authorize provider start", async () => {
  const createdRoot = await mkdtemp(path.join(tmpdir(), "audit-readiness-capacity-"));
  await chmod(createdRoot, 0o700);
  const root = await realpath(createdRoot);
  let profile: RepositoryLocalAuditProfile | undefined;
  let closed = false;
  try {
    let armed = false;
    let remainingIdentitySyncs = 0;
    const hooks = {
      filesystemKindOverride: "ext" as const,
      availableBytesOverride: BigInt(Number.MAX_SAFE_INTEGER),
      onEvent: (event: RepositoryLocalFilesystemEvent) => {
        if (armed && event === "primary_identity.after_directory_sync") {
          remainingIdentitySyncs -= 1;
          if (remainingIdentitySyncs === 0) hooks.availableBytesOverride = 0n;
        }
      },
    };
    profile = await openRepositoryLocalAuditProfileForQualification({
      trustedRepositoryRoot: root,
      writerRef: "writer.test",
      now: () => new Date("2026-08-06T07:00:01.000Z"),
      filesystemHooks: hooks,
    });
    const writer = new AuditWriter({
      store: profile.store,
      streamRef: "stream.test",
      writerRef: "writer.test",
      now: () => new Date("2026-08-06T07:00:01.000Z"),
    });
    await writer.commit(streamCandidate());
    const candidates = preEffectCandidates();
    armed = true;
    remainingIdentitySyncs = candidates.length;
    let starts = 0;
    let durableReceipts = 0;
    const exhausted = await commitBeforeProviderStart({
      candidates,
      writer: {
        commit: async (item) => {
          const receipt = await writer.commit(item);
          assert.equal(receipt.durability, "durable");
          durableReceipts += 1;
          return receipt;
        },
      },
      readiness: profile.readiness,
      startProvider: async () => {
        starts += 1;
        return "started";
      },
    });
    assert.deepEqual(exhausted, { status: "denied", code: "audit_unavailable" });
    assert.equal(remainingIdentitySyncs, 0);
    assert.equal(durableReceipts, candidates.length);
    assert.equal(profile.diagnostic().reason, "capacity_exhausted");
    assert.equal(starts, 0);

    let duplicateReceipts = 0;
    const duplicates = await commitBeforeProviderStart({
      candidates,
      writer: {
        commit: async (item) => {
          const receipt = await writer.commit(item);
          assert.equal(receipt.duplicate, true);
          duplicateReceipts += 1;
          return receipt;
        },
      },
      readiness: profile.readiness,
      startProvider: async () => {
        starts += 1;
        return "started";
      },
    });
    assert.deepEqual(duplicates, { status: "denied", code: "audit_unavailable" });
    assert.equal(duplicateReceipts, candidates.length);
    assert.equal(starts, 0);
    await profile.close();
    closed = true;
  } finally {
    if (profile !== undefined && !closed) await profile.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("journals one bounded fact after start, withholds success, and never retries", async () => {
  const { writer } = await committedChain();
  const receipt = await writer.commit(
    candidate({
      event_id: "event.post-start-fixture",
    }),
  );
  let writerCalls = 0;
  let journalCalls = 0;
  const recoveryFact = createRecoveryFact("recovery.test", completedCandidate());
  const result = await recordAfterProviderStart({
    candidate: completedCandidate(),
    writer: {
      commit: async () => {
        writerCalls += 1;
        throw new Error("provider response must not escape");
      },
    },
    recoveryFact,
    journal: {
      append: async (fact) => {
        journalCalls += 1;
        assert.deepEqual(fact, recoveryFact);
        return { durability: "durable" };
      },
    },
  });
  assert.deepEqual(result, {
    status: "withheld",
    code: "operation_outcome_unknown",
    recovery: "journaled",
  });
  assert.equal(writerCalls, 1);
  assert.equal(journalCalls, 1);

  const startedRecoveryFact = createRecoveryFact("recovery.started", startedCandidate());
  let startedJournalCalls = 0;
  const startedFailure = await recordAfterProviderStart({
    candidate: startedCandidate(),
    writer: {
      commit: async () => {
        throw new Error("closed failure");
      },
    },
    recoveryFact: startedRecoveryFact,
    journal: {
      append: async (fact) => {
        startedJournalCalls += 1;
        assert.deepEqual(fact, startedRecoveryFact);
        return { durability: "durable" };
      },
    },
  });
  assert.deepEqual(startedFailure, {
    status: "withheld",
    code: "operation_outcome_unknown",
    recovery: "journaled",
  });
  assert.equal(startedJournalCalls, 1);

  assert.throws(
    () => createRecoveryFact("recovery.untrusted", candidate()),
    (error: unknown) => error instanceof AuditError && error.code === "audit_candidate_invalid",
  );
  assert.throws(
    () =>
      createRecoveryFact("recovery.invalid-observation", {
        ...completedCandidate(),
        payload: { ...completedCandidate().payload, raw_prompt: "forbidden" },
      }),
    (error: unknown) => error instanceof AuditError && error.code === "audit_candidate_invalid",
  );

  let invalidCandidateWriterCalls = 0;
  let invalidCandidateJournalCalls = 0;
  const invalidCandidate = await recordAfterProviderStart({
    candidate: {
      ...completedCandidate(),
      payload: { ...completedCandidate().payload, raw_prompt: "forbidden" },
    },
    writer: {
      commit: async () => {
        invalidCandidateWriterCalls += 1;
        throw new Error("invalid candidate must not reach the writer");
      },
    },
    recoveryFact,
    journal: {
      append: async () => {
        invalidCandidateJournalCalls += 1;
        return { durability: "durable" };
      },
    },
  });
  assert.deepEqual(invalidCandidate, {
    status: "withheld",
    code: "operation_outcome_unknown",
    recovery: "journaled",
  });
  assert.equal(invalidCandidateWriterCalls, 0);
  assert.equal(invalidCandidateJournalCalls, 1);

  const unrelatedObservation = validateAuditCandidate({
    ...completedCandidate(),
    event_id: "event.unrelated-completed",
  });
  const unrelatedRecoveryFact = createRecoveryFact("recovery.unrelated", unrelatedObservation);
  let unrelatedJournalCalls = 0;
  const unrelatedSubstitution = await recordAfterProviderStart({
    candidate: {
      ...completedCandidate(),
      producer: { ...completedCandidate().producer, unexpected: "invalid-outside-binding" },
    },
    writer: {
      commit: async () => {
        throw new Error("invalid candidate must not reach the writer");
      },
    },
    recoveryFact: unrelatedRecoveryFact,
    journal: {
      append: async () => {
        unrelatedJournalCalls += 1;
        return { durability: "durable" };
      },
    },
  });
  assert.deepEqual(unrelatedSubstitution, {
    status: "withheld",
    code: "operation_outcome_unknown",
    recovery: "journal_unavailable",
  });
  assert.equal(unrelatedJournalCalls, 0);

  let forgedJournalCalls = 0;
  const forged = await recordAfterProviderStart({
    candidate: {
      ...completedCandidate(),
      payload: { ...completedCandidate().payload, raw_prompt: "forbidden" },
    },
    writer: {
      commit: async () => {
        throw new Error("invalid candidate must not reach the writer");
      },
    },
    recoveryFact: { ...recoveryFact } as RecoveryFact,
    journal: {
      append: async () => {
        forgedJournalCalls += 1;
        return { durability: "durable" };
      },
    },
  });
  assert.deepEqual(forged, {
    status: "withheld",
    code: "operation_outcome_unknown",
    recovery: "journal_unavailable",
  });
  assert.equal(forgedJournalCalls, 0);

  let nonExecutionJournalCalls = 0;
  const nonExecution = await recordAfterProviderStart({
    candidate: candidate(),
    writer: {
      commit: async () => {
        throw new Error("pre-effect candidate must not reach the writer");
      },
    },
    recoveryFact,
    journal: {
      append: async () => {
        nonExecutionJournalCalls += 1;
        return { durability: "durable" };
      },
    },
  });
  assert.deepEqual(nonExecution, {
    status: "withheld",
    code: "operation_outcome_unknown",
    recovery: "journal_unavailable",
  });
  assert.equal(nonExecutionJournalCalls, 0);

  const unavailable = await recordAfterProviderStart({
    candidate: completedCandidate(),
    writer: { commit: async () => ({ ...receipt, durability: "volatile_test_only" }) },
    recoveryFact,
    journal: {
      append: async () => {
        throw new Error("journal detail must not escape");
      },
    },
  });
  assert.deepEqual(unavailable, {
    status: "withheld",
    code: "operation_outcome_unknown",
    recovery: "journal_unavailable",
  });

  let substitutedJournalCalls = 0;
  const substituted = await recordAfterProviderStart({
    candidate: completedCandidate(),
    writer: {
      commit: async () => {
        throw new Error("closed failure");
      },
    },
    recoveryFact: { ...recoveryFact, execution_ref: "execution.substituted" },
    journal: {
      append: async () => {
        substitutedJournalCalls += 1;
        return { durability: "durable" };
      },
    },
  });
  assert.deepEqual(substituted, {
    status: "withheld",
    code: "operation_outcome_unknown",
    recovery: "journal_unavailable",
  });
  assert.equal(substitutedJournalCalls, 0);

  for (const substitution of [
    { observed_outcome: "no_effect_proven" as const },
    { plan_digest: D2 },
    { attempt: 2 },
    { original_observed_at: "2026-08-06T07:00:01.000Z" },
    { original_observation_parent_event_ref: "event.substituted-start" },
    { recovery_id: `r${"x".repeat(128)}` },
  ]) {
    let journalCallsForSubstitution = 0;
    const bindingMismatch = await recordAfterProviderStart({
      candidate: completedCandidate(),
      writer: {
        commit: async () => {
          throw new Error("closed failure");
        },
      },
      recoveryFact: { ...recoveryFact, ...substitution },
      journal: {
        append: async () => {
          journalCallsForSubstitution += 1;
          return { durability: "durable" };
        },
      },
    });
    assert.deepEqual(bindingMismatch, {
      status: "withheld",
      code: "operation_outcome_unknown",
      recovery: "journal_unavailable",
    });
    assert.equal(journalCallsForSubstitution, 0);
  }

  const invalidBindings: readonly unknown[] = [
    {
      ...completedCandidate(),
      event_id: `event.${"x".repeat(123)}`,
    },
    {
      ...completedCandidate(),
      occurred_at: `2026-08-06T07:00:00.${"1".repeat(100_000)}Z`,
    },
    {
      ...completedCandidate(),
      correlation: {
        ...completedCandidate().correlation,
        execution_ref: `execution.${"x".repeat(119)}`,
      },
    },
    {
      ...completedCandidate(),
      payload: {
        ...completedCandidate().payload,
        plan_digest: `sha256:${"1".repeat(65)}`,
      },
    },
    {
      ...completedCandidate(),
      payload: {
        ...completedCandidate().payload,
        attempt: 17,
      },
    },
    {
      ...completedCandidate(),
      payload: {
        ...completedCandidate().payload,
        result: "provider_body",
      },
    },
    {
      ...completedCandidate(),
      outcome: {
        status: "completed",
        reason_codes: ["no_effect_proven"],
      },
    },
    {
      ...completedCandidate(),
      causation: {
        parent_event_refs: [`event.${"x".repeat(123)}`],
      },
    },
  ];
  for (const invalidBinding of invalidBindings) {
    let malformedJournalCalls = 0;
    const malformed = await recordAfterProviderStart({
      candidate: invalidBinding,
      writer: {
        commit: async () => {
          throw new Error("invalid candidate must not reach the writer");
        },
      },
      recoveryFact,
      journal: {
        append: async () => {
          malformedJournalCalls += 1;
          return { durability: "durable" };
        },
      },
    });
    assert.deepEqual(malformed, {
      status: "withheld",
      code: "operation_outcome_unknown",
      recovery: "journal_unavailable",
    });
    assert.equal(malformedJournalCalls, 0);
  }
});

test("bounds RFC3339 fractional precision for audit and recovery timestamps", async () => {
  for (const occurredAt of [
    "2026-08-06T07:00:00.12Z",
    "2026-08-06T07:00:00.123456Z",
    "2026-08-06T07:00:00.123456789Z",
  ]) {
    const observation = validateAuditCandidate({
      ...completedCandidate(),
      occurred_at: occurredAt,
    });
    const recoveryFact = createRecoveryFact(`recovery.precision-${occurredAt.length}`, observation);
    let journalCalls = 0;
    const result = await recordAfterProviderStart({
      candidate: observation,
      writer: {
        commit: async () => {
          throw new Error("closed failure");
        },
      },
      recoveryFact,
      journal: {
        append: async (fact) => {
          journalCalls += 1;
          assert.equal(fact.original_observed_at, occurredAt);
          return { durability: "durable" };
        },
      },
    });
    assert.deepEqual(result, {
      status: "withheld",
      code: "operation_outcome_unknown",
      recovery: "journaled",
    });
    assert.equal(journalCalls, 1);
  }

  assert.throws(
    () =>
      createRecoveryFact("recovery.invalid-precision", {
        ...completedCandidate(),
        occurred_at: "2026-08-06T07:00:00.Z",
      }),
    (error: unknown) => error instanceof AuditError && error.code === "audit_candidate_invalid",
  );

  for (const occurredAt of [
    "2026-08-06T07:00:00.1234567890Z",
    `2026-08-06T07:00:00.${"1".repeat(100_000)}Z`,
  ]) {
    assert.throws(
      () => validateAuditCandidate({ ...completedCandidate(), occurred_at: occurredAt }),
      (error: unknown) => error instanceof AuditError && error.code === "audit_candidate_invalid",
    );
  }
});
