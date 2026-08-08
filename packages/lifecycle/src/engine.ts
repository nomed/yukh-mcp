import {
  createDecisionEnforcer,
  validateAuthorizationRecord,
  type AuthorizationDecisionV1,
  type AuthorizationObligation,
  type AuthorizationObligationReceipt,
  type AuthorizationRequestV1,
} from "../../../contracts/authorization/v1/authorization.mjs";
import { isValidAuditTimestamp } from "../../audit/src/contract.js";
import { canonicalAuditJson } from "../../audit/src/writer.js";
import {
  aggregateStepOutcome,
  approvalBindingsForPlan,
  lifecycleDigest,
  validateApprovalReceipt,
  validateExecutionRecord,
  validateMutationPlan,
  validateRollbackRecord,
  validateVerificationRecord,
  LifecycleContractError,
  type AggregateOutcome,
  type ApprovalReceiptV1,
  type ExecutionRecordV1,
  type ExecutionStepRecord,
  type MutationPlanV1,
  type RollbackRecordV1,
  type VerificationObservation,
  type VerificationRecordV1,
} from "./contract.js";
import {
  LifecyclePortError,
  type AttemptReservationBinding,
  type AttemptReservationLedger,
  type AttemptReservationSnapshot,
  type FreshAuthorizationPort,
  type FreshAuthorizationResult,
  type LifecycleAuditPort,
  type LifecycleAuditRecord,
  type LifecycleAuditStage,
  type LifecycleClock,
  type LifecycleConditionPort,
  type LifecycleEffectPort,
  type LifecycleQualificationHooks,
  type LifecycleVerificationPort,
} from "./ports.js";

export type LifecycleDeniedCode =
  | "plan_invalidated"
  | "approval_required"
  | "approval_denied"
  | "authorization_denied"
  | "authorization_unavailable"
  | "authorization_binding_mismatch"
  | "authorization_stale"
  | "constraint_failed"
  | "constraint_unenforceable"
  | "obligation_pending"
  | "precondition_failed"
  | "audit_unavailable"
  | "reservation_unavailable"
  | "reservation_conflict"
  | "apply_already_reserved";

export type LifecycleApplyResult =
  | Readonly<{
      status: "succeeded";
      duplicate: boolean;
      execution: ExecutionRecordV1;
      verification: VerificationRecordV1;
    }>
  | Readonly<{
      status: "denied";
      code: LifecycleDeniedCode;
      duplicate: boolean;
    }>
  | Readonly<{
      status: "failed";
      code: "no_effect_proven" | "verification_failed" | "verification_inconclusive";
      duplicate: boolean;
      execution: ExecutionRecordV1;
      verification: VerificationRecordV1 | null;
    }>
  | Readonly<{
      status: "partial_effect";
      code: "operation_partially_applied";
      duplicate: boolean;
      execution: ExecutionRecordV1;
      verification: VerificationRecordV1 | null;
    }>
  | Readonly<{
      status: "completion_unknown";
      code: "operation_outcome_unknown";
      duplicate: boolean;
      execution: ExecutionRecordV1 | null;
      verification: VerificationRecordV1 | null;
      recovery: "journaled" | "journal_unavailable" | "not_required";
    }>;

export type LifecycleRollbackResult = Readonly<{
  status: "completed" | "failed" | "completion_unknown" | "denied";
  rollback: RollbackRecordV1;
  apply: LifecycleApplyResult;
}>;

export interface LifecycleEngineOptions {
  readonly clock: LifecycleClock;
  readonly authorization: FreshAuthorizationPort;
  readonly conditions: LifecycleConditionPort;
  readonly effects: LifecycleEffectPort;
  readonly verifier: LifecycleVerificationPort;
  readonly audit: LifecycleAuditPort;
  readonly ledger: AttemptReservationLedger;
  readonly hooks?: LifecycleQualificationHooks;
}

export interface LifecycleApplyInput {
  readonly plan: unknown;
  readonly approval?: unknown;
}

export interface LifecycleRollbackInput extends LifecycleApplyInput {
  readonly rollback: unknown;
  readonly original_plan: unknown;
  readonly original_execution: unknown;
}

const REFERENCE_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

function exact(left: unknown, right: unknown): boolean {
  return canonicalAuditJson(left) === canonicalAuditJson(right);
}

function refFromDigest(prefix: string, digest: string): string {
  const reference = `${prefix}_${digest.slice("sha256:".length, "sha256:".length + 40)}`;
  if (!REFERENCE_PATTERN.test(reference))
    throw new LifecycleContractError("lifecycle_record_invalid");
  return reference;
}

function safeNow(clock: LifecycleClock): string {
  let value: string;
  try {
    value = clock.now();
  } catch {
    throw new LifecyclePortError("reservation_unavailable");
  }
  if (!isValidAuditTimestamp(value)) throw new LifecyclePortError("reservation_unavailable");
  return value;
}

