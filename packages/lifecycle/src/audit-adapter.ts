import {
  validateAuditCandidate,
  type AuditCandidate,
  type AuditEventType,
} from "../../audit/src/contract.js";
import {
  createRecoveryFact,
  type RecoveryJournal,
  type RequiredAuditReadiness,
  type RequiredAuditWriter,
} from "../../audit/src/lifecycle.js";
import { lifecycleDigest, type MutationPlanV1 } from "./contract.js";
import {
  LifecyclePortError,
  type LifecycleAuditPort,
  type LifecycleAuditRecord,
  type LifecycleAuditStage,
} from "./ports.js";

const EVENT_TYPE_BY_STAGE = {
  "plan.created": "plan.created.v1",
  "approval.requested": "approval.requested.v1",
  "approval.approved": "approval.approved.v1",
  "approval.rejected": "approval.rejected.v1",
  "authorization.evaluation_recorded": "authorization.evaluation_recorded.v1",
  "authorization.decision_recorded": "authorization.decision_recorded.v1",
  "authorization.enforcement_recorded": "authorization.enforcement_recorded.v1",
  "apply.admitted": "apply.admitted.v1",
  "execution.attempt_reserved": "execution.attempt_reserved.v1",
  "execution.started": "execution.started.v1",
  "execution.completed": "execution.completed.v1",
  "verification.started": "verification.started.v1",
  "verification.completed": "verification.completed.v1",
  "verification.failed": "verification.failed.v1",
  "result.released": "result.released.v1",
  "result.withheld": "result.withheld.v1",
  "rollback.requested": "rollback.requested.v1",
  "rollback.completed": "rollback.completed.v1",
  "rollback.failed": "rollback.failed.v1",
  "rollback.completion_unknown": "rollback.completion_unknown.v1",
} as const satisfies Record<LifecycleAuditStage, AuditEventType>;

export interface LifecycleAuditCandidateFactory {
  candidate(record: LifecycleAuditRecord): unknown;
  recoveryCandidate(record: LifecycleAuditRecord): unknown;
}

export interface AuditWriterLifecyclePortOptions {
  readonly writer: RequiredAuditWriter;
  readonly readiness: RequiredAuditReadiness;
  readonly journal: RecoveryJournal;
  readonly candidates: LifecycleAuditCandidateFactory;
}

export interface LifecycleAuditCandidateFactoryOptions {
  readonly plan: MutationPlanV1;
  readonly traceRef: string;
  readonly requestRef: string;
  readonly requestEventRef: string;
  readonly planningEnforcementEventRef: string;
  readonly approvalRef: string | null;
  readonly producer: Readonly<{
    component_ref: "component.gateway";
    instance_ref: string;
  }>;
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new LifecyclePortError("audit_unavailable");
  return value;
}

function eventRef(candidate: unknown): string {
  return `event_${lifecycleDigest(candidate).slice(7, 47)}`;
}

