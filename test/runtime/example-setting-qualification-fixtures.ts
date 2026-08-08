import {
  buildAuthorizationRequest,
  combineAuthorization,
  type AuthorizationDecisionV1,
  type AuthorizationRequestV1,
} from "../../contracts/authorization/v1/authorization.mjs";
import { validateAuditCandidate, type AuditCandidate } from "../../packages/audit/src/contract.js";
import { AUDIT_GENESIS_HASH, type AuditWriter } from "../../packages/audit/src/writer.js";
import {
  createAuditWriterLifecyclePort,
  createLifecycleAuditCandidateFactory,
} from "../../packages/lifecycle/src/audit-adapter.js";
import {
  lifecycleDigest,
  type ApprovalReceiptV1,
  type ExecutionRecordV1,
  type MutationPlanV1,
} from "../../packages/lifecycle/src/contract.js";
import { LifecycleEngine } from "../../packages/lifecycle/src/engine.js";
import type {
  AttemptReservationLedger,
  FreshAuthorizationPort,
  FreshAuthorizationResult,
  LifecycleAuditPort,
  LifecycleAuditRecord,
  LifecycleClock,
  LifecycleVerificationPort,
} from "../../packages/lifecycle/src/ports.js";
import type { RepositoryLocalAuditProfile } from "../../packages/audit/src/repository-local.js";
import {
  EXAMPLE_SETTING_CAPABILITY_ID,
  EXAMPLE_SETTING_CAPABILITY_VERSION,
  EXAMPLE_SETTING_CAPACITY_AVAILABLE_DIGEST,
  EXAMPLE_SETTING_CAPACITY_CONDITION_REF,
  EXAMPLE_SETTING_DEFINITION,
  EXAMPLE_SETTING_DEFINITION_DIGEST,
  EXAMPLE_SETTING_ENVIRONMENT,
  EXAMPLE_SETTING_QUALIFICATION_TIME,
  EXAMPLE_SETTING_RESOURCE_KIND,
  EXAMPLE_SETTING_RESOURCE_REF,
  EXAMPLE_SETTING_RESTORE_AUTHORIZATION_DEFINITION,
  EXAMPLE_SETTING_RESTORE_CAPABILITY_ID,
  EXAMPLE_SETTING_RESTORE_CAPABILITY_VERSION,
  EXAMPLE_SETTING_RESTORE_DEFINITION_DIGEST,
  EXAMPLE_SETTING_RESTORE_STEP_ID,
  EXAMPLE_SETTING_STATE_CONDITION_REF,
  EXAMPLE_SETTING_UPDATE_INPUT,
  EXAMPLE_SETTING_UPDATE_STEP_ID,
  EXAMPLE_SETTING_VERIFIER_REF,
  ExampleSettingQualificationProvider,
} from "../../packages/providers/synthetic-local/src/example-setting.js";
import {
  FakeAudit,
  MemoryLedger,
  approvalFixture,
  digest,
  planFixture,
  sealPlan,
} from "./lifecycle-test-fixtures.js";

export const QUALIFICATION_NOW = EXAMPLE_SETTING_QUALIFICATION_TIME;
export const QUALIFICATION_EXPIRES = "2026-08-08T08:00:00.000Z";

const NULL_CORRELATION = Object.freeze({
  trace_ref: null,
  request_ref: null,
  authorization_request_ref: null,
  authorization_decision_ref: null,
  plan_ref: null,
  approval_ref: null,
  execution_ref: null,
  verification_ref: null,
  rollback_ref: null,
});

function lifecycleCondition(
  conditionRef: string,
  type: MutationPlanV1["preconditions"][number]["type"],
  expectedDigest: string,
  observedAt: string,
) {
  return {
    condition_ref: conditionRef,
    type,
    expected_digest: expectedDigest,
    observation_ref: `observation_${conditionRef}`,
    observed_at: observedAt,
    fresh_until: QUALIFICATION_EXPIRES,
    classification: "protected" as const,
  };
}

export interface UpdatePlanOptions {
  readonly planId?: string;
  readonly requestId?: string;
  readonly planningSuffix?: string;
  readonly idempotencyKeyDigest?: string;
}

