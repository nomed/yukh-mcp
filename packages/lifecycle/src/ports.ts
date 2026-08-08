import type {
  AuthorizationDecisionV1,
  AuthorizationObligationReceipt,
  AuthorizationRequestV1,
} from "../../../contracts/authorization/v1/authorization.mjs";
import type {
  AggregateOutcome,
  ApprovalReceiptV1,
  ExecutionRecordV1,
  ExecutionStepRecord,
  MutationPlanV1,
  RollbackRecordV1,
  VerificationObservation,
  VerificationRecordV1,
} from "./contract.js";

export type LifecyclePortErrorCode =
  | "authorization_unavailable"
  | "precondition_unavailable"
  | "effect_unavailable"
  | "verification_unavailable"
  | "audit_unavailable"
  | "reservation_unavailable"
  | "reservation_conflict"
  | "reservation_capacity"
  | "state_conflict";

export class LifecyclePortError extends Error {
  constructor(readonly code: LifecyclePortErrorCode) {
    super(code);
    this.name = "LifecyclePortError";
  }
}

export interface LifecycleClock {
  now(): string;
}

export interface FreshAuthorizationResult {
  readonly request: AuthorizationRequestV1;
  readonly decision: AuthorizationDecisionV1;
  readonly authentication_context_digest: string;
  readonly constraint_handlers: Readonly<Record<string, (value: unknown) => boolean>>;
  readonly obligation_receipts: readonly AuthorizationObligationReceipt[];
}

export interface FreshAuthorizationPort {
  authorize(
    input: Readonly<{
      plan: MutationPlanV1;
      approval: ApprovalReceiptV1 | null;
    }>,
  ): Promise<FreshAuthorizationResult>;
}

export interface ConditionObservation {
  readonly condition_ref: string;
  readonly observation_ref: string;
  readonly observation_digest: string;
  readonly observed_at: string;
}

export interface LifecycleConditionPort {
  observe(
    input: Readonly<{
      plan: MutationPlanV1;
      condition: MutationPlanV1["preconditions"][number];
    }>,
  ): Promise<ConditionObservation>;
}

export interface EffectPortResult {
  readonly steps: readonly ExecutionStepRecord[];
}

export interface LifecycleEffectPort {
  apply(
    input: Readonly<{
      execution_ref: string;
      plan: MutationPlanV1;
      attempt: number;
      signal: AbortSignal;
    }>,
  ): Promise<EffectPortResult>;
}

export interface VerificationPortResult {
  readonly observations: readonly VerificationObservation[];
}

export interface LifecycleVerificationPort {
  verify(
    input: Readonly<{
      verification_ref: string;
      plan: MutationPlanV1;
      execution: ExecutionRecordV1;
      signal: AbortSignal;
    }>,
  ): Promise<VerificationPortResult>;
}

export type LifecycleAuditStage =
  | "plan.created"
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected"
  | "authorization.evaluation_recorded"
  | "authorization.decision_recorded"
  | "authorization.enforcement_recorded"
  | "apply.admitted"
  | "execution.attempt_reserved"
  | "execution.started"
  | "execution.completed"
  | "verification.started"
  | "verification.completed"
  | "verification.failed"
  | "result.released"
  | "result.withheld"
  | "rollback.requested"
  | "rollback.completed"
  | "rollback.failed"
  | "rollback.completion_unknown";

export interface LifecycleAuditRecord {
  readonly audit_record_version: 1;
  readonly stage: LifecycleAuditStage;
  readonly occurred_at: string;
  readonly plan_id: string;
  readonly plan_digest: string;
  readonly approval_ref: string | null;
  readonly approval_digest: string | null;
  readonly execution_ref: string | null;
  readonly verification_ref: string | null;
  readonly rollback_ref: string | null;
  readonly authorization_request_ref: string | null;
  readonly authorization_request_digest: string | null;
  readonly authorization_decision_ref: string | null;
  readonly authorization_decision_digest: string | null;
  readonly authorization_effect: "allow" | "deny" | null;
  readonly authorization_basis: "explicit" | "default" | "error" | "indeterminate" | null;
  readonly evaluator_ref: string | null;
  readonly enforcement_result: "enforced" | "denied" | null;
  readonly attempt: number | null;
  readonly execution_digest: string | null;
  readonly verification_digest: string | null;
  readonly verification_outcome: "verified" | "failed" | "inconclusive" | null;
  readonly aggregate_outcome: AggregateOutcome | null;
  readonly final_outcome:
    "succeeded" | "denied" | "failed" | "partial_effect" | "completion_unknown" | null;
}