export function createLifecycleAuditCandidateFactory(
  options: LifecycleAuditCandidateFactoryOptions,
): LifecycleAuditCandidateFactory {
  const candidates = new Map<LifecycleAuditStage, AuditCandidate>();
  let latestAuthorizationRequestRef: string | null = null;
  let latestAuthorizationDecisionRef: string | null = null;
  let latestApprovalRef = options.approvalRef;
  let latestExecutionRef: string | null = null;
  let latestVerificationRef: string | null = null;
  let latestRollbackRef: string | null = null;

  const previous = (stage: LifecycleAuditStage): AuditCandidate => {
    const candidate = candidates.get(stage);
    if (candidate === undefined) throw new LifecyclePortError("audit_unavailable");
    return candidate;
  };

  const create = (record: LifecycleAuditRecord): AuditCandidate => {
    if (
      record.plan_id !== options.plan.plan_id ||
      record.plan_digest !== options.plan.plan_digest
    ) {
      throw new LifecyclePortError("audit_unavailable");
    }
    const stage = record.stage;
    const planningStage =
      stage === "plan.created" ||
      stage === "approval.requested" ||
      stage === "approval.approved" ||
      stage === "approval.rejected";
    const authorizationRequestRef = planningStage
      ? options.plan.planning_authorization.request_id
      : (record.authorization_request_ref ?? latestAuthorizationRequestRef);
    const authorizationDecisionRef = planningStage
      ? options.plan.planning_authorization.decision_id
      : (record.authorization_decision_ref ?? latestAuthorizationDecisionRef);
    const approvalRef =
      stage === "plan.created" ? null : (record.approval_ref ?? latestApprovalRef);
    const executionReference =
      record.execution_ref ??
      latestExecutionRef ??
      options.plan.rollback_context?.original_execution_ref ??
      null;
    const verificationReference = record.verification_ref ?? latestVerificationRef;
    const rollbackReference = record.rollback_ref ?? latestRollbackRef;
    const isEvaluation = stage === "authorization.evaluation_recorded";
    const hasPlan = stage !== "rollback.requested" || options.plan.rollback_context !== null;
    const correlation = {
      trace_ref: options.traceRef,
      request_ref: options.requestRef,
      authorization_request_ref: authorizationRequestRef,
      authorization_decision_ref: isEvaluation ? null : authorizationDecisionRef,
      plan_ref: hasPlan ? options.plan.plan_id : null,
      approval_ref: approvalRef,
      execution_ref: executionReference,
      verification_ref: verificationReference,
      rollback_ref: rollbackReference,
    };

    let parents: readonly string[];
    let outcome: AuditCandidate["outcome"];
    let payload: Readonly<Record<string, unknown>>;
    switch (stage) {
      case "plan.created":
        parents = [options.planningEnforcementEventRef];
        outcome = { status: "created", reason_codes: ["plan_created"] };
        payload = {
          plan_digest: record.plan_digest,
          authorization_decision_digest: options.plan.planning_authorization.decision_digest,
          observation_digest: options.plan.target_snapshot.digest,
        };
        break;
      case "approval.requested":
        parents = [previous("plan.created").event_id];
        outcome = { status: "requested", reason_codes: ["approval_requested"] };
        payload = { plan_digest: record.plan_digest };
        break;
      case "approval.approved":
        parents = [previous("approval.requested").event_id, previous("plan.created").event_id];
        outcome = { status: "approved", reason_codes: ["approval_approved"] };
        payload = {
          plan_digest: record.plan_digest,
          approval_digest: required(record.approval_digest),
        };
        break;
      case "approval.rejected":
        parents = [previous("approval.requested").event_id, previous("plan.created").event_id];
        outcome = { status: "rejected", reason_codes: ["approval_rejected"] };
        payload = {
          plan_digest: record.plan_digest,
          approval_digest: record.approval_digest,
        };
        break;
      case "authorization.evaluation_recorded":
        parents =
          approvalRef === null
            ? [options.requestEventRef, previous("plan.created").event_id]
            : [
                options.requestEventRef,
                previous("plan.created").event_id,
                previous("approval.approved").event_id,
              ];
        outcome = { status: "accepted", reason_codes: ["accepted"] };
        payload = {
          authorization_request_digest: required(record.authorization_request_digest),
          attribute_snapshot_ref: options.plan.attributes.snapshot_ref,
          attribute_snapshot_digest: options.plan.attributes.digest,
          evaluator_ref: required(record.evaluator_ref),
          authorization_phase: "apply",
          plan_digest: record.plan_digest,
        };
        break;
      case "authorization.decision_recorded":
        parents = [previous("authorization.evaluation_recorded").event_id];
        outcome =
          record.authorization_effect === "allow"
            ? { status: "allowed", reason_codes: ["policy_allow"] }
            : { status: "denied", reason_codes: ["policy_deny"] };
        payload = {
          authorization_request_digest: required(record.authorization_request_digest),
          decision_digest: required(record.authorization_decision_digest),
          effect: required(record.authorization_effect),
          basis: required(record.authorization_basis),
          policy_revision_ref: options.plan.policy.bundle_ref,
          policy_digest: options.plan.policy.digest,
          authorization_phase: "apply",
          plan_digest: record.plan_digest,
        };
        break;
      case "authorization.enforcement_recorded":
        parents = [previous("authorization.decision_recorded").event_id];
        outcome =
          record.enforcement_result === "enforced"
            ? { status: "allowed", reason_codes: ["enforced"] }
            : { status: "denied", reason_codes: ["policy_deny"] };
        payload = {
          decision_digest: required(record.authorization_decision_digest),
          enforcement_result: required(record.enforcement_result),
          authorization_phase: "apply",
          plan_digest: record.plan_digest,
        };
        break;
      case "apply.admitted":
        parents =
          approvalRef === null
            ? [
                previous("authorization.enforcement_recorded").event_id,
                previous("plan.created").event_id,
              ]
            : [
                previous("authorization.enforcement_recorded").event_id,
                previous("plan.created").event_id,
                previous("approval.approved").event_id,
              ];
        outcome = { status: "admitted", reason_codes: ["apply_admitted"] };
        payload = {
          plan_digest: record.plan_digest,
          fresh_authorization_decision_digest: required(record.authorization_decision_digest),
        };
        break;
      case "execution.attempt_reserved":
        parents = [previous("apply.admitted").event_id];
        outcome = { status: "reserved", reason_codes: ["attempt_reserved"] };
        payload = { plan_digest: record.plan_digest, attempt: required(record.attempt) };
        break;
      case "execution.started":
        parents = [previous("execution.attempt_reserved").event_id];
        outcome = { status: "started", reason_codes: ["provider_started"] };
        payload = { plan_digest: record.plan_digest, attempt: required(record.attempt) };
        break;
      case "execution.completed":
        parents = [previous("execution.started").event_id];
        outcome = {
          status: "completed",
          reason_codes: [required(record.aggregate_outcome)],
        };
        payload = {
          plan_digest: record.plan_digest,
          attempt: required(record.attempt),
          result: required(record.aggregate_outcome),
        };
        break;
      case "verification.started":
        parents = [previous("execution.completed").event_id];
        outcome = { status: "verifying", reason_codes: ["verification_started"] };
        payload = { plan_digest: record.plan_digest, attempt: required(record.attempt) };
        break;
      case "verification.completed":
        parents = [previous("verification.started").event_id];
        outcome = { status: "verified", reason_codes: ["verification_verified"] };
        payload = {
          plan_digest: record.plan_digest,
          attempt: required(record.attempt),
          verification_digest: required(record.verification_digest),
          result: "verified",
        };
        break;
      case "verification.failed": {
        parents = [previous("verification.started").event_id];
        const inconclusive = record.verification_outcome === "inconclusive";
        outcome = inconclusive
          ? { status: "inconclusive", reason_codes: ["verification_inconclusive"] }
          : { status: "failed", reason_codes: ["verification_failed"] };
        payload = {
          plan_digest: record.plan_digest,
          attempt: required(record.attempt),
          verification_digest: required(record.verification_digest),
          result: inconclusive ? "inconclusive" : "failed",
        };
        break;
      }
      case "result.released":
        parents = [previous("verification.completed").event_id];
        outcome = { status: "released", reason_codes: ["result_released"] };
        payload = {
          plan_digest: record.plan_digest,
          attempt: required(record.attempt),
          verification_digest: required(record.verification_digest),
          result: "succeeded",
        };
        break;
      case "result.withheld":
        parents =
          verificationReference === null
            ? [previous("execution.completed").event_id]
            : [
                previous(
                  record.verification_outcome === "verified"
                    ? "verification.completed"
                    : "verification.failed",
                ).event_id,
              ];
        outcome = { status: "withheld", reason_codes: ["result_withheld"] };
        payload = {
          plan_digest: record.plan_digest,
          attempt: required(record.attempt),
          verification_digest: record.verification_digest,
          verification_result: record.verification_outcome,
          result:
            record.final_outcome === "partial_effect"
              ? "partial_effect"
              : record.final_outcome === "completion_unknown"
                ? "completion_unknown"
                : "failed",
        };
        break;
      case "rollback.requested":
        parents = [];
        outcome = { status: "requested", reason_codes: ["rollback_requested"] };
        payload = {
          original_execution_digest: required(
            options.plan.rollback_context?.original_execution_digest,
          ),
          rollback_plan_digest: record.plan_digest,
        };
        break;
      case "rollback.completed":
        parents = [previous("result.released").event_id];
        outcome = { status: "completed", reason_codes: ["rollback_completed"] };
        payload = {
          original_execution_digest: required(
            options.plan.rollback_context?.original_execution_digest,
          ),
          rollback_plan_digest: record.plan_digest,
          rollback_execution_digest: required(record.execution_digest),
          result: "completed",
        };
        break;
      case "rollback.failed":
        parents = [previous("result.withheld").event_id];
        outcome = { status: "failed", reason_codes: ["rollback_failed"] };
        payload = {
          original_execution_digest: required(
            options.plan.rollback_context?.original_execution_digest,
          ),
          rollback_plan_digest: record.plan_digest,
          rollback_execution_digest: record.execution_digest,
          result: "failed",
        };
        break;
      case "rollback.completion_unknown":
        parents = [previous("result.withheld").event_id];
        outcome = { status: "unknown", reason_codes: ["rollback_completion_unknown"] };
        payload = {
          original_execution_digest: required(
            options.plan.rollback_context?.original_execution_digest,
          ),
          rollback_plan_digest: record.plan_digest,
          rollback_execution_digest: record.execution_digest,
          result: "completion_unknown",
        };
        break;
    }

    const candidateWithoutId = {
      audit_candidate_version: 1,
      event_type: EVENT_TYPE_BY_STAGE[stage],
      occurred_at: record.occurred_at,
      producer: options.producer,
      correlation,
      causation: { parent_event_refs: parents },
      subject: {
        ref: options.plan.subject.ref,
        kind: options.plan.subject.kind,
      },
      capability: {
        id: options.plan.capability.id,
        version: options.plan.capability.version,
        definition_digest: options.plan.capability.definition_digest,
      },
      scope: {
        resource_kind: options.plan.scope.resource_kind,
        resource_set_ref: options.plan.scope.resource_set_ref,
        resource_set_digest: options.plan.scope.resource_set_digest,
        environment_ref: options.plan.scope.environment_ref,
      },
      outcome,
      payload,
    } as const;
    const candidate = validateAuditCandidate({
      ...candidateWithoutId,
      event_id: eventRef(candidateWithoutId),
    });
    candidates.set(stage, candidate);
    latestAuthorizationRequestRef =
      candidate.correlation.authorization_request_ref ?? latestAuthorizationRequestRef;
    latestAuthorizationDecisionRef =
      candidate.correlation.authorization_decision_ref ?? latestAuthorizationDecisionRef;
    latestApprovalRef = candidate.correlation.approval_ref ?? latestApprovalRef;
    latestExecutionRef = candidate.correlation.execution_ref ?? latestExecutionRef;
    latestVerificationRef = candidate.correlation.verification_ref ?? latestVerificationRef;
    latestRollbackRef = candidate.correlation.rollback_ref ?? latestRollbackRef;
    return candidate;
  };

  return Object.freeze({
    candidate: create,
    recoveryCandidate(): AuditCandidate {
      return (
        candidates.get("execution.completed") ??
        candidates.get("execution.started") ??
        (() => {
          throw new LifecyclePortError("audit_unavailable");
        })()
      );
    },
  });
}