export function exampleSettingUpdatePlan(
  provider: ExampleSettingQualificationProvider,
  options: UpdatePlanOptions = {},
): MutationPlanV1 {
  const source = structuredClone(planFixture()) as Record<string, unknown>;
  const snapshot = provider.snapshot();
  const expected = provider.expectedUpdateSnapshot();
  const planId = options.planId ?? "plan_setting_update001";
  const requestId = options.requestId ?? "request_setting_update001";
  const planningSuffix = options.planningSuffix ?? "setting_update001";
  const observedAt = "2026-08-08T07:00:00.000Z";
  const preconditions = [
    lifecycleCondition(
      EXAMPLE_SETTING_STATE_CONDITION_REF,
      "selected_field_digest",
      snapshot.state_digest,
      observedAt,
    ),
    lifecycleCondition(
      EXAMPLE_SETTING_CAPACITY_CONDITION_REF,
      "capacity_bound",
      EXAMPLE_SETTING_CAPACITY_AVAILABLE_DIGEST,
      observedAt,
    ),
  ];
  const postconditions = [
    lifecycleCondition(
      EXAMPLE_SETTING_VERIFIER_REF,
      "selected_field_digest",
      expected.state_digest,
      observedAt,
    ),
  ];
  const resourceSetDigest = digest("example-setting-resource-set");
  Object.assign(source, {
    plan_id: planId,
    request: {
      request_id: requestId,
      request_digest: digest(`${requestId}:capability-request`),
      normalized_input_digest: lifecycleDigest(EXAMPLE_SETTING_UPDATE_INPUT),
    },
    capability: {
      id: EXAMPLE_SETTING_CAPABILITY_ID,
      version: EXAMPLE_SETTING_CAPABILITY_VERSION,
      definition_digest: EXAMPLE_SETTING_DEFINITION_DIGEST,
      operation_class: "mutate",
      effects: ["update"],
      approval_mode: "explicit",
    },
    scope: {
      resource_kind: EXAMPLE_SETTING_RESOURCE_KIND,
      resource_refs: [EXAMPLE_SETTING_RESOURCE_REF],
      resource_attributes_digest: digest("example-setting-resource-attributes"),
      resource_set_ref: "resources_example_setting001",
      resource_set_digest: resourceSetDigest,
      environment_ref: EXAMPLE_SETTING_ENVIRONMENT,
      environment_attributes_digest: digest("development-environment-attributes"),
    },
    planning_authorization: {
      request_id: `authreq_${planningSuffix}`,
      request_digest: digest(`${planningSuffix}:planning-request`),
      decision_id: `decision_${planningSuffix}`,
      decision_digest: digest(`${planningSuffix}:planning-decision`),
    },
    target_snapshot: {
      snapshot_ref: `target_${planningSuffix}`,
      digest: snapshot.state_digest,
      observed_at: observedAt,
    },
    operations: [
      {
        step_id: EXAMPLE_SETTING_UPDATE_STEP_ID,
        depends_on: [],
        effect: "update",
        precondition_refs: [
          EXAMPLE_SETTING_STATE_CONDITION_REF,
          EXAMPLE_SETTING_CAPACITY_CONDITION_REF,
        ],
        postcondition_refs: [EXAMPLE_SETTING_VERIFIER_REF],
      },
    ],
    preconditions,
    postconditions,
    predicted_effects: [
      {
        effect: "update",
        resource_set_digest: resourceSetDigest,
        destructive: false,
        data_classes: ["synthetic_configuration"],
      },
    ],
    idempotency: {
      classification: "keyed",
      key_digest: options.idempotencyKeyDigest ?? digest("example-setting-idempotency-key"),
      max_attempts: 1,
      retry: "never",
    },
    verification: {
      profile: "independent",
      verifier_ref: EXAMPLE_SETTING_VERIFIER_REF,
      postcondition_refs: [EXAMPLE_SETTING_VERIFIER_REF],
    },
    rollback: {
      mode: "restore",
      capability: {
        id: EXAMPLE_SETTING_RESTORE_CAPABILITY_ID,
        version: EXAMPLE_SETTING_RESTORE_CAPABILITY_VERSION,
        definition_digest: EXAMPLE_SETTING_RESTORE_DEFINITION_DIGEST,
      },
    },
    rollback_context: null,
  });
  return sealPlan(source);
}

