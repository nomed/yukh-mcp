import {
  buildAuthorizationRequest,
  combineAuthorization,
  type AuthorizationDecisionV1,
  type AuthorizationRequestV1,
} from "../../contracts/authorization/v1/authorization.mjs";
import {
  approvalBindingsForPlan,
  lifecycleDigest,
  validateApprovalReceipt,
  validateMutationPlan,
  type ApprovalReceiptV1,
  type ExecutionRecordV1,
  type ExecutionStepRecord,
  type MutationPlanV1,
  type RollbackRecordV1,
  type VerificationObservation,
  type VerificationRecordV1,
} from "../../packages/lifecycle/src/contract.js";
import { LifecycleEngine } from "../../packages/lifecycle/src/engine.js";
import {
  LifecyclePortError,
  type AttemptReservationBinding,
  type AttemptReservationLedger,
  type AttemptReservationSnapshot,
  type FreshAuthorizationPort,
  type FreshAuthorizationResult,
  type LifecycleAuditPort,
  type LifecycleAuditRecord,
  type LifecycleBoundary,
  type LifecycleClock,
  type LifecycleConditionPort,
  type LifecycleEffectPort,
  type LifecycleVerificationPort,
  type ReservationState,
} from "../../packages/lifecycle/src/ports.js";

export const NOW = "2026-08-08T07:05:39.000Z";
export const LATER = "2026-08-08T07:06:00.000Z";
export const NORMALIZED_INPUT = Object.freeze({ name: "example", value: "enabled" });

export function digest(label: string): string {
  return lifecycleDigest(label);
}

const definition = Object.freeze({
  capability: { id: "example.setting.update", version: "1.0.0" },
  operation: { class: "mutate", effects: ["update"] },
  approval: { mode: "explicit" },
} as const);
const rollbackDefinition = Object.freeze({
  capability: { id: "example.setting.restore", version: "1.0.0" },
  operation: { class: "mutate", effects: ["update"] },
  approval: { mode: "explicit" },
} as const);

function condition(reference: string, type: MutationPlanV1["preconditions"][number]["type"]) {
  return {
    condition_ref: reference,
    type,
    expected_digest: digest(`${reference}:expected`),
    observation_ref: `observation_${reference}`,
    observed_at: "2026-08-08T07:00:00Z",
    fresh_until: "2026-08-08T08:00:00Z",
    classification: "protected" as const,
  };
}

function sealOperations(
  operations: readonly Omit<MutationPlanV1["operations"][number], "operation_digest">[],
) {
  return operations.map((operation) =>
    Object.freeze({ ...operation, operation_digest: lifecycleDigest(operation) }),
  );
}

export function sealPlan(value: unknown): MutationPlanV1 {
  const candidate = structuredClone(value) as Record<string, unknown>;
  const operations = candidate.operations;
  if (Array.isArray(operations)) {
    candidate.operations = operations.map((operation) => {
      if (typeof operation !== "object" || operation === null || Array.isArray(operation)) {
        return operation;
      }
      const entries = Object.entries(operation).filter(([key]) => key !== "operation_digest");
      const base = Object.fromEntries(entries);
      return { ...base, operation_digest: lifecycleDigest(base) };
    });
    candidate.operation_set_digest = lifecycleDigest(candidate.operations);
  }
  delete candidate.plan_digest;
  candidate.plan_digest = lifecycleDigest(candidate);
  return validateMutationPlan(candidate);
}