export interface LifecycleAuditPort {
  assertReady(): Promise<void>;
  commit(record: LifecycleAuditRecord): Promise<
    Readonly<{
      durability: "durable";
      event_ref: string;
    }>
  >;
  recover(
    input: Readonly<{
      recovery_id: string;
      record: LifecycleAuditRecord;
    }>,
  ): Promise<Readonly<{ durability: "durable" }> | Readonly<{ durability: "unavailable" }>>;
}

export interface AttemptReservationBinding {
  readonly reservation_binding_version: 1;
  readonly reservation_ref: string;
  readonly reservation_digest: string;
  readonly idempotency_scope_digest: string;
  readonly plan_id: string;
  readonly plan_digest: string;
  readonly approval_id: string | null;
  readonly approval_digest: string | null;
  readonly approval_nonce_digest: string | null;
  readonly authorization_request_id: string;
  readonly authorization_request_digest: string;
  readonly authorization_decision_id: string;
  readonly authorization_decision_digest: string;
  readonly subject_ref: string;
  readonly capability_definition_digest: string;
  readonly resource_set_digest: string;
  readonly environment_ref: string;
  readonly operation_set_digest: string;
  readonly attempt: number;
  readonly reserved_at: string;
}

export type ReservationState =
  | "not_started"
  | "started"
  | "effect_observed"
  | "no_effect_proven"
  | "partial_effect"
  | "completion_unknown"
  | "verification_failed"
  | "succeeded";

export interface AttemptReservationSnapshot {
  readonly binding: AttemptReservationBinding;
  readonly state: ReservationState;
  readonly state_version: number;
  readonly execution: ExecutionRecordV1 | null;
  readonly verification: VerificationRecordV1 | null;
  readonly final_outcome: "succeeded" | "failed" | "partial_effect" | "completion_unknown" | null;
}

export interface AttemptReservationLedger {
  assertReady(): Promise<void>;
  reserve(
    binding: AttemptReservationBinding,
  ): Promise<
    | Readonly<{ status: "reserved"; snapshot: AttemptReservationSnapshot }>
    | Readonly<{ status: "duplicate"; snapshot: AttemptReservationSnapshot }>
  >;
  markStarted(reservationRef: string, reservationDigest: string, startedAt: string): Promise<void>;
  recordExecution(
    reservationRef: string,
    reservationDigest: string,
    execution: ExecutionRecordV1,
  ): Promise<void>;
  recordVerification(
    reservationRef: string,
    reservationDigest: string,
    verification: VerificationRecordV1,
  ): Promise<void>;
  recordFinal(
    reservationRef: string,
    reservationDigest: string,
    outcome: "succeeded" | "failed" | "partial_effect" | "completion_unknown",
  ): Promise<void>;
  read(
    reservationRef: string,
    reservationDigest: string,
  ): Promise<AttemptReservationSnapshot | undefined>;
  close(): Promise<void>;
}

export type LifecycleBoundary =
  | "pre_reservation"
  | "post_reservation"
  | "post_started_state"
  | "pre_effect"
  | "post_start"
  | "pre_result"
  | "post_result"
  | "pre_verification"
  | "post_verification"
  | "pre_final"
  | "post_final_audit";

export interface LifecycleQualificationHooks {
  onBoundary?(boundary: LifecycleBoundary): void;
}

export interface RollbackExecutionInput {
  readonly rollback: RollbackRecordV1;
  readonly plan: MutationPlanV1;
}
