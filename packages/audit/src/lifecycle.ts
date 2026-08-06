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
  readonly observed_at: string;
  readonly cause: "primary_writer_failed_after_provider_start";
  readonly trace_ref: string;
  readonly request_ref: string;
  readonly execution_ref: string;
  readonly outcome: "completion_unknown";
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
            "apply.admitted.v1",
            "execution.attempt_reserved.v1",
          ];
    const byType = new Map(candidates.map((candidate) => [candidate.event_type, candidate]));
    if (
      candidates.length !== expectedTypes.length ||
      candidates.some((candidate, index) => candidate.event_type !== expectedTypes[index]) ||
      candidates.some((candidate) =>
        requiredParentTypes(candidate).some(
          (parentType, index) =>
            candidate.causation.parent_event_refs[index] !== byType.get(parentType)?.event_id,
        ),
      )
    ) {
      throw new AuditError("audit_causation_invalid");
    }
    const decision = byType.get("authorization.decision_recorded.v1");
    const enforcement = byType.get("authorization.enforcement_recorded.v1");
    if (
      decision?.event_type !== "authorization.decision_recorded.v1" ||
      decision.payload.effect !== "allow" ||
      enforcement?.event_type !== "authorization.enforcement_recorded.v1" ||
      enforcement.payload.enforcement_result !== "enforced"
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
  let candidate: AuditCandidate;
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
    const fact = validateRecoveryFact(options.recoveryFact);
    if (
      fact.event_id !== options.candidate.event_id ||
      fact.event_type !== options.candidate.event_type ||
      fact.trace_ref !== options.candidate.correlation.trace_ref ||
      fact.request_ref !== options.candidate.correlation.request_ref ||
      fact.execution_ref !== options.candidate.correlation.execution_ref
    ) {
      throw new AuditError("audit_candidate_invalid");
    }
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

function validateRecoveryFact(fact: RecoveryFact): RecoveryFact {
  const keys = Object.keys(fact).sort();
  const expected = [
    "cause",
    "event_id",
    "event_type",
    "execution_ref",
    "observed_at",
    "outcome",
    "recovery_fact_version",
    "recovery_id",
    "request_ref",
    "trace_ref",
  ].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    fact.recovery_fact_version !== 1 ||
    !REF.test(fact.recovery_id) ||
    !REF.test(fact.event_id) ||
    !REF.test(fact.trace_ref) ||
    !REF.test(fact.request_ref) ||
    !REF.test(fact.execution_ref) ||
    !AUDIT_EVENT_TYPES.includes(fact.event_type) ||
    !ISO_UTC.test(fact.observed_at) ||
    !Number.isFinite(Date.parse(fact.observed_at)) ||
    fact.cause !== "primary_writer_failed_after_provider_start" ||
    fact.outcome !== "completion_unknown"
  ) {
    throw new AuditError("audit_candidate_invalid");
  }
  return {
    recovery_fact_version: 1,
    recovery_id: fact.recovery_id,
    event_id: fact.event_id,
    event_type: fact.event_type,
    observed_at: fact.observed_at,
    cause: fact.cause,
    trace_ref: fact.trace_ref,
    request_ref: fact.request_ref,
    execution_ref: fact.execution_ref,
    outcome: fact.outcome,
  };
}
