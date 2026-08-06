import {
  AUDIT_REGISTRY,
  AuditError,
  type AuditCandidate,
  type AuditEventType,
  isValidAuditTimestamp,
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

const recoveryFacts = new WeakSet<object>();

export function createRecoveryFact(recoveryId: string, observation: unknown): RecoveryFact {
  const execution = validateAuditCandidate(observation);
  if (
    execution.event_type !== "execution.started.v1" &&
    execution.event_type !== "execution.completed.v1"
  ) {
    throw new AuditError("audit_candidate_invalid");
  }
  const parentEventRef = execution.causation.parent_event_refs[0];
  const {
    trace_ref: traceRef,
    request_ref: requestRef,
    execution_ref: executionRef,
  } = execution.correlation;
  if (
    parentEventRef === undefined ||
    traceRef === null ||
    requestRef === null ||
    executionRef === null
  ) {
    throw new AuditError("audit_candidate_invalid");
  }
  const fact: RecoveryFact = Object.freeze({
    recovery_fact_version: 1,
    recovery_id: recoveryId,
    event_id: execution.event_id,
    event_type: execution.event_type,
    original_observed_at: execution.occurred_at,
    original_observation_parent_event_ref: parentEventRef,
    cause: "primary_writer_failed_after_provider_start",
    trace_ref: traceRef,
    request_ref: requestRef,
    execution_ref: executionRef,
    plan_digest: execution.payload.plan_digest,
    attempt: execution.payload.attempt,
    observed_outcome:
      execution.event_type === "execution.completed.v1"
        ? execution.payload.result
        : "completion_unknown",
    withheld_outcome: "completion_unknown",
  });
  validateRecoveryFactShape(fact);
  recoveryFacts.add(fact);
  return fact;
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
      planningEvaluation.payload.authorization_request_digest ===
        applyEvaluation.payload.authorization_request_digest ||
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
      planningDecision.payload.authorization_request_digest !==
        planningEvaluation.payload.authorization_request_digest ||
      applyDecision.payload.authorization_request_digest !==
        applyEvaluation.payload.authorization_request_digest ||
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
    candidate: unknown;
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
  let recoveryBinding: RecoverableBinding | undefined;
  try {
    recoveryBinding = parseRecoverableBinding(options.candidate);
  } catch {
    // Only a complete bounded binding may authorize the closed recovery path.
  }
  try {
    const candidate = validateAuditCandidate(options.candidate);
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
    if (recoveryBinding === undefined || !recoveryFacts.has(options.recoveryFact)) {
      throw new AuditError("audit_candidate_invalid");
    }
    assertRecoveryBinding(options.recoveryFact, recoveryBinding);
    const fact = validateRecoveryFactShape(options.recoveryFact);
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
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RECOVERY_OUTCOMES = [
  "effect_observed",
  "no_effect_proven",
  "partial_effect",
  "completion_unknown",
] as const;
type RecoveryOutcome = (typeof RECOVERY_OUTCOMES)[number];

interface RecoverableBinding {
  readonly event_id: string;
  readonly event_type: "execution.started.v1" | "execution.completed.v1";
  readonly occurred_at: string;
  readonly parent_event_ref: string;
  readonly trace_ref: string;
  readonly request_ref: string;
  readonly execution_ref: string;
  readonly plan_digest: string;
  readonly attempt: number;
  readonly observed_outcome: RecoveryOutcome;
}

function parseRecoverableBinding(value: unknown): RecoverableBinding {
  if (!isRecord(value)) throw new AuditError("audit_candidate_invalid");
  const eventType = readOwn(value, "event_type");
  if (eventType !== "execution.started.v1" && eventType !== "execution.completed.v1") {
    throw new AuditError("audit_candidate_invalid");
  }
  const correlation = readOwn(value, "correlation");
  const causation = readOwn(value, "causation");
  const payload = readOwn(value, "payload");
  const outcome = readOwn(value, "outcome");
  if (!isRecord(correlation) || !isRecord(causation) || !isRecord(payload) || !isRecord(outcome)) {
    throw new AuditError("audit_candidate_invalid");
  }
  const parentEventRefs = readOwn(causation, "parent_event_refs");
  const reasonCodes = readOwn(outcome, "reason_codes");
  if (
    !Array.isArray(parentEventRefs) ||
    parentEventRefs.length !== 1 ||
    !Object.hasOwn(parentEventRefs, 0) ||
    !Array.isArray(reasonCodes) ||
    reasonCodes.length !== 1 ||
    !Object.hasOwn(reasonCodes, 0)
  ) {
    throw new AuditError("audit_candidate_invalid");
  }

  const result =
    eventType === "execution.completed.v1"
      ? parseRecoveryOutcome(readOwn(payload, "result"))
      : "completion_unknown";
  if (
    (eventType === "execution.started.v1" &&
      (readOwn(outcome, "status") !== "started" || reasonCodes[0] !== "provider_started")) ||
    (eventType === "execution.completed.v1" &&
      (readOwn(outcome, "status") !== "completed" || reasonCodes[0] !== result))
  ) {
    throw new AuditError("audit_candidate_invalid");
  }

  return {
    event_id: parseBoundedRef(readOwn(value, "event_id")),
    event_type: eventType,
    occurred_at: parseAuditTimestamp(readOwn(value, "occurred_at")),
    parent_event_ref: parseBoundedRef(parentEventRefs[0]),
    trace_ref: parseBoundedRef(readOwn(correlation, "trace_ref")),
    request_ref: parseBoundedRef(readOwn(correlation, "request_ref")),
    execution_ref: parseBoundedRef(readOwn(correlation, "execution_ref")),
    plan_digest: parseDigest(readOwn(payload, "plan_digest")),
    attempt: parseAttempt(readOwn(payload, "attempt")),
    observed_outcome: result,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readOwn(record: Record<string, unknown>, key: string): unknown {
  if (!Object.hasOwn(record, key)) throw new AuditError("audit_candidate_invalid");
  return record[key];
}

function parseBoundedRef(value: unknown): string {
  if (typeof value !== "string" || value.length > 128 || !REF.test(value)) {
    throw new AuditError("audit_candidate_invalid");
  }
  return value;
}

function parseDigest(value: unknown): string {
  if (typeof value !== "string" || value.length !== 71 || !DIGEST.test(value)) {
    throw new AuditError("audit_candidate_invalid");
  }
  return value;
}

function parseAttempt(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 16) {
    throw new AuditError("audit_candidate_invalid");
  }
  return value as number;
}

function parseAuditTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.length > 30 || !isValidAuditTimestamp(value)) {
    throw new AuditError("audit_candidate_invalid");
  }
  return value;
}

function parseRecoveryOutcome(value: unknown): RecoveryOutcome {
  if (!RECOVERY_OUTCOMES.some((outcome) => outcome === value)) {
    throw new AuditError("audit_candidate_invalid");
  }
  return value as RecoveryOutcome;
}

function validateRecoveryFactShape(fact: RecoveryFact): RecoveryFact {
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
  const boundedRef = (value: string) => value.length <= 128 && REF.test(value);
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    fact.recovery_fact_version !== 1 ||
    !boundedRef(fact.recovery_id) ||
    !boundedRef(fact.event_id) ||
    !boundedRef(fact.trace_ref) ||
    !boundedRef(fact.request_ref) ||
    !boundedRef(fact.execution_ref) ||
    !boundedRef(fact.original_observation_parent_event_ref) ||
    (fact.event_type !== "execution.started.v1" && fact.event_type !== "execution.completed.v1") ||
    !isValidAuditTimestamp(fact.original_observed_at) ||
    !DIGEST.test(fact.plan_digest) ||
    !Number.isInteger(fact.attempt) ||
    fact.attempt < 1 ||
    fact.attempt > 16 ||
    fact.cause !== "primary_writer_failed_after_provider_start" ||
    fact.withheld_outcome !== "completion_unknown" ||
    !RECOVERY_OUTCOMES.includes(fact.observed_outcome) ||
    (fact.event_type === "execution.started.v1" && fact.observed_outcome !== "completion_unknown")
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

function assertRecoveryBinding(fact: RecoveryFact, binding: RecoverableBinding): void {
  if (
    fact.event_id !== binding.event_id ||
    fact.event_type !== binding.event_type ||
    fact.original_observed_at !== binding.occurred_at ||
    fact.original_observation_parent_event_ref !== binding.parent_event_ref ||
    fact.trace_ref !== binding.trace_ref ||
    fact.request_ref !== binding.request_ref ||
    fact.execution_ref !== binding.execution_ref ||
    fact.plan_digest !== binding.plan_digest ||
    fact.attempt !== binding.attempt ||
    fact.observed_outcome !== binding.observed_outcome
  ) {
    throw new AuditError("audit_candidate_invalid");
  }
}
