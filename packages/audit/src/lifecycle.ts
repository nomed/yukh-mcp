import {
  AUDIT_EVENT_TYPES,
  AUDIT_REGISTRY,
  AuditError,
  type AuditCandidate,
  type AuditEventType,
  requiredParentTypes,
  validateAuditCandidate,
} from "./contract.js";
import type { AuditCommitReceipt } from "./writer.js";

export interface RequiredAuditWriter {
  commit(candidate: AuditCandidate): Promise<AuditCommitReceipt>;
}

export interface RecoveryFact {
  readonly recovery_fact_version: 1;
  readonly recovery_id: string;
  readonly event_id: string;
  readonly event_type: AuditEventType;
  readonly original_observed_at: string;
  readonly original_observation_parent_event_ref: string;
  readonly cause: "primary_writer_failed_after_provider_start";
  readonly trace_ref: string;
  readonly request_ref: string;
  readonly execution_ref: string;
  readonly plan_digest: string;
  readonly attempt: number;
  readonly observed_outcome:
    "effect_observed" | "no_effect_proven" | "partial_effect" | "completion_unknown";
  readonly withheld_outcome: "completion_unknown";
}

export interface RecoveryJournal {
  append(fact: RecoveryFact): Promise<Readonly<{ durability: "durable" | "volatile_test_only" }>>;
}

export async function commitBeforeProviderStart<T>(
  options: Readonly<{
    candidates: readonly AuditCandidate[];
    writer: RequiredAuditWriter;
    startProvider: () => Promise<T>;
  }>,
): Promise<
  | Readonly<{ status: "started"; value: T }>
  | Readonly<{ status: "denied"; code: "audit_unavailable" }>