export function exampleSettingRestorePlan(
  provider: ExampleSettingQualificationProvider,
  originalPlan: MutationPlanV1,
  originalExecution: ExecutionRecordV1,
): MutationPlanV1 {
  const source = structuredClone(planFixture()) as Record<string, unknown>;
  const snapshot = provider.snapshot();
  const expected = provider.expectedRestoreSnapshot(originalExecution.execution_ref);
  const restoreInput = provider.restoreInput({
    original_execution_ref: originalExecution.execution_ref,
    original_execution_digest: originalExecution.execution_digest,
    original_plan_digest: originalPlan.plan_digest,
  });
  const preconditions = [
    lifecycleCondition(
      EXAMPLE_SETTING_STATE_CONDITION_REF,
      "selected_field_digest",
      snapshot.state_digest,
      QUALIFICATION_NOW,
    ),
    lifecycleCondition(
      EXAMPLE_SETTING_CAPACITY_CONDITION_REF,
      "capacity_bound",
      EXAMPLE_SETTING_CAPACITY_AVAILABLE_DIGEST,
      QUALIFICATION_NOW,
    ),
  ];
  const postconditions = [
    lifecycleCondition(
      EXAMPLE_SETTING_VERIFIER_REF,
      "selected_field_digest",
      expected.state_digest,
      QUALIFICATION_NOW,
    ),
  ];
  const resourceSetDigest = digest("example-setting-resource-set");
  Object.assign(source, {
    plan_id: "plan_setting_restore001",
    request: {
      request_id: "request_setting_restore001",
      request_digest: digest("example-setting-restore-capability-request"),
      normalized_input_digest: lifecycleDigest(restoreInput),
    },
    capability: {
      id: EXAMPLE_SETTING_RESTORE_CAPABILITY_ID,
      version: EXAMPLE_SETTING_RESTORE_CAPABILITY_VERSION,
      definition_digest: EXAMPLE_SETTING_RESTORE_DEFINITION_DIGEST,
      operation_class: "mutate",
      effects: ["update"],
      approval_mode: "explicit",
    },
    scope: {
      resource_kind: EXAMPLE_SETTING_RESOURCE_KIND,
      resource_refs: [EXAMPLE_SETTING_RESOURCE_REF],
      resource_attributes_digest: digest("example-setting-resource-attributes"),
      resource_set_ref: "resources_example_setting001",
      resource_set_digest: resourceSetDigest,
      environment_ref: EXAMPLE_SETTING_ENVIRONMENT,
      environment_attributes_digest: digest("development-environment-attributes"),
    },
    planning_authorization: {
      request_id: "authreq_setting_restore001",
      request_digest: digest("example-setting-restore-planning-request"),
      decision_id: "decision_setting_restore001",
      decision_digest: digest("example-setting-restore-planning-decision"),
    },
    attributes: {
      snapshot_ref: "attributes_setting_restore001",
      digest: digest("example-setting-restore-attributes"),
      observed_at: QUALIFICATION_NOW,
    },
    target_snapshot: {
      snapshot_ref: "target_setting_restore001",
      digest: snapshot.state_digest,
      observed_at: QUALIFICATION_NOW,
    },
    operations: [
      {
        step_id: EXAMPLE_SETTING_RESTORE_STEP_ID,
        depends_on: [],
        effect: "update",
        precondition_refs: [
          EXAMPLE_SETTING_STATE_CONDITION_REF,
          EXAMPLE_SETTING_CAPACITY_CONDITION_REF,
        ],
        postcondition_refs: [EXAMPLE_SETTING_VERIFIER_REF],
      },
    ],
    preconditions,
    postconditions,
    predicted_effects: [
      {
        effect: "update",
        resource_set_digest: resourceSetDigest,
        destructive: false,
        data_classes: ["synthetic_configuration"],
      },
    ],
    idempotency: {
      classification: "keyed",
      key_digest: digest("example-setting-restore-idempotency-key"),
      max_attempts: 1,
      retry: "never",
    },
    verification: {
      profile: "independent",
      verifier_ref: EXAMPLE_SETTING_VERIFIER_REF,
      postcondition_refs: [EXAMPLE_SETTING_VERIFIER_REF],
    },
    rollback: { mode: "unavailable", capability: null },
    rollback_context: {
      original_execution_ref: originalExecution.execution_ref,
      original_execution_digest: originalExecution.execution_digest,
      original_plan_digest: originalPlan.plan_digest,
      observed_state_digest: snapshot.state_digest,
    },
    created_at: QUALIFICATION_NOW,
    expires_at: QUALIFICATION_EXPIRES,
  });
  return sealPlan(source);
}