export function planFixture(overrides: Readonly<Record<string, unknown>> = {}): MutationPlanV1 {
  const preconditions = [
    condition("condition_resource_version", "existence_version"),
    condition("condition_capacity", "capacity_bound"),
  ];
  const postconditions = [condition("condition_value_matches", "selected_field_digest")];
  const operations = sealOperations([
    {
      step_id: "step_update",
      depends_on: [],
      effect: "update",
      precondition_refs: preconditions.map(({ condition_ref }) => condition_ref),
      postcondition_refs: postconditions.map(({ condition_ref }) => condition_ref),
    },
  ]);
  const base = {
    lifecycle_plan_version: 1,
    plan_id: "plan_example001",
    request: {
      request_id: "request_example001",
      request_digest: digest("capability-request"),
      normalized_input_digest: lifecycleDigest(NORMALIZED_INPUT),
    },
    subject: {
      ref: "subject_example001",
      kind: "workload",
      authentication_context_ref: "authctx_example001",
      authentication_context_digest: digest("auth-context"),
      authentication_strength: "workload_attested",
    },
    capability: {
      id: definition.capability.id,
      version: definition.capability.version,
      definition_digest: lifecycleDigest(definition),
      operation_class: "mutate",
      effects: ["update"],
      approval_mode: "explicit",
    },
    scope: {
      resource_kind: "example_setting",
      resource_refs: ["setting-example-01"],
      resource_attributes_digest: digest("resource-attributes"),
      resource_set_ref: "resources_example001",
      resource_set_digest: digest("resource-set"),
      environment_ref: "development",
      environment_attributes_digest: digest("environment-attributes"),
    },
    planning_authorization: {
      request_id: "authreq_planning001",
      request_digest: digest("planning-request"),
      decision_id: "decision_planning001",
      decision_digest: digest("planning-decision"),
    },
    policy: {
      bundle_ref: "policy_example001",
      revision: 17,
      digest: digest("policy"),
    },
    attributes: {
      snapshot_ref: "attributes_example001",
      digest: digest("attributes"),
      observed_at: "2026-08-08T07:00:00Z",
    },
    target_snapshot: {
      snapshot_ref: "target_example001",
      digest: digest("target"),
      observed_at: "2026-08-08T07:00:00Z",
    },
    planner_ref: "impl_planner_example001",
    operations,
    operation_set_digest: lifecycleDigest(operations),
    preconditions,
    postconditions,
    predicted_effects: [
      {
        effect: "update",
        resource_set_digest: digest("resource-set"),
        destructive: false,
        data_classes: ["synthetic_configuration"],
      },
    ],
    approval: { required: true, level: "elevated" },
    idempotency: {
      classification: "keyed",
      key_digest: digest("idempotency-key"),
      max_attempts: 1,
      retry: "never",
    },
    timeout_ms: 10_000,
    verification: {
      profile: "independent",
      verifier_ref: "impl_verifier_example001",
      postcondition_refs: postconditions.map(({ condition_ref }) => condition_ref),
    },
    rollback: {
      mode: "compensating",
      capability: {
        id: rollbackDefinition.capability.id,
        version: rollbackDefinition.capability.version,
        definition_digest: lifecycleDigest(rollbackDefinition),
      },
    },
    rollback_context: null,
    created_at: "2026-08-08T07:00:00Z",
    expires_at: "2026-08-08T08:00:00Z",
    ...overrides,
  };
  return sealPlan(base);
}

export function approvalFixture(
  plan: MutationPlanV1,
  overrides: Readonly<Record<string, unknown>> = {},
): ApprovalReceiptV1 {
  const base = {
    approval_receipt_version: 1,
    approval_id: "approval_example001",
    decision: "approve",
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    actor: {
      ref: "subject_approver001",
      authentication_context_ref: "authctx_approver001",
      authentication_context_digest: digest("approver-auth-context"),
      authentication_strength: "phishing_resistant",
    },
    authority_ref: "impl_approval_authority001",
    approval_policy_ref: "approval_policy_example001",
    approval_policy_digest: digest("approval-policy"),
    nonce_digest: digest("approval-nonce"),
    bindings: approvalBindingsForPlan(plan),
    required_level: "elevated",
    satisfied_level: "elevated",
    issued_at: "2026-08-08T07:01:00Z",
    expires_at: "2026-08-08T07:30:00Z",
    ...overrides,
  };
  return validateApprovalReceipt({ ...base, approval_digest: lifecycleDigest(base) }, plan, NOW);
}

function authorizationEvaluation(request: AuthorizationRequestV1, effect: "allow" | "deny") {
  return {
    evaluation_version: 1,
    authorization_request_id: request.authorization_request_id,
    request_digest: request.request_digest,
    policy: structuredClone(request.policy),
    evaluator_ref: "impl_evaluator_example001",
    evaluated_at: NOW,
    statements: [
      {
        statement_ref: `statement_${effect}`,
        effect,
        reason_code: effect === "allow" ? "policy_allow_apply" : "policy_deny_apply",
        constraints: [],
        obligations: [],
      },
    ],
  };
}