> {
  try {
    const candidates = options.candidates.map((candidate) => validateAuditCandidate(candidate));
    const expectedTypes: readonly AuditEventType[] =
      candidates.find((candidate) => candidate.event_type === "approval.approved.v1") === undefined
        ? [
            "request.accepted.v1",
            "authorization.evaluation_recorded.v1",
            "authorization.decision_recorded.v1",
            "authorization.enforcement_recorded.v1",
            "plan.created.v1",
            "authorization.evaluation_recorded.v1",
            "authorization.decision_recorded.v1",
            "authorization.enforcement_recorded.v1",
            "apply.admitted.v1",
            "execution.attempt_reserved.v1",
          ]
        : [
            "request.accepted.v1",
            "authorization.evaluation_recorded.v1",
            "authorization.decision_recorded.v1",
            "authorization.enforcement_recorded.v1",
            "plan.created.v1",
            "approval.requested.v1",
            "approval.approved.v1",
            "authorization.evaluation_recorded.v1",
            "authorization.decision_recorded.v1",
            "authorization.enforcement_recorded.v1",
            "apply.admitted.v1",
            "execution.attempt_reserved.v1",
          ];
    if (
      candidates.length !== expectedTypes.length ||
      candidates.some((candidate, index) => candidate.event_type !== expectedTypes[index]) ||
      candidates.some((candidate, candidateIndex) =>
        requiredParentTypes(candidate).some((parentType, parentIndex) => {
          const parentRef = candidate.causation.parent_event_refs[parentIndex];
          return !candidates
            .slice(0, candidateIndex)
            .some((parent) => parent.event_id === parentRef && parent.event_type === parentType);
        }),
      )
    ) {
      throw new AuditError("audit_causation_invalid");
    }
    const decisions = candidates.filter(
      (candidate) => candidate.event_type === "authorization.decision_recorded.v1",
    );
    const evaluations = candidates.filter(
      (candidate) => candidate.event_type === "authorization.evaluation_recorded.v1",
    );
    const enforcements = candidates.filter(
      (candidate) => candidate.event_type === "authorization.enforcement_recorded.v1",
    );
    const planningEvaluation = evaluations[0];
    const applyEvaluation = evaluations[1];
    const planningDecision = decisions[0];
    const applyDecision = decisions[1];
    const planningEnforcement = enforcements[0];
    const applyEnforcement = enforcements[1];
    const plan = candidates.find((candidate) => candidate.event_type === "plan.created.v1");
    const admission = candidates.find((candidate) => candidate.event_type === "apply.admitted.v1");
    if (
      planningEvaluation?.event_type !== "authorization.evaluation_recorded.v1" ||
      planningEvaluation.payload.authorization_phase !== "planning" ||
      applyEvaluation?.event_type !== "authorization.evaluation_recorded.v1" ||
      applyEvaluation.payload.authorization_phase !== "apply" ||
      planningEvaluation.event_id === applyEvaluation.event_id ||
      planningEvaluation.correlation.authorization_request_ref ===
        applyEvaluation.correlation.authorization_request_ref ||
      planningDecision?.event_type !== "authorization.decision_recorded.v1" ||
      applyDecision?.event_type !== "authorization.decision_recorded.v1" ||
      planningDecision.event_id === applyDecision.event_id ||
      planningDecision.payload.decision_digest === applyDecision.payload.decision_digest ||
      planningDecision.correlation.authorization_decision_ref ===
        applyDecision.correlation.authorization_decision_ref ||
      planningDecision.payload.authorization_phase !== "planning" ||
      applyDecision.payload.authorization_phase !== "apply" ||
      planningDecision.payload.effect !== "allow" ||
      planningDecision.payload.basis !== "explicit" ||
      applyDecision.payload.effect !== "allow" ||
      applyDecision.payload.basis !== "explicit" ||
      planningDecision.payload.request_digest !== planningEvaluation.payload.request_digest ||
      applyDecision.payload.request_digest !== applyEvaluation.payload.request_digest ||
      planningEnforcement?.event_type !== "authorization.enforcement_recorded.v1" ||
      planningEnforcement.payload.authorization_phase !== "planning" ||
      planningEnforcement.payload.enforcement_result !== "enforced" ||
      planningEnforcement.payload.decision_digest !== planningDecision.payload.decision_digest ||
      applyEnforcement?.event_type !== "authorization.enforcement_recorded.v1" ||
      applyEnforcement.payload.authorization_phase !== "apply" ||
      applyEnforcement.payload.enforcement_result !== "enforced" ||
      applyEnforcement.payload.decision_digest !== applyDecision.payload.decision_digest ||
      plan?.event_type !== "plan.created.v1" ||
      plan.payload.authorization_decision_digest !== planningDecision.payload.decision_digest ||
      applyEvaluation.payload.plan_digest !== plan.payload.plan_digest ||
      applyDecision.payload.plan_digest !== plan.payload.plan_digest ||
      applyEnforcement.payload.plan_digest !== plan.payload.plan_digest ||
      admission?.event_type !== "apply.admitted.v1" ||
      admission.payload.plan_digest !== plan.payload.plan_digest ||
      admission.payload.fresh_authorization_decision_digest !==
        applyDecision.payload.decision_digest
    ) {
      throw new AuditError("audit_causation_invalid");
    }
    for (const candidate of candidates) {
      const validated = validateAuditCandidate(candidate);
      if (AUDIT_REGISTRY[validated.event_type].durability !== "required_pre_effect") {
        throw new AuditError("audit_unavailable");
      }
      const receipt = await options.writer.commit(validated);
      if (receipt.durability !== "durable" || receipt.event.event_id !== validated.event_id) {
        throw new AuditError("audit_unavailable");
      }
    }
  } catch {
    return { status: "denied", code: "audit_unavailable" };
  }
  return { status: "started", value: await options.startProvider() };
}

export async function recordAfterProviderStart(
  options: Readonly<{
    candidate: AuditCandidate;
    writer: RequiredAuditWriter;
    recoveryFact: RecoveryFact;
    journal: RecoveryJournal;
  }>,
): Promise<
  | Readonly<{ status: "recorded"; event_id: string }>
  | Readonly<{
      status: "withheld";
      code: "operation_outcome_unknown";
      recovery: "journaled" | "journal_unavailable";
    }>