export function qualificationApproval(
  plan: MutationPlanV1,
  suffix = "setting_update001",
): ApprovalReceiptV1 {
  return approvalFixture(plan, {
    approval_id: `approval_${suffix}`,
    nonce_digest: digest(`${suffix}:approval-nonce`),
    issued_at: QUALIFICATION_NOW,
    expires_at: "2026-08-08T07:30:00.000Z",
  });
}

function authorizationEvaluation(request: AuthorizationRequestV1, effect: "allow" | "deny") {
  return {
    evaluation_version: 1,
    authorization_request_id: request.authorization_request_id,
    request_digest: request.request_digest,
    policy: structuredClone(request.policy),
    evaluator_ref: "impl_example_setting_evaluator_v1",
    evaluated_at: QUALIFICATION_NOW,
    statements: [
      {
        statement_ref: `statement_${effect}`,
        effect,
        reason_code:
          effect === "allow" ? "policy_allow_example_setting" : "policy_deny_example_setting",
        constraints: [],
        obligations: [],
      },
    ],
  };
}

export class ExampleSettingAuthorization implements FreshAuthorizationPort {
  calls = 0;
  effect: "allow" | "deny" = "allow";

  constructor(private readonly provider: ExampleSettingQualificationProvider) {}

  async authorize(
    input: Readonly<{
      plan: MutationPlanV1;
      approval: ApprovalReceiptV1 | null;
    }>,
  ): Promise<FreshAuthorizationResult> {
    this.calls += 1;
    const plan = input.plan;
    const update = plan.capability.id === EXAMPLE_SETTING_CAPABILITY_ID;
    const normalizedInput = update ? EXAMPLE_SETTING_UPDATE_INPUT : this.restoreInput(plan);
    const definition = update
      ? EXAMPLE_SETTING_DEFINITION
      : EXAMPLE_SETTING_RESTORE_AUTHORIZATION_DEFINITION;
    const request = buildAuthorizationRequest({
      authorization_request_id: `authreq_setting_apply${this.calls.toString().padStart(3, "0")}`,
      subject: {
        ref: plan.subject.ref,
        kind: plan.subject.kind,
        authentication_context_ref: plan.subject.authentication_context_ref,
        authentication_strength: plan.subject.authentication_strength,
      },
      definition,
      resource: {
        kind: plan.scope.resource_kind,
        refs: [...plan.scope.resource_refs],
        attributes_digest: plan.scope.resource_attributes_digest,
      },
      environment: {
        ref: plan.scope.environment_ref,
        attributes_digest: plan.scope.environment_attributes_digest,
      },
      normalized_input: normalizedInput,
      risk: "high",
      requested_at: QUALIFICATION_NOW,
      policy: structuredClone(plan.policy),
      attributes: structuredClone(plan.attributes),
    }) as AuthorizationRequestV1;
    const decision = combineAuthorization({
      request,
      evaluation: authorizationEvaluation(request, this.effect),
      decision_id: `decision_setting_apply${this.calls.toString().padStart(3, "0")}`,
      issued_at: QUALIFICATION_NOW,
      expires_at: "2026-08-08T07:30:00.000Z",
    }) as AuthorizationDecisionV1;
    return Object.freeze({
      request,
      decision,
      authentication_context_digest: plan.subject.authentication_context_digest,
      constraint_handlers: Object.freeze({}),
      obligation_receipts: Object.freeze([]),
    });
  }

  private restoreInput(plan: MutationPlanV1) {
    const context = plan.rollback_context;
    if (context === null) throw new TypeError("rollback context required");
    return this.provider.restoreInput({
      original_execution_ref: context.original_execution_ref,
      original_execution_digest: context.original_execution_digest,
      original_plan_digest: context.original_plan_digest,
    });
  }
}

export class QualificationClock implements LifecycleClock {
  constructor(public value = QUALIFICATION_NOW) {}

  now(): string {
    return this.value;
  }
}

export class RecordingLifecycleAudit implements LifecycleAuditPort {
  readonly records: LifecycleAuditRecord[] = [];

  constructor(
    private readonly delegate: LifecycleAuditPort,
    private readonly failStage: LifecycleAuditRecord["stage"] | null = null,
  ) {}

  async assertReady(): Promise<void> {
    await this.delegate.assertReady();
  }

  async commit(record: LifecycleAuditRecord) {
    this.records.push(record);
    if (record.stage === this.failStage) throw new Error("injected primary audit failure");
    return this.delegate.commit(record);
  }