export function authorizationFixture(
  plan: MutationPlanV1,
  sequence = 1,
  effect: "allow" | "deny" = "allow",
): FreshAuthorizationResult {
  const selectedDefinition =
    plan.capability.id === rollbackDefinition.capability.id ? rollbackDefinition : definition;
  const request = buildAuthorizationRequest({
    authorization_request_id: `authreq_apply${sequence.toString().padStart(3, "0")}`,
    subject: {
      ref: plan.subject.ref,
      kind: plan.subject.kind,
      authentication_context_ref: plan.subject.authentication_context_ref,
      authentication_strength: plan.subject.authentication_strength,
    },
    definition: selectedDefinition,
    resource: {
      kind: plan.scope.resource_kind,
      refs: [...plan.scope.resource_refs],
      attributes_digest: plan.scope.resource_attributes_digest,
    },
    environment: {
      ref: plan.scope.environment_ref,
      attributes_digest: plan.scope.environment_attributes_digest,
    },
    normalized_input: NORMALIZED_INPUT,
    risk: "high",
    requested_at: NOW,
    policy: structuredClone(plan.policy),
    attributes: structuredClone(plan.attributes),
  }) as AuthorizationRequestV1;
  const decision = combineAuthorization({
    request,
    evaluation: authorizationEvaluation(request, effect),
    decision_id: `decision_apply${sequence.toString().padStart(3, "0")}`,
    issued_at: NOW,
    expires_at: "2026-08-08T07:30:00Z",
  }) as AuthorizationDecisionV1;
  return Object.freeze({
    request,
    decision,
    authentication_context_digest: plan.subject.authentication_context_digest,
    constraint_handlers: Object.freeze({}),
    obligation_receipts: Object.freeze([]),
  });
}

export class FixedClock implements LifecycleClock {
  constructor(public value = NOW) {}

  now(): string {
    return this.value;
  }
}

export class FakeAuthorization implements FreshAuthorizationPort {
  calls = 0;
  effect: "allow" | "deny" = "allow";
  unavailable = false;
  mutate?: (result: FreshAuthorizationResult) => FreshAuthorizationResult;

  async authorize(input: Readonly<{ plan: MutationPlanV1; approval: ApprovalReceiptV1 | null }>) {
    this.calls += 1;
    if (this.unavailable) throw new LifecyclePortError("authorization_unavailable");
    const result = authorizationFixture(input.plan, this.calls, this.effect);
    return this.mutate?.(result) ?? result;
  }
}

export class FakeConditions implements LifecycleConditionPort {
  calls = 0;
  mismatch = false;
  unavailable = false;
  observedAt = NOW;

  async observe(
    input: Readonly<{
      plan: MutationPlanV1;
      condition: MutationPlanV1["preconditions"][number];
    }>,
  ) {
    this.calls += 1;
    if (this.unavailable) throw new LifecyclePortError("precondition_unavailable");
    return Object.freeze({
      condition_ref: input.condition.condition_ref,
      observation_ref: input.condition.observation_ref,
      observation_digest: this.mismatch
        ? digest("changed-precondition")
        : input.condition.expected_digest,
      observed_at: this.observedAt,
    });
  }
}

export class FakeEffects implements LifecycleEffectPort {
  calls = 0;
  unavailable = false;
  steps?: readonly ExecutionStepRecord[];

  async apply(
    input: Readonly<{
      execution_ref: string;
      plan: MutationPlanV1;
      attempt: number;
      signal: AbortSignal;
    }>,
  ) {
    this.calls += 1;
    if (this.unavailable) throw new LifecyclePortError("effect_unavailable");
    return Object.freeze({
      steps:
        this.steps ??
        input.plan.operations.map((operation) =>
          Object.freeze({
            step_id: operation.step_id,
            state: "effect_observed" as const,
            reason_code: "effect_observed" as const,
            evidence_refs: Object.freeze(["evidence_effect001"]),
          }),
        ),
    });
  }
}

export class FakeVerifier implements LifecycleVerificationPort {
  calls = 0;
  unavailable = false;
  status: VerificationObservation["status"] = "verified";
  mutate?: (observations: readonly VerificationObservation[]) => readonly VerificationObservation[];

  async verify(
    input: Readonly<{
      verification_ref: string;
      plan: MutationPlanV1;
      execution: ExecutionRecordV1;
      signal: AbortSignal;
    }>,
  ) {
    this.calls += 1;
    if (this.unavailable) throw new LifecyclePortError("verification_unavailable");
    const observations = input.plan.postconditions.map((condition) =>
      Object.freeze({
        condition_ref: condition.condition_ref,
        status: this.status,
        observation_digest:
          this.status === "verified"
            ? condition.expected_digest
            : digest(`${this.status}:${condition.condition_ref}`),
        evidence_ref: "evidence_verification001",
        observed_at: NOW,
      }),
    );
    return Object.freeze({ observations: this.mutate?.(observations) ?? observations });
  }
}