async function runWithTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new LifecyclePortError("effect_unavailable"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function withoutDigest<T extends object, Key extends keyof T>(value: T, key: Key): Omit<T, Key> {
  const entries = Object.entries(value).filter(([entryKey]) => entryKey !== key);
  return Object.fromEntries(entries) as Omit<T, Key>;
}

function authorizationMatchesPlan(
  result: FreshAuthorizationResult,
  plan: MutationPlanV1,
  approval: ApprovalReceiptV1 | null,
  now: string,
): boolean {
  const { request, decision } = result;
  const requestTime = Date.parse(request.request_context.requested_at);
  const decisionTime = Date.parse(decision.issued_at);
  const freshnessFloor = Date.parse(approval?.issued_at ?? plan.created_at);
  const observedNow = Date.parse(now);
  return (
    request.authorization_request_id !== plan.planning_authorization.request_id &&
    request.request_digest !== plan.planning_authorization.request_digest &&
    decision.decision_id !== plan.planning_authorization.decision_id &&
    decision.decision_digest !== plan.planning_authorization.decision_digest &&
    request.subject.ref === plan.subject.ref &&
    request.subject.kind === plan.subject.kind &&
    request.subject.authentication_context_ref === plan.subject.authentication_context_ref &&
    request.subject.authentication_strength === plan.subject.authentication_strength &&
    result.authentication_context_digest === plan.subject.authentication_context_digest &&
    exact(request.action.capability, {
      id: plan.capability.id,
      version: plan.capability.version,
    }) &&
    request.action.definition_digest === plan.capability.definition_digest &&
    request.action.operation_class === "mutate" &&
    exact(request.action.effects, plan.capability.effects) &&
    request.action.approval_mode === plan.capability.approval_mode &&
    request.resource.kind === plan.scope.resource_kind &&
    exact(request.resource.refs, plan.scope.resource_refs) &&
    request.resource.attributes_digest === plan.scope.resource_attributes_digest &&
    request.environment.ref === plan.scope.environment_ref &&
    request.environment.attributes_digest === plan.scope.environment_attributes_digest &&
    request.request_context.normalized_input_digest === plan.request.normalized_input_digest &&
    exact(request.policy, plan.policy) &&
    exact(request.attributes, plan.attributes) &&
    Number.isFinite(requestTime) &&
    Number.isFinite(decisionTime) &&
    Number.isFinite(freshnessFloor) &&
    Number.isFinite(observedNow) &&
    requestTime >= freshnessFloor &&
    requestTime <= observedNow &&
    decisionTime >= requestTime &&
    decisionTime <= observedNow &&
    decision.authorization_request_id === request.authorization_request_id &&
    decision.request_digest === request.request_digest
  );
}

function mapEnforcementCode(code: string): LifecycleDeniedCode {
  switch (code) {
    case "authorization_denied":
      return "authorization_denied";
    case "decision_stale":
      return "authorization_stale";
    case "constraint_failed":
      return "constraint_failed";
    case "constraint_unenforceable":
      return "constraint_unenforceable";
    case "obligation_pending":
      return "obligation_pending";
    default:
      return "authorization_binding_mismatch";
  }
}

function approvalObligationReceipt(
  decision: AuthorizationDecisionV1,
  approval: ApprovalReceiptV1 | null,
): AuthorizationObligationReceipt | null {
  if (approval === null) return null;
  const obligation = decision.obligations.find(
    (item): item is Extract<AuthorizationObligation, { type: "approval_required" }> =>
      item.type === "approval_required",
  );
  if (obligation === undefined || approval.satisfied_level === null) return null;
  const ranks = ["standard", "elevated", "destructive"] as const;
  if (ranks.indexOf(approval.satisfied_level) < ranks.indexOf(obligation.value)) return null;
  return Object.freeze({
    type: "approval_required",
    value: obligation.value,
    decision_id: decision.decision_id,
  });
}

function reservationBinding(
  plan: MutationPlanV1,
  approval: ApprovalReceiptV1 | null,
  authorization: FreshAuthorizationResult,
  reservedAt: string,
): AttemptReservationBinding {
  const idempotencyScopeDigest = lifecycleDigest({
    subject_ref: plan.subject.ref,
    capability: {
      id: plan.capability.id,
      version: plan.capability.version,
      definition_digest: plan.capability.definition_digest,
    },
    resource_set_digest: plan.scope.resource_set_digest,
    environment_ref: plan.scope.environment_ref,
    idempotency_key_digest: plan.idempotency.key_digest ?? plan.plan_digest,
  });
  const reservationRef = refFromDigest("reservation", idempotencyScopeDigest);
  const base = {
    reservation_binding_version: 1 as const,
    reservation_ref: reservationRef,
    idempotency_scope_digest: idempotencyScopeDigest,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    approval_id: approval?.approval_id ?? null,
    approval_digest: approval?.approval_digest ?? null,
    approval_nonce_digest: approval?.nonce_digest ?? null,
    authorization_request_id: authorization.request.authorization_request_id,
    authorization_request_digest: authorization.request.request_digest,
    authorization_decision_id: authorization.decision.decision_id,
    authorization_decision_digest: authorization.decision.decision_digest,
    subject_ref: plan.subject.ref,
    capability_definition_digest: plan.capability.definition_digest,
    resource_set_digest: plan.scope.resource_set_digest,
    environment_ref: plan.scope.environment_ref,
    operation_set_digest: plan.operation_set_digest,
    attempt: 1,
    reserved_at: reservedAt,
  };
  return Object.freeze({ ...base, reservation_digest: lifecycleDigest(base) });
}

function executionRef(binding: AttemptReservationBinding): string {
  return refFromDigest("execution", binding.reservation_digest);
}

function verificationRef(executionDigest: string): string {
  return refFromDigest("verification", executionDigest);
}

function recoveryRef(binding: AttemptReservationBinding, stage: string): string {
  return refFromDigest(
    "recovery",
    lifecycleDigest({
      reservation_digest: binding.reservation_digest,
      stage,
    }),
  );
}

function expectedReason(state: ExecutionStepRecord["state"]): readonly string[] {
  switch (state) {
    case "not_started":
      return ["not_attempted", "dependency_stopped"];
    case "started":
      return ["provider_started"];
    case "effect_observed":
      return ["effect_observed"];
    case "no_effect_proven":
      return ["no_effect_proven"];
    case "failed":
      return ["provider_failed"];
    case "completion_unknown":
      return ["outcome_ambiguous"];
  }
}

function validateEffectSteps(
  steps: readonly ExecutionStepRecord[],
  plan: MutationPlanV1,
): readonly ExecutionStepRecord[] {
  if (
    steps.length !== plan.operations.length ||
    steps.some(
      (step, index) =>
        step.step_id !== plan.operations[index]?.step_id ||
        !expectedReason(step.state).includes(step.reason_code) ||
        step.evidence_refs.length !== new Set(step.evidence_refs).size,
    )
  ) {
    throw new LifecyclePortError("effect_unavailable");
  }
  const byId = new Map(steps.map((step) => [step.step_id, step]));
  for (const operation of plan.operations) {
    const step = byId.get(operation.step_id);
    if (step === undefined) throw new LifecyclePortError("effect_unavailable");
    const dependencyStopped = operation.depends_on.some((dependency) => {
      const state = byId.get(dependency)?.state;
      return state !== "effect_observed";
    });
    if (
      (dependencyStopped &&
        (step.state !== "not_started" || step.reason_code !== "dependency_stopped")) ||
      (!dependencyStopped && step.state === "not_started" && step.reason_code !== "not_attempted")
    ) {
      throw new LifecyclePortError("effect_unavailable");
    }
  }
  return Object.freeze(
    steps.map((step) => Object.freeze({ ...step, evidence_refs: [...step.evidence_refs] })),
  );
}

function unknownSteps(plan: MutationPlanV1): readonly ExecutionStepRecord[] {
  return Object.freeze(
    plan.operations.map((operation) =>
      Object.freeze({
        step_id: operation.step_id,
        state: "completion_unknown" as const,
        reason_code: "outcome_ambiguous" as const,
        evidence_refs: Object.freeze([]),
      }),
    ),
  );
}

function buildExecutionRecord(
  input: Readonly<{
    plan: MutationPlanV1;
    approval: ApprovalReceiptV1 | null;
    authorization: FreshAuthorizationResult;
    binding: AttemptReservationBinding;
    startedAt: string;
    completedAt: string;
    steps: readonly ExecutionStepRecord[];
  }>,
): ExecutionRecordV1 {
  const aggregateOutcome = aggregateStepOutcome(input.steps);
  const base = {
    execution_record_version: 1 as const,
    execution_ref: executionRef(input.binding),
    plan_id: input.plan.plan_id,
    plan_digest: input.plan.plan_digest,
    authorization_request_id: input.authorization.request.authorization_request_id,
    authorization_request_digest: input.authorization.request.request_digest,
    authorization_decision_id: input.authorization.decision.decision_id,
    authorization_decision_digest: input.authorization.decision.decision_digest,
    approval_id: input.approval?.approval_id ?? null,
    approval_digest: input.approval?.approval_digest ?? null,
    reservation_ref: input.binding.reservation_ref,
    reservation_digest: input.binding.reservation_digest,
    attempt: input.binding.attempt,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    steps: input.steps,
    aggregate_outcome: aggregateOutcome,
  };
  return validateExecutionRecord({ ...base, execution_digest: lifecycleDigest(base) }, input.plan);
}

function verificationOutcome(
  observations: readonly VerificationObservation[],
): "verified" | "failed" | "inconclusive" {
  if (observations.some(({ status }) => status === "inconclusive")) return "inconclusive";
  if (observations.some(({ status }) => status === "failed")) return "failed";
  return "verified";
}

function buildVerificationRecord(
  input: Readonly<{
    plan: MutationPlanV1;
    execution: ExecutionRecordV1;
    startedAt: string;
    completedAt: string;
    observations: readonly VerificationObservation[];
  }>,
): VerificationRecordV1 {
  const base = {
    verification_record_version: 1 as const,
    verification_ref: verificationRef(input.execution.execution_digest),
    execution_ref: input.execution.execution_ref,
    execution_digest: input.execution.execution_digest,
    plan_id: input.plan.plan_id,
    plan_digest: input.plan.plan_digest,
    verifier_ref: input.plan.verification.verifier_ref,
    profile: input.plan.verification.profile,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    observations: input.observations,
    outcome: verificationOutcome(input.observations),
  };
  return validateVerificationRecord(
    { ...base, verification_digest: lifecycleDigest(base) },
    input.execution,
    input.plan,
  );
}

function inconclusiveObservations(
  plan: MutationPlanV1,
  observedAt: string,
): readonly VerificationObservation[] {
  return Object.freeze(
    plan.postconditions.map((condition) =>
      Object.freeze({
        condition_ref: condition.condition_ref,
        status: "inconclusive" as const,
        observation_digest: lifecycleDigest({
          condition_ref: condition.condition_ref,
          outcome: "verification_unavailable",
        }),
        evidence_ref: "evidence_verification_unavailable",
        observed_at: observedAt,
      }),
    ),
  );
}

function resultFromDuplicate(snapshot: AttemptReservationSnapshot): LifecycleApplyResult {
  if (
    snapshot.final_outcome === "succeeded" &&
    snapshot.execution !== null &&
    snapshot.verification !== null
  ) {
    return {
      status: "succeeded",
      duplicate: true,
      execution: snapshot.execution,
      verification: snapshot.verification,
    };
  }
  if (snapshot.final_outcome === "failed" && snapshot.execution !== null) {
    return {
      status: "failed",
      code:
        snapshot.execution.aggregate_outcome === "no_effect_proven"
          ? "no_effect_proven"
          : snapshot.verification?.outcome === "inconclusive"
            ? "verification_inconclusive"
            : "verification_failed",
      duplicate: true,
      execution: snapshot.execution,
      verification: snapshot.verification,
    };
  }
  if (snapshot.final_outcome === "partial_effect" && snapshot.execution !== null) {
    return {
      status: "partial_effect",
      code: "operation_partially_applied",
      duplicate: true,
      execution: snapshot.execution,
      verification: snapshot.verification,
    };
  }
  if (snapshot.state === "not_started") {
    return {
      status: "denied",
      code: "apply_already_reserved",
      duplicate: true,
    };
  }
  return {
    status: "completion_unknown",
    code: "operation_outcome_unknown",
    duplicate: true,
    execution: snapshot.execution,
    verification: snapshot.verification,
    recovery: "not_required",
  };
}

function rollbackStatus(
  result: LifecycleApplyResult,
): "completed" | "failed" | "completion_unknown" {
  switch (result.status) {
    case "succeeded":
      return "completed";
    case "completion_unknown":
      return "completion_unknown";
    case "denied":
    case "failed":
    case "partial_effect":
      return "failed";
  }
}

export class LifecycleEngine {
  private readonly enforceDecision = createDecisionEnforcer();

  constructor(private readonly options: LifecycleEngineOptions) {}

  async execute(input: LifecycleApplyInput): Promise<LifecycleApplyResult> {
    return this.executeInternal(input, null);
  }

  async executeRollback(input: LifecycleRollbackInput): Promise<LifecycleRollbackResult> {
    let now: string;
    try {
      now = safeNow(this.options.clock);
    } catch {
      const fallback = this.invalidRollback("1970-01-01T00:00:00Z");
      return {
        status: "denied",
        rollback: fallback,
        apply: { status: "denied", code: "reservation_unavailable", duplicate: false },
      };
    }
    let plan: MutationPlanV1;
    let requested: RollbackRecordV1;
    try {
      const originalPlan = validateMutationPlan(input.original_plan);
      const originalExecution = validateExecutionRecord(input.original_execution, originalPlan);
      plan = validateMutationPlan(input.plan, now);
      requested = validateRollbackRecord(input.rollback, plan);
      const rollbackCapability = originalPlan.rollback.capability;
      if (
        requested.status !== "requested" ||
        originalPlan.rollback.mode === "unavailable" ||
        rollbackCapability === null ||
        originalExecution.execution_ref !== requested.original_execution_ref ||
        originalExecution.execution_digest !== requested.original_execution_digest ||
        originalPlan.plan_digest !== requested.original_plan_digest ||
        plan.capability.id !== rollbackCapability.id ||
        plan.capability.version !== rollbackCapability.version ||
        plan.capability.definition_digest !== rollbackCapability.definition_digest
      ) {
        throw new LifecycleContractError("lifecycle_record_invalid");
      }
    } catch {
      const fallback = this.invalidRollback(now);
      return {
        status: "denied",
        rollback: fallback,
        apply: { status: "denied", code: "plan_invalidated", duplicate: false },
      };
    }
    try {
      await this.commitAudit(
        this.auditRecord("rollback.requested", plan, {
          occurredAt: now,
          rollbackRef: requested.rollback_ref,
        }),
      );
    } catch {
      return {
        status: "denied",
        rollback: requested,
        apply: { status: "denied", code: "audit_unavailable", duplicate: false },
      };
    }
    const apply = await this.executeInternal(input, requested.rollback_ref);
    const status = rollbackStatus(apply);
    let completedAt: string;
    try {
      completedAt = safeNow(this.options.clock);
    } catch {
      return { status: "completion_unknown", rollback: requested, apply };
    }
    const execution = "execution" in apply ? apply.execution : null;
    const base = {
      ...withoutDigest(requested, "rollback_digest"),
      rollback_execution_ref: execution?.execution_ref ?? null,
      rollback_execution_digest: execution?.execution_digest ?? null,
      status,
      completed_at: completedAt,
    };
    const rollback = validateRollbackRecord(
      { ...base, rollback_digest: lifecycleDigest(base) },
      plan,
    );
    const stage: LifecycleAuditStage =
      status === "completed"
        ? "rollback.completed"
        : status === "completion_unknown"
          ? "rollback.completion_unknown"
          : "rollback.failed";
    try {
      await this.commitAudit(
        this.auditRecord(stage, plan, {
          occurredAt: completedAt,
          approval: null,
          execution,
          verification: "verification" in apply ? apply.verification : null,
          rollbackRef: rollback.rollback_ref,
          finalOutcome:
            status === "completed"
              ? "succeeded"
              : status === "completion_unknown"
                ? "completion_unknown"
                : "failed",
        }),
      );
    } catch {
      return { status: "completion_unknown", rollback, apply };
    }
    return { status, rollback, apply };
  }

  private invalidRollback(now: string): RollbackRecordV1 {
    const digest = lifecycleDigest({ invalid_rollback: true, observed_at: now });
    const base = {
      rollback_record_version: 1 as const,
      rollback_ref: refFromDigest("rollback", digest),
      original_execution_ref: "execution_invalid",
      original_execution_digest: digest,
      original_plan_digest: digest,
      observed_state_digest: digest,
      rollback_plan_id: "plan_invalid",
      rollback_plan_digest: digest,
      rollback_execution_ref: null,
      rollback_execution_digest: null,
      status: "requested" as const,
      requested_at: now,
      completed_at: null,
    };
    return validateRollbackRecord({ ...base, rollback_digest: lifecycleDigest(base) });
  }

  private async executeInternal(
    input: LifecycleApplyInput,
    rollbackRef: string | null,
  ): Promise<LifecycleApplyResult> {
    let now: string;
    let plan: MutationPlanV1;
    try {
      now = safeNow(this.options.clock);
      plan = validateMutationPlan(input.plan, now);
      await this.options.audit.assertReady();
      await this.options.ledger.assertReady();
      await this.commitAudit(
        this.auditRecord("plan.created", plan, {
          occurredAt: plan.created_at,
          rollbackRef,
        }),
      );
    } catch (error: unknown) {
      return {
        status: "denied",
        code: this.preEffectCode(error, "plan_invalidated"),
        duplicate: false,
      };
    }

    let approval: ApprovalReceiptV1 | null = null;
    if (plan.approval.required) {
      try {
        await this.commitAudit(
          this.auditRecord("approval.requested", plan, {
            occurredAt: plan.created_at,
            rollbackRef,
          }),
        );
      } catch {
        return { status: "denied", code: "audit_unavailable", duplicate: false };
      }
      if (input.approval === undefined) {
        return { status: "denied", code: "approval_required", duplicate: false };
      }
      try {
        approval = validateApprovalReceipt(input.approval, plan, safeNow(this.options.clock));
      } catch (error: unknown) {
        try {
          await this.commitAudit(
            this.auditRecord("approval.rejected", plan, {
              occurredAt: safeNow(this.options.clock),
              rollbackRef,
            }),
          );
        } catch {
          return { status: "denied", code: "audit_unavailable", duplicate: false };
        }
        return {
          status: "denied",
          code: this.preEffectCode(error, "approval_denied"),
          duplicate: false,
        };
      }
      try {
        await this.commitAudit(
          this.auditRecord("approval.approved", plan, {
            occurredAt: approval.issued_at,
            approval,
            rollbackRef,
          }),
        );
      } catch {
        return { status: "denied", code: "audit_unavailable", duplicate: false };
      }
    } else if (input.approval !== undefined) {
      return { status: "denied", code: "approval_denied", duplicate: false };
    }

    let authorization: FreshAuthorizationResult;
    try {
      authorization = await this.options.authorization.authorize({ plan, approval });
    } catch {
      return { status: "denied", code: "authorization_unavailable", duplicate: false };
    }
    let authorizationNow: string;
    try {
      authorizationNow = safeNow(this.options.clock);
    } catch {
      return { status: "denied", code: "authorization_unavailable", duplicate: false };
    }
    const authorizationValid =
      validateAuthorizationRecord("request", authorization.request).valid &&
      validateAuthorizationRecord("decision", authorization.decision).valid &&
      authorizationMatchesPlan(authorization, plan, approval, authorizationNow);
    if (!authorizationValid) {
      return { status: "denied", code: "authorization_binding_mismatch", duplicate: false };
    }

    try {
      await this.commitAuthorizationAudit(plan, approval, authorization, rollbackRef);
    } catch {
      return { status: "denied", code: "audit_unavailable", duplicate: false };
    }
    const internalApproval = approvalObligationReceipt(authorization.decision, approval);
    const externalReceipts = authorization.obligation_receipts.filter(
      ({ type }) => type !== "approval_required",
    );
    let enforcement: ReturnType<typeof this.enforceDecision>;
    try {
      enforcement = this.enforceDecision({
        decision: authorization.decision,
        request: authorization.request,
        now: safeNow(this.options.clock),
        constraint_handlers: authorization.constraint_handlers,
        obligation_receipts:
          internalApproval === null ? externalReceipts : [...externalReceipts, internalApproval],
        ...(internalApproval === null
          ? {}
          : {
              approval_receipt_verifier: (
                receipt: AuthorizationObligationReceipt,
                decision: AuthorizationDecisionV1,
                request: AuthorizationRequestV1,
              ) =>
                receipt === internalApproval &&
                decision.decision_id === authorization.decision.decision_id &&
                request.request_digest === authorization.request.request_digest,
            }),
      });
    } catch {
      return { status: "denied", code: "authorization_unavailable", duplicate: false };
    }
    try {
      await this.commitAudit(
        this.auditRecord("authorization.enforcement_recorded", plan, {
          occurredAt: safeNow(this.options.clock),
          approval,
          authorization,
          enforcementResult: enforcement.allowed ? "enforced" : "denied",
          rollbackRef,
        }),
      );
    } catch {
      return { status: "denied", code: "audit_unavailable", duplicate: false };
    }
    if (!enforcement.allowed) {
      return {
        status: "denied",
        code: mapEnforcementCode(enforcement.code),
        duplicate: false,
      };
    }

    let preconditionNow: string;
    try {
      preconditionNow = safeNow(this.options.clock);
    } catch {
      return { status: "denied", code: "precondition_failed", duplicate: false };
    }
    const preconditionsValid = await this.checkPreconditions(
      plan,
      preconditionNow,
      authorization.request.request_context.requested_at,
    );
    if (!preconditionsValid) {
      return { status: "denied", code: "precondition_failed", duplicate: false };
    }

    let binding: AttemptReservationBinding;
    try {
      const reservedAt = safeNow(this.options.clock);
      binding = reservationBinding(plan, approval, authorization, reservedAt);
      this.options.hooks?.onBoundary?.("pre_reservation");
      const reservation = await this.options.ledger.reserve(binding);
      this.options.hooks?.onBoundary?.("post_reservation");
      if (reservation.status === "duplicate") return resultFromDuplicate(reservation.snapshot);
      await this.commitAudit(
        this.auditRecord("apply.admitted", plan, {
          occurredAt: reservedAt,
          approval,
          authorization,
          enforcementResult: "enforced",
          executionRef: executionRef(binding),
          attempt: binding.attempt,
          rollbackRef,
        }),
      );
      await this.commitAudit(
        this.auditRecord("execution.attempt_reserved", plan, {
          occurredAt: reservedAt,
          approval,
          authorization,
          executionRef: executionRef(binding),
          attempt: binding.attempt,
          rollbackRef,
        }),
      );
    } catch (error: unknown) {
      return {
        status: "denied",
        code: this.preEffectCode(error, "reservation_unavailable"),
        duplicate: false,
      };
    }

    let startedAt: string;
    try {
      startedAt = safeNow(this.options.clock);
    } catch {
      return { status: "denied", code: "reservation_unavailable", duplicate: false };
    }
    const startedAudit = this.auditRecord("execution.started", plan, {
      occurredAt: startedAt,
      approval,
      authorization,
      executionRef: executionRef(binding),
      attempt: binding.attempt,
      rollbackRef,
      aggregateOutcome: "completion_unknown",
    });
    try {
      await this.options.ledger.markStarted(
        binding.reservation_ref,
        binding.reservation_digest,
        startedAt,
      );
      this.options.hooks?.onBoundary?.("post_started_state");
      await this.commitAudit(startedAudit);
      await this.options.audit.assertReady();
      await this.options.ledger.assertReady();
    } catch {
      return this.withholdAfterStart(binding, startedAudit, null, null);
    }

    this.options.hooks?.onBoundary?.("pre_effect");
    let steps: readonly ExecutionStepRecord[];
    try {
      const effectResult = await runWithTimeout(plan.timeout_ms, (signal) =>
        this.options.effects.apply({
          execution_ref: executionRef(binding),
          plan,
          attempt: binding.attempt,
          signal,
        }),
      );
      steps = validateEffectSteps(effectResult.steps, plan);
    } catch {
      steps = unknownSteps(plan);
    }
    this.options.hooks?.onBoundary?.("post_start");
    let completedAt: string;
    try {
      completedAt = safeNow(this.options.clock);
    } catch {
      return this.withholdAfterStart(binding, startedAudit, null, null);
    }
    const execution = buildExecutionRecord({
      plan,
      approval,
      authorization,
      binding,
      startedAt,
      completedAt,
      steps,
    });
    const completionAudit = this.auditRecord("execution.completed", plan, {
      occurredAt: completedAt,
      approval,
      authorization,
      execution,
      attempt: binding.attempt,
      rollbackRef,
      aggregateOutcome: execution.aggregate_outcome,
    });
    this.options.hooks?.onBoundary?.("pre_result");
    try {
      await this.options.ledger.recordExecution(
        binding.reservation_ref,
        binding.reservation_digest,
        execution,
      );
      this.options.hooks?.onBoundary?.("post_result");
      await this.commitAudit(completionAudit);
    } catch {
      return this.withholdAfterStart(binding, completionAudit, execution, null);
    }

    if (
      execution.aggregate_outcome === "no_effect_proven" ||
      execution.aggregate_outcome === "completion_unknown"
    ) {
      const finalOutcome =
        execution.aggregate_outcome === "no_effect_proven" ? "failed" : "completion_unknown";
      let resultOccurredAt: string;
      try {
        resultOccurredAt = safeNow(this.options.clock);
      } catch {
        return this.withholdAfterStart(binding, completionAudit, execution, null);
      }
      const resultAudit = this.auditRecord("result.withheld", plan, {
        occurredAt: resultOccurredAt,
        approval,
        authorization,
        execution,
        attempt: binding.attempt,
        rollbackRef,
        aggregateOutcome: execution.aggregate_outcome,
        finalOutcome,
      });
      if (finalOutcome === "completion_unknown") {
        try {
          await this.commitAudit(resultAudit);
          await this.options.ledger.recordFinal(
            binding.reservation_ref,
            binding.reservation_digest,
            "completion_unknown",
          );
          return {
            status: "completion_unknown",
            code: "operation_outcome_unknown",
            duplicate: false,
            execution,
            verification: null,
            recovery: "not_required",
          };
        } catch {
          return this.withholdAfterStart(binding, resultAudit, execution, null);
        }
      }
      try {
        await this.commitAudit(resultAudit);
        await this.options.ledger.recordFinal(
          binding.reservation_ref,
          binding.reservation_digest,
          "failed",
        );
      } catch {
        return this.withholdAfterStart(binding, resultAudit, execution, null);
      }
      return {
        status: "failed",
        code: "no_effect_proven",
        duplicate: false,
        execution,
        verification: null,
      };
    }

    let verificationStartedAt: string;
    try {
      verificationStartedAt = safeNow(this.options.clock);
    } catch {
      return this.withholdAfterStart(binding, completionAudit, execution, null);
    }
    const verificationReference = verificationRef(execution.execution_digest);
    try {
      await this.commitAudit(
        this.auditRecord("verification.started", plan, {
          occurredAt: verificationStartedAt,
          approval,
          authorization,
          execution,
          verificationRef: verificationReference,
          attempt: binding.attempt,
          rollbackRef,
          aggregateOutcome: execution.aggregate_outcome,
        }),
      );
    } catch {
      return this.withholdAfterStart(binding, completionAudit, execution, null);
    }
    this.options.hooks?.onBoundary?.("pre_verification");
    let observations: readonly VerificationObservation[];
    try {
      const observed = await runWithTimeout(plan.timeout_ms, (signal) =>
        this.options.verifier.verify({
          verification_ref: verificationReference,
          plan,
          execution,
          signal,
        }),
      );
      observations = observed.observations;
    } catch {
      observations = inconclusiveObservations(plan, safeNow(this.options.clock));
    }
    let verificationCompletedAt: string;
    try {
      verificationCompletedAt = safeNow(this.options.clock);
    } catch {
      return this.withholdAfterStart(binding, completionAudit, execution, null);
    }
    let verification: VerificationRecordV1;
    try {
      verification = buildVerificationRecord({
        plan,
        execution,
        startedAt: verificationStartedAt,
        completedAt: verificationCompletedAt,
        observations,
      });
    } catch {
      verification = buildVerificationRecord({
        plan,
        execution,
        startedAt: verificationStartedAt,
        completedAt: verificationCompletedAt,
        observations: inconclusiveObservations(plan, verificationCompletedAt),
      });
    }
    try {
      await this.options.ledger.recordVerification(
        binding.reservation_ref,
        binding.reservation_digest,
        verification,
      );
      this.options.hooks?.onBoundary?.("post_verification");
      await this.commitAudit(
        this.auditRecord(
          verification.outcome === "verified" ? "verification.completed" : "verification.failed",
          plan,
          {
            occurredAt: verificationCompletedAt,
            approval,
            authorization,
            execution,
            verification,
            attempt: binding.attempt,
            rollbackRef,
            aggregateOutcome: execution.aggregate_outcome,
          },
        ),
      );
    } catch {
      return this.withholdAfterStart(binding, completionAudit, execution, verification);
    }

    const succeeded =
      execution.aggregate_outcome === "effect_observed" && verification.outcome === "verified";
    const partial = execution.aggregate_outcome === "partial_effect";
    const finalOutcome = succeeded ? "succeeded" : partial ? "partial_effect" : "failed";
    let finalOccurredAt: string;
    try {
      finalOccurredAt = safeNow(this.options.clock);
    } catch {
      return this.withholdAfterStart(binding, completionAudit, execution, verification);
    }
    const finalAudit = this.auditRecord(succeeded ? "result.released" : "result.withheld", plan, {
      occurredAt: finalOccurredAt,
      approval,
      authorization,
      execution,
      verification,
      attempt: binding.attempt,
      rollbackRef,
      aggregateOutcome: execution.aggregate_outcome,
      finalOutcome,
    });
    this.options.hooks?.onBoundary?.("pre_final");
    try {
      await this.commitAudit(finalAudit);
      this.options.hooks?.onBoundary?.("post_final_audit");
      await this.options.ledger.recordFinal(
        binding.reservation_ref,
        binding.reservation_digest,
        finalOutcome,
      );
    } catch {
      return this.withholdAfterStart(binding, completionAudit, execution, verification);
    }
    if (succeeded) {
      return { status: "succeeded", duplicate: false, execution, verification };
    }
    if (partial) {
      return {
        status: "partial_effect",
        code: "operation_partially_applied",
        duplicate: false,
        execution,
        verification,
      };
    }
    return {
      status: "failed",
      code:
        verification.outcome === "inconclusive"
          ? "verification_inconclusive"
          : "verification_failed",
      duplicate: false,
      execution,
      verification,
    };
  }

  private async checkPreconditions(
    plan: MutationPlanV1,
    now: string,
    freshnessFloor: string,
  ): Promise<boolean> {
    if (Date.parse(now) >= Date.parse(plan.expires_at)) return false;
    for (const condition of plan.preconditions) {
      let observation;
      try {
        observation = await this.options.conditions.observe({ plan, condition });
      } catch {
        return false;
      }
      if (
        observation.condition_ref !== condition.condition_ref ||
        observation.observation_ref !== condition.observation_ref ||
        observation.observation_digest !== condition.expected_digest ||
        !isValidAuditTimestamp(observation.observed_at) ||
        Date.parse(observation.observed_at) < Date.parse(freshnessFloor) ||
        Date.parse(observation.observed_at) > Date.parse(now) ||
        Date.parse(now) >= Date.parse(condition.fresh_until)
      ) {
        return false;
      }
    }
    return true;
  }

  private async commitAuthorizationAudit(
    plan: MutationPlanV1,
    approval: ApprovalReceiptV1 | null,
    authorization: FreshAuthorizationResult,
    rollbackRef: string | null,
  ): Promise<void> {
    await this.commitAudit(
      this.auditRecord("authorization.evaluation_recorded", plan, {
        occurredAt: safeNow(this.options.clock),
        approval,
        authorization,
        rollbackRef,
      }),
    );
    await this.commitAudit(
      this.auditRecord("authorization.decision_recorded", plan, {
        occurredAt: safeNow(this.options.clock),
        approval,
        authorization,
        rollbackRef,
      }),
    );
  }

  private auditRecord(
    stage: LifecycleAuditStage,
    plan: MutationPlanV1,
    options: Readonly<{
      occurredAt: string;
      approval?: ApprovalReceiptV1 | null;
      authorization?: FreshAuthorizationResult;
      enforcementResult?: "enforced" | "denied";
      executionRef?: string;
      execution?: ExecutionRecordV1 | null;
      verificationRef?: string;
      verification?: VerificationRecordV1 | null;
      rollbackRef?: string | null;
      attempt?: number;
      aggregateOutcome?: AggregateOutcome;
      finalOutcome?: "succeeded" | "denied" | "failed" | "partial_effect" | "completion_unknown";
    }>,
  ): LifecycleAuditRecord {
    const executionReference = options.execution?.execution_ref ?? options.executionRef ?? null;
    const verificationReference =
      options.verification?.verification_ref ?? options.verificationRef ?? null;
    return Object.freeze({
      audit_record_version: 1,
      stage,
      occurred_at: options.occurredAt,
      plan_id: plan.plan_id,
      plan_digest: plan.plan_digest,
      approval_ref: options.approval?.approval_id ?? null,
      approval_digest: options.approval?.approval_digest ?? null,
      execution_ref: executionReference,
      verification_ref: verificationReference,
      rollback_ref: options.rollbackRef ?? null,
      authorization_request_ref: options.authorization?.request.authorization_request_id ?? null,
      authorization_request_digest: options.authorization?.request.request_digest ?? null,
      authorization_decision_ref: options.authorization?.decision.decision_id ?? null,
      authorization_decision_digest: options.authorization?.decision.decision_digest ?? null,
      authorization_effect: options.authorization?.decision.effect ?? null,
      authorization_basis: options.authorization?.decision.basis ?? null,
      evaluator_ref: options.authorization?.decision.evaluator_ref ?? null,
      enforcement_result: options.enforcementResult ?? null,
      attempt: options.attempt ?? null,
      execution_digest: options.execution?.execution_digest ?? null,
      verification_digest: options.verification?.verification_digest ?? null,
      verification_outcome: options.verification?.outcome ?? null,
      aggregate_outcome: options.aggregateOutcome ?? null,
      final_outcome: options.finalOutcome ?? null,
    });
  }

  private async commitAudit(record: LifecycleAuditRecord): Promise<void> {
    const receipt = await this.options.audit.commit(record);
    if (receipt.durability !== "durable" || !REFERENCE_PATTERN.test(receipt.event_ref)) {
      throw new LifecyclePortError("audit_unavailable");
    }
  }

  private async withholdAfterStart(
    binding: AttemptReservationBinding,
    record: LifecycleAuditRecord,
    execution: ExecutionRecordV1 | null,
    verification: VerificationRecordV1 | null,
  ): Promise<LifecycleApplyResult> {
    try {
      await this.options.ledger.recordFinal(
        binding.reservation_ref,
        binding.reservation_digest,
        "completion_unknown",
      );
    } catch {
      // The recovery journal remains the independent durable fallback.
    }
    let recovery: "journaled" | "journal_unavailable" = "journal_unavailable";
    try {
      const receipt = await this.options.audit.recover({
        recovery_id: recoveryRef(binding, record.stage),
        record,
      });
      if (receipt.durability === "durable") recovery = "journaled";
    } catch {
      recovery = "journal_unavailable";
    }
    return {
      status: "completion_unknown",
      code: "operation_outcome_unknown",
      duplicate: false,
      execution,
      verification,
      recovery,
    };
  }

  private preEffectCode(error: unknown, fallback: LifecycleDeniedCode): LifecycleDeniedCode {
    if (error instanceof LifecycleContractError) {
      if (error.code === "approval_required") return "approval_required";
      if (error.code === "approval_denied") return "approval_denied";
      return "plan_invalidated";
    }
    if (error instanceof LifecyclePortError) {
      switch (error.code) {
        case "audit_unavailable":
          return "audit_unavailable";
        case "authorization_unavailable":
          return "authorization_unavailable";
        case "reservation_conflict":
          return "reservation_conflict";
        case "reservation_capacity":
        case "reservation_unavailable":
        case "state_conflict":
          return "reservation_unavailable";
        case "precondition_unavailable":
          return "precondition_failed";
        case "effect_unavailable":
        case "verification_unavailable":
          return fallback;
      }
    }
    return fallback;
  }
}