  async recover(input: Readonly<{ recovery_id: string; record: LifecycleAuditRecord }>) {
    return this.delegate.recover(input);
  }
}

export function memoryQualificationHarness(
  provider: ExampleSettingQualificationProvider,
  options: Readonly<{
    authorization?: ExampleSettingAuthorization;
    audit?: LifecycleAuditPort;
    ledger?: AttemptReservationLedger;
    clock?: QualificationClock;
    verifier?: LifecycleVerificationPort;
  }> = {},
) {
  const authorization = options.authorization ?? new ExampleSettingAuthorization(provider);
  const ledger = options.ledger ?? new MemoryLedger();
  const clock = options.clock ?? new QualificationClock();
  const audit = options.audit ?? new FakeAudit();
  return {
    engine: new LifecycleEngine({
      clock,
      authorization,
      conditions: provider,
      effects: provider,
      verifier: options.verifier ?? provider,
      audit,
      ledger,
    }),
    authorization,
    ledger,
    clock,
    audit,
  };
}

function baseCandidate(
  plan: MutationPlanV1,
  prefix: string,
  overrides: Readonly<Record<string, unknown>>,
): AuditCandidate {
  return validateAuditCandidate({
    audit_candidate_version: 1,
    event_id: `event_${prefix}_request`,
    event_type: "request.accepted.v1",
    occurred_at: QUALIFICATION_NOW,
    producer: {
      component_ref: "component.gateway",
      instance_ref: "instance.example-setting-qualification",
    },
    correlation: {
      ...NULL_CORRELATION,
      trace_ref: `trace_${prefix}`,
      request_ref: plan.request.request_id,
    },
    causation: { parent_event_refs: [] },
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
    outcome: { status: "accepted", reason_codes: ["accepted"] },
    payload: { request_digest: plan.request.request_digest },
    ...overrides,
  });
}

export function qualificationStreamCandidate(plan: MutationPlanV1): AuditCandidate {
  return baseCandidate(plan, "setting_stream", {
    event_id: "event_setting_stream",
    event_type: "audit.stream_opened.v1",
    producer: {
      component_ref: "component.audit-writer",
      instance_ref: "instance.example-setting-qualification",
    },
    correlation: NULL_CORRELATION,
    subject: { ref: "service_audit001", kind: "system" },
    capability: {
      id: "audit.writer",
      version: "1.0.0",
      definition_digest: EXAMPLE_SETTING_DEFINITION_DIGEST,
    },
    scope: {
      resource_kind: "security-domain",
      resource_set_ref: "resources_audit001",
      resource_set_digest: digest("example-setting-audit-scope"),
      environment_ref: EXAMPLE_SETTING_ENVIRONMENT,
    },
    payload: { genesis_hash: AUDIT_GENESIS_HASH },
  });
}

export function initialQualificationCandidates(
  plan: MutationPlanV1,
  prefix: string,
): readonly AuditCandidate[] {
  const request = baseCandidate(plan, prefix, {});
  const evaluation = baseCandidate(plan, prefix, {
    event_id: `event_${prefix}_planning_evaluation`,
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
      evaluator_ref: "impl_example_setting_evaluator_v1",
      authorization_phase: "planning",
      plan_digest: null,
    },
  });
  const decision = baseCandidate(plan, prefix, {
    event_id: `event_${prefix}_planning_decision`,
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
  const enforcement = baseCandidate(plan, prefix, {
    event_id: `event_${prefix}_planning_enforcement`,
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
  return Object.freeze([request, evaluation, decision, enforcement]);
}

export async function durableAuditPort(
  writer: AuditWriter,
  profile: RepositoryLocalAuditProfile,
  plan: MutationPlanV1,
  approval: ApprovalReceiptV1,
  prefix: string,
): Promise<LifecycleAuditPort> {
  for (const candidate of initialQualificationCandidates(plan, prefix)) {
    await writer.commit(candidate);
  }
  return createAuditWriterLifecyclePort({
    writer,
    readiness: profile.readiness,
    journal: profile.journal,
    candidates: createLifecycleAuditCandidateFactory({
      plan,
      traceRef: `trace_${prefix}`,
      requestRef: plan.request.request_id,
      requestEventRef: `event_${prefix}_request`,
      planningEnforcementEventRef: `event_${prefix}_planning_enforcement`,
      approvalRef: approval.approval_id,
      producer: {
        component_ref: "component.gateway",
        instance_ref: "instance.example-setting-qualification",
      },
    }),
  });
}