export class FakeAudit implements LifecycleAuditPort {
  readonly records: LifecycleAuditRecord[] = [];
  ready = true;
  failStage: LifecycleAuditRecord["stage"] | null = null;
  recoveryDurable = true;
  recoveries = 0;

  async assertReady(): Promise<void> {
    if (!this.ready) throw new LifecyclePortError("audit_unavailable");
  }

  async commit(record: LifecycleAuditRecord) {
    if (this.failStage === record.stage) throw new LifecyclePortError("audit_unavailable");
    this.records.push(record);
    return Object.freeze({
      durability: "durable" as const,
      event_ref: `event_${(this.records.length + 1_000).toString()}`,
    });
  }

  async recover() {
    this.recoveries += 1;
    return this.recoveryDurable
      ? Object.freeze({ durability: "durable" as const })
      : Object.freeze({ durability: "unavailable" as const });
  }
}

function stateFromExecution(execution: ExecutionRecordV1): ReservationState {
  return execution.aggregate_outcome === "partial_effect"
    ? "partial_effect"
    : execution.aggregate_outcome;
}

export class MemoryLedger implements AttemptReservationLedger {
  readonly entries = new Map<string, AttemptReservationSnapshot>();
  ready = true;
  conflict = false;

  async assertReady(): Promise<void> {
    if (!this.ready) throw new LifecyclePortError("reservation_capacity");
  }

  async reserve(binding: AttemptReservationBinding) {
    await this.assertReady();
    if (this.conflict) throw new LifecyclePortError("reservation_conflict");
    const existing = this.entries.get(binding.reservation_ref);
    if (existing !== undefined) {
      if (
        existing.binding.plan_digest !== binding.plan_digest ||
        existing.binding.approval_digest !== binding.approval_digest ||
        existing.binding.approval_nonce_digest !== binding.approval_nonce_digest ||
        existing.binding.operation_set_digest !== binding.operation_set_digest ||
        existing.binding.idempotency_scope_digest !== binding.idempotency_scope_digest
      ) {
        throw new LifecyclePortError("reservation_conflict");
      }
      return Object.freeze({ status: "duplicate" as const, snapshot: existing });
    }
    const snapshot: AttemptReservationSnapshot = Object.freeze({
      binding,
      state: "not_started",
      state_version: 0,
      execution: null,
      verification: null,
      final_outcome: null,
    });
    this.entries.set(binding.reservation_ref, snapshot);
    return Object.freeze({ status: "reserved" as const, snapshot });
  }

  async markStarted(reference: string, digestValue: string): Promise<void> {
    this.update(reference, digestValue, (snapshot) => ({
      ...snapshot,
      state: "started",
      state_version: snapshot.state_version + 1,
    }));
  }

  async recordExecution(
    reference: string,
    digestValue: string,
    execution: ExecutionRecordV1,
  ): Promise<void> {
    this.update(reference, digestValue, (snapshot) => ({
      ...snapshot,
      state: stateFromExecution(execution),
      state_version: snapshot.state_version + 1,
      execution,
    }));
  }

  async recordVerification(
    reference: string,
    digestValue: string,
    verification: VerificationRecordV1,
  ): Promise<void> {
    this.update(reference, digestValue, (snapshot) => ({
      ...snapshot,
      state:
        verification.outcome === "verified" &&
        snapshot.execution?.aggregate_outcome === "effect_observed"
          ? "succeeded"
          : snapshot.execution?.aggregate_outcome === "partial_effect"
            ? "partial_effect"
            : "verification_failed",
      state_version: snapshot.state_version + 1,
      verification,
    }));
  }

  async recordFinal(
    reference: string,
    digestValue: string,
    outcome: "succeeded" | "failed" | "partial_effect" | "completion_unknown",
  ): Promise<void> {
    this.update(reference, digestValue, (snapshot) => ({
      ...snapshot,
      state: outcome === "completion_unknown" ? "completion_unknown" : snapshot.state,
      state_version: snapshot.state_version + 1,
      final_outcome: outcome,
    }));
  }