> {
  let candidate: AuditCandidate | undefined;
  try {
    candidate = validateAuditCandidate(options.candidate);
    if (AUDIT_REGISTRY[candidate.event_type].durability !== "required_post_start") {
      throw new AuditError("audit_unavailable");
    }
    const receipt = await options.writer.commit(candidate);
    if (receipt.durability === "durable" && receipt.event.event_id === candidate.event_id) {
      return { status: "recorded", event_id: receipt.event.event_id };
    }
  } catch {
    // The closed recovery fact, not the rejected candidate or error, crosses this boundary.
  }
  try {
    if (candidate === undefined) throw new AuditError("audit_candidate_invalid");
    const fact = validateRecoveryFact(options.recoveryFact, candidate);
    const receipt = await options.journal.append(fact);
    if (receipt.durability === "durable") {
      return {
        status: "withheld",
        code: "operation_outcome_unknown",
        recovery: "journaled",
      };
    }
  } catch {
    // Failure is returned as a closed state; raw journal errors are never retained.
  }
  return {
    status: "withheld",
    code: "operation_outcome_unknown",
    recovery: "journal_unavailable",
  };
}

const REF = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function validateRecoveryFact(fact: RecoveryFact, candidate: AuditCandidate): RecoveryFact {
  const keys = Object.keys(fact).sort();
  const expected = [
    "cause",
    "event_id",
    "event_type",
    "execution_ref",
    "original_observed_at",
    "original_observation_parent_event_ref",
    "plan_digest",
    "attempt",
    "observed_outcome",
    "recovery_fact_version",
    "recovery_id",
    "request_ref",
    "trace_ref",
    "withheld_outcome",
  ].sort();
  const completion = candidate.event_type === "execution.completed.v1" ? candidate : undefined;
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    fact.recovery_fact_version !== 1 ||
    !REF.test(fact.recovery_id) ||
    !REF.test(fact.event_id) ||
    !REF.test(fact.trace_ref) ||
    !REF.test(fact.request_ref) ||
    !REF.test(fact.execution_ref) ||
    !REF.test(fact.original_observation_parent_event_ref) ||
    !AUDIT_EVENT_TYPES.includes(fact.event_type) ||
    !ISO_UTC.test(fact.original_observed_at) ||
    !Number.isFinite(Date.parse(fact.original_observed_at)) ||
    !DIGEST.test(fact.plan_digest) ||
    !Number.isInteger(fact.attempt) ||
    fact.attempt < 1 ||
    fact.attempt > 16 ||
    fact.cause !== "primary_writer_failed_after_provider_start" ||
    fact.withheld_outcome !== "completion_unknown" ||
    completion === undefined ||
    fact.event_id !== completion.event_id ||
    fact.event_type !== completion.event_type ||
    fact.original_observed_at !== completion.occurred_at ||
    fact.original_observation_parent_event_ref !== completion.causation.parent_event_refs[0] ||
    fact.trace_ref !== completion.correlation.trace_ref ||
    fact.request_ref !== completion.correlation.request_ref ||
    fact.execution_ref !== completion.correlation.execution_ref ||
    fact.plan_digest !== completion.payload.plan_digest ||
    fact.attempt !== completion.payload.attempt ||
    fact.observed_outcome !== completion.payload.result
  ) {
    throw new AuditError("audit_candidate_invalid");
  }
  return {
    recovery_fact_version: 1,
    recovery_id: fact.recovery_id,
    event_id: fact.event_id,
    event_type: fact.event_type,
    original_observed_at: fact.original_observed_at,
    original_observation_parent_event_ref: fact.original_observation_parent_event_ref,
    cause: fact.cause,
    trace_ref: fact.trace_ref,
    request_ref: fact.request_ref,
    execution_ref: fact.execution_ref,
    plan_digest: fact.plan_digest,
    attempt: fact.attempt,
    observed_outcome: fact.observed_outcome,
    withheld_outcome: fact.withheld_outcome,
  };
}