function parseExpectedCandidate(value: unknown, eventType: AuditEventType): AuditCandidate {
  const candidate = validateAuditCandidate(value);
  if (candidate.event_type !== eventType) throw new LifecyclePortError("audit_unavailable");
  return candidate;
}

export function createAuditWriterLifecyclePort(
  options: AuditWriterLifecyclePortOptions,
): LifecycleAuditPort {
  return Object.freeze({
    async assertReady(): Promise<void> {
      try {
        await options.readiness.assertReadyForProviderStart();
      } catch {
        throw new LifecyclePortError("audit_unavailable");
      }
    },
    async commit(record: LifecycleAuditRecord) {
      try {
        const candidate = parseExpectedCandidate(
          options.candidates.candidate(record),
          EVENT_TYPE_BY_STAGE[record.stage],
        );
        const receipt = await options.writer.commit(candidate);
        if (receipt.durability !== "durable" || receipt.event.event_id !== candidate.event_id) {
          throw new LifecyclePortError("audit_unavailable");
        }
        return Object.freeze({
          durability: "durable" as const,
          event_ref: receipt.event.event_id,
        });
      } catch (error: unknown) {
        if (error instanceof LifecyclePortError) throw error;
        throw new LifecyclePortError("audit_unavailable");
      }
    },
    async recover(input: Readonly<{ recovery_id: string; record: LifecycleAuditRecord }>) {
      try {
        const candidate = validateAuditCandidate(
          options.candidates.recoveryCandidate(input.record),
        );
        if (
          candidate.event_type !== "execution.started.v1" &&
          candidate.event_type !== "execution.completed.v1"
        ) {
          throw new LifecyclePortError("audit_unavailable");
        }
        const fact = createRecoveryFact(input.recovery_id, candidate);
        const receipt = await options.journal.append(fact);
        return receipt.durability === "durable"
          ? Object.freeze({ durability: "durable" as const })
          : Object.freeze({ durability: "unavailable" as const });
      } catch {
        return Object.freeze({ durability: "unavailable" as const });
      }
    },
  });
}