  async read(reference: string, digestValue: string) {
    const snapshot = this.entries.get(reference);
    if (snapshot !== undefined && snapshot.binding.reservation_digest !== digestValue) {
      throw new LifecyclePortError("reservation_conflict");
    }
    return snapshot;
  }

  async close(): Promise<void> {}

  private update(
    reference: string,
    digestValue: string,
    update: (snapshot: AttemptReservationSnapshot) => AttemptReservationSnapshot,
  ): void {
    const snapshot = this.entries.get(reference);
    if (snapshot === undefined || snapshot.binding.reservation_digest !== digestValue) {
      throw new LifecyclePortError("reservation_conflict");
    }
    this.entries.set(reference, Object.freeze(update(snapshot)));
  }
}

export interface Harness {
  readonly engine: LifecycleEngine;
  readonly clock: FixedClock;
  readonly authorization: FakeAuthorization;
  readonly conditions: FakeConditions;
  readonly effects: FakeEffects;
  readonly verifier: FakeVerifier;
  readonly audit: FakeAudit;
  readonly ledger: MemoryLedger;
}

export function createHarness(
  options: Readonly<{
    ledger?: MemoryLedger;
    boundary?: (boundary: LifecycleBoundary) => void;
  }> = {},
): Harness {
  const clock = new FixedClock();
  const authorization = new FakeAuthorization();
  const conditions = new FakeConditions();
  const effects = new FakeEffects();
  const verifier = new FakeVerifier();
  const audit = new FakeAudit();
  const ledger = options.ledger ?? new MemoryLedger();
  return {
    engine: new LifecycleEngine({
      clock,
      authorization,
      conditions,
      effects,
      verifier,
      audit,
      ledger,
      ...(options.boundary === undefined ? {} : { hooks: { onBoundary: options.boundary } }),
    }),
    clock,
    authorization,
    conditions,
    effects,
    verifier,
    audit,
    ledger,
  };
}

export function rollbackPlanFixture(
  originalPlan: MutationPlanV1,
  original: ExecutionRecordV1,
  observedStateDigest = digest("rollback-observed-state"),
): MutationPlanV1 {
  if (originalPlan.rollback.mode === "unavailable" || originalPlan.rollback.capability === null) {
    throw new Error("rollback capability required");
  }
  const source = structuredClone(planFixture()) as Record<string, unknown>;
  source.plan_id = "plan_rollback001";
  source.request = {
    request_id: "request_rollback001",
    request_digest: digest("rollback-capability-request"),
    normalized_input_digest: lifecycleDigest(NORMALIZED_INPUT),
  };
  source.planning_authorization = {
    request_id: "authreq_rollback_planning001",
    request_digest: digest("rollback-planning-request"),
    decision_id: "decision_rollback_planning001",
    decision_digest: digest("rollback-planning-decision"),
  };
  source.capability = {
    id: originalPlan.rollback.capability.id,
    version: originalPlan.rollback.capability.version,
    definition_digest: originalPlan.rollback.capability.definition_digest,
    operation_class: "mutate",
    effects: ["update"],
    approval_mode: "explicit",
  };
  source.idempotency = {
    classification: "keyed",
    key_digest: digest("rollback-idempotency-key"),
    max_attempts: 1,
    retry: "never",
  };
  source.rollback_context = {
    original_execution_ref: original.execution_ref,
    original_execution_digest: original.execution_digest,
    original_plan_digest: original.plan_digest,
    observed_state_digest: observedStateDigest,
  };
  return sealPlan(source);
}

export function rollbackRecordFixture(plan: MutationPlanV1): RollbackRecordV1 {
  if (plan.rollback_context === null) throw new Error("rollback context required");
  const base = {
    rollback_record_version: 1 as const,
    rollback_ref: "rollback_example001",
    original_execution_ref: plan.rollback_context.original_execution_ref,
    original_execution_digest: plan.rollback_context.original_execution_digest,
    original_plan_digest: plan.rollback_context.original_plan_digest,
    observed_state_digest: plan.rollback_context.observed_state_digest,
    rollback_plan_id: plan.plan_id,
    rollback_plan_digest: plan.plan_digest,
    rollback_execution_ref: null,
    rollback_execution_digest: null,
    status: "requested" as const,
    requested_at: NOW,
    completed_at: null,
  };
  return Object.freeze({ ...base, rollback_digest: lifecycleDigest(base) });
}
